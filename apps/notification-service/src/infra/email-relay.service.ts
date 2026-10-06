import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Counter, Gauge } from 'prom-client';
import { getLogger, registry } from '@nekoflix/service-kit';
import { EmailOutbox, type EmailOutboxDocument } from '../persistence/schemas/email-outbox.schema';
import { MailerService } from './mailer.service';

const POLL_INTERVAL_MS = 1_000;
const METRICS_INTERVAL_MS = 15_000;
const CLAIM_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 5;
const BATCH_LIMIT = 20;

const emailsSent = new Counter({
  name: 'emails_sent_total',
  help: 'Số email đã gửi thành công',
  labelNames: ['template'] as const,
  registers: [registry],
});

const emailsFailed = new Counter({
  name: 'emails_failed_total',
  help: 'Số email thất bại vĩnh viễn (hết lượt thử)',
  labelNames: ['template'] as const,
  registers: [registry],
});

/**
 * Chỉ số cần theo dõi nhất của service này.
 *
 * Tăng dần = SMTP hỏng hoặc relay chết = email không tới ai, mà hệ thống
 * vẫn chạy bình thường và không ném lỗi nào. Cùng loại hỏng âm thầm với
 * `outbox_pending_count`.
 */
const emailPending = new Gauge({
  name: 'email_outbox_pending_count',
  help: 'Số email đang chờ gửi',
  registers: [registry],
});

/**
 * Đọc hàng đợi email và gửi đi.
 *
 * Tách khỏi handler có chủ đích: handler chạy trong transaction, mà gửi
 * email là tác dụng phụ KHÔNG rollback được. Xem comment ở email-outbox.schema.ts.
 */
@Injectable()
export class EmailRelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private pollTimer?: NodeJS.Timeout;
  private metricsTimer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(
    @InjectModel(EmailOutbox.name) private readonly outbox: Model<EmailOutbox>,
    private readonly mailer: MailerService,
  ) {}

  onApplicationBootstrap(): void {
    this.pollTimer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.metricsTimer = setInterval(() => void this.reportMetrics(), METRICS_INTERVAL_MS);
    getLogger().info('email relay đã khởi động');
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    for (let i = 0; i < 50 && this.running; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** Public để test gọi trực tiếp thay vì chờ interval */
  async tick(): Promise<number> {
    if (this.running || this.stopped) return 0;
    this.running = true;
    let sent = 0;

    try {
      await this.reclaimStuck();

      for (let i = 0; i < BATCH_LIMIT; i++) {
        const doc = await this.outbox.findOneAndUpdate(
          { status: 'pending', attempts: { $lt: MAX_ATTEMPTS } },
          { $set: { status: 'sending', claimedAt: new Date() }, $inc: { attempts: 1 } },
          { sort: { createdAt: 1 }, returnDocument: 'after' },
        );
        if (!doc) break;

        const ok = await this.sendOne(doc);
        if (!ok) break; // SMTP đang có vấn đề — dừng vòng này
        sent++;
      }
    } catch (err) {
      getLogger().error({ err: String(err) }, 'email relay lỗi');
    } finally {
      this.running = false;
    }

    return sent;
  }

  private async sendOne(doc: EmailOutboxDocument): Promise<boolean> {
    try {
      const messageId = await this.mailer.send({
        to: doc.to,
        subject: doc.subject,
        html: doc.html,
        text: doc.text,
      });

      await this.outbox.updateOne(
        { _id: doc._id },
        { $set: { status: 'sent', sentAt: new Date(), claimedAt: null, lastError: null } },
      );

      emailsSent.inc({ template: doc.template });
      getLogger().info(
        { to: maskEmail(doc.to), template: doc.template, messageId },
        'đã gửi email',
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const exhausted = doc.attempts >= MAX_ATTEMPTS;

      await this.outbox.updateOne(
        { _id: doc._id },
        {
          $set: {
            status: exhausted ? 'failed' : 'pending',
            claimedAt: null,
            lastError: message.slice(0, 500),
          },
        },
      );

      if (exhausted) emailsFailed.inc({ template: doc.template });
      getLogger().error(
        { to: maskEmail(doc.to), template: doc.template, attempts: doc.attempts, err: message },
        exhausted ? 'email THẤT BẠI sau nhiều lần thử' : 'gửi email lỗi, sẽ thử lại',
      );
      return false;
    }
  }

  /** Thu hồi email bị claim rồi bỏ dở (process chết giữa chừng) */
  private async reclaimStuck(): Promise<void> {
    const res = await this.outbox.updateMany(
      { status: 'sending', claimedAt: { $lt: new Date(Date.now() - CLAIM_TIMEOUT_MS) } },
      { $set: { status: 'pending', claimedAt: null } },
    );
    if (res.modifiedCount > 0) {
      getLogger().warn({ count: res.modifiedCount }, 'đã thu hồi email bị kẹt');
    }
  }

  private async reportMetrics(): Promise<void> {
    try {
      const pending = await this.outbox.countDocuments({
        status: { $in: ['pending', 'sending'] },
      });
      emailPending.set(pending);
      if (pending > 50) {
        getLogger().warn({ pending }, 'email tồn đọng nhiều — SMTP có thể đang hỏng');
      }
    } catch {
      // metric lỗi không được làm chết service
    }
  }
}

/** Không ghi email đầy đủ vào log — đó là thông tin định danh */
function maskEmail(email: string): string {
  const [name = '', domain = ''] = email.split('@');
  return `${name.slice(0, 2)}***@${domain}`;
}
