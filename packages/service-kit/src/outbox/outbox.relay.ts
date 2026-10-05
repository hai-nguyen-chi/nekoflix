import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { eventSubject, type EventEnvelope } from '@nekoflix/contracts';
import { getLogger } from '../observability/logger';
import { outboxOldestAgeSeconds, outboxPending, outboxPublished } from '../observability/metrics';
import { NatsConnectionProvider } from '../nats/nats.connection';
import { SERVICE_IDENTITY, type ServiceIdentity } from '../tokens';
import { OutboxEvent, type OutboxEventDocument } from './outbox.schema';

const POLL_INTERVAL_MS = 1_000;
const METRICS_INTERVAL_MS = 10_000;
/** Bản ghi kẹt ở 'publishing' quá lâu -> process relay đã chết giữa chừng */
const CLAIM_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 10;
const BATCH_LIMIT = 100;

/**
 * Đọc outbox và publish lên JetStream.
 *
 * Dùng polling (phương án A trong docs/14). Change Stream cho độ trễ thấp
 * hơn nhưng có thể đứt và bỏ sót — nếu chuyển sang nó thì VẪN phải giữ
 * polling chạy nền với chu kỳ dài hơn.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private pollTimer?: NodeJS.Timeout;
  private metricsTimer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(
    @InjectModel(OutboxEvent.name) private readonly model: Model<OutboxEvent>,
    private readonly nats: NatsConnectionProvider,
    @Inject(SERVICE_IDENTITY) private readonly identity: ServiceIdentity,
  ) {}

  onApplicationBootstrap(): void {
    this.pollTimer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.metricsTimer = setInterval(() => void this.reportMetrics(), METRICS_INTERVAL_MS);
    getLogger().info('outbox relay đã khởi động');
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    // Chờ vòng đang chạy kết thúc để không bỏ dở bản ghi đã claim
    for (let i = 0; i < 50 && this.running; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** Public để test gọi trực tiếp, không phải chờ interval */
  async tick(): Promise<number> {
    if (this.running || this.stopped) return 0;
    this.running = true;
    let published = 0;

    try {
      await this.reclaimStuck();

      for (let i = 0; i < BATCH_LIMIT; i++) {
        // findOneAndUpdate để nhiều instance relay không giành nhau cùng bản ghi
        const doc = await this.model.findOneAndUpdate(
          { status: 'pending', attempts: { $lt: MAX_ATTEMPTS } },
          { $set: { status: 'publishing', claimedAt: new Date() }, $inc: { attempts: 1 } },
          { sort: { createdAt: 1 }, returnDocument: 'after' },
        );
        if (!doc) break;

        const ok = await this.publishOne(doc);
        if (!ok) break; // NATS đang có vấn đề — dừng vòng này, thử lại sau
        published++;
      }
    } catch (err) {
      getLogger().error({ err: String(err) }, 'outbox relay lỗi');
    } finally {
      this.running = false;
    }

    return published;
  }

  private async publishOne(doc: OutboxEventDocument): Promise<boolean> {
    const envelope: EventEnvelope = {
      id: doc.eventId,
      type: doc.type,
      version: doc.version,
      occurredAt: doc.occurredAt.toISOString(),
      producer: doc.producer,
      traceId: doc.traceId,
      ...(doc.traceparent ? { traceparent: doc.traceparent } : {}),
      correlationId: doc.correlationId,
      causationId: doc.causationId,
      data: doc.data,
    };

    try {
      const js = this.nats.jetstream();
      await js.publish(eventSubject(doc.type), this.nats.encode(envelope), {
        // msgID + duplicate window của JetStream -> relay chạy lại không
        // tạo ra bản sao ở phía broker
        msgID: doc.eventId,
      });

      await this.model.updateOne(
        { _id: doc._id },
        {
          $set: { status: 'published', publishedAt: new Date(), claimedAt: null, lastError: null },
        },
      );
      outboxPublished.inc({ type: doc.type });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const exhausted = doc.attempts >= MAX_ATTEMPTS;

      await this.model.updateOne(
        { _id: doc._id },
        {
          $set: {
            status: exhausted ? 'failed' : 'pending',
            claimedAt: null,
            lastError: message.slice(0, 500),
          },
        },
      );

      getLogger().error(
        { outboxId: doc.eventId, type: doc.type, attempts: doc.attempts, err: message },
        exhausted ? 'outbox event FAILED sau nhiều lần thử' : 'publish lỗi, sẽ thử lại',
      );
      return false;
    }
  }

  /** Thu hồi bản ghi bị claim rồi bỏ dở (process chết giữa chừng) */
  private async reclaimStuck(): Promise<void> {
    const cutoff = new Date(Date.now() - CLAIM_TIMEOUT_MS);
    const res = await this.model.updateMany(
      { status: 'publishing', claimedAt: { $lt: cutoff } },
      { $set: { status: 'pending', claimedAt: null } },
    );
    if (res.modifiedCount > 0) {
      getLogger().warn({ count: res.modifiedCount }, 'đã thu hồi outbox event bị kẹt');
    }
  }

  private async reportMetrics(): Promise<void> {
    try {
      const pending = await this.model.countDocuments({
        status: { $in: ['pending', 'publishing'] },
      });
      outboxPending.set(pending);

      const oldest = await this.model
        .findOne({ status: { $in: ['pending', 'publishing'] } })
        .sort({ createdAt: 1 })
        .select('createdAt')
        .lean();

      outboxOldestAgeSeconds.set(
        oldest ? Math.floor((Date.now() - new Date(oldest.createdAt).getTime()) / 1000) : 0,
      );

      if (pending > 100) {
        getLogger().warn(
          { pending, service: this.identity.name },
          'outbox tồn đọng nhiều — relay có thể đang gặp vấn đề',
        );
      }
    } catch {
      // metric lỗi không được làm chết service
    }
  }
}
