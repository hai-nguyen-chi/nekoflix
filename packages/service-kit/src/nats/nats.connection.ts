import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import {
  AckPolicy,
  DiscardPolicy,
  Events,
  JSONCodec,
  RetentionPolicy,
  StorageType,
  connect,
  nanos,
  type ConsumerConfig,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
} from 'nats';
import {
  DLQ_STREAM_NAME,
  DLQ_SUBJECT_PREFIX,
  EVENT_STREAM_NAME,
  EVENT_SUBJECT_PREFIX,
} from '@nekoflix/contracts';
import { getLogger } from '../observability/logger';

const codec = JSONCodec();

/**
 * Kết nối NATS "thô" dành riêng cho JetStream.
 *
 * Tách khỏi transporter NATS của NestJS (lo request/reply) vì transporter đó
 * chỉ dùng NATS core — publish/subscribe KHÔNG bền bỉ. Event mà mất khi
 * consumer đang restart thì outbox trở nên vô nghĩa.
 *
 * Hai kết nối tới cùng một server. Chấp nhận được và rạch ròi về vai trò.
 */
@Injectable()
export class NatsConnectionProvider implements OnModuleInit, OnApplicationShutdown {
  private connection?: NatsConnection;
  private js?: JetStreamClient;
  private jsm?: JetStreamManager;

  async onModuleInit(): Promise<void> {
    const servers = (process.env.NATS_URL ?? 'nats://localhost:4222').split(',');

    try {
      this.connection = await connect({
        servers,
        name: process.env.SERVICE_NAME ?? 'nekoflix-service',
        reconnect: true,
        maxReconnectAttempts: -1, // thử lại vô hạn SAU KHI đã kết nối được
        reconnectTimeWait: 1_000,
        pingInterval: 20_000,
      });
    } catch (err) {
      // Lần kết nối ĐẦU TIÊN thất bại thì `reconnect` không cứu được —
      // nó chỉ áp dụng cho kết nối đã từng thành công. Fail fast với thông
      // báo đọc được, thay vì ném NatsError thô ra console.
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Không kết nối được NATS tại ${servers.join(', ')} (${reason}).\n` +
          `  Chạy hạ tầng trước:  pnpm infra:up\n` +
          `  Hoặc đặt NATS_URL nếu NATS nằm ở nơi khác.`,
      );
    }

    this.js = this.connection.jetstream();
    this.jsm = await this.connection.jetstreamManager();

    await this.ensureStreams();
    void this.watchStatus();

    getLogger().info({ servers }, 'đã kết nối NATS JetStream');
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.connection) return;
    // drain() xử lý nốt message đang trong tay rồi mới đóng — khác hẳn close()
    await this.connection.drain().catch(() => this.connection?.close());
    this.connection = undefined;
  }

  jetstream(): JetStreamClient {
    if (!this.js) throw new Error('NATS chưa sẵn sàng');
    return this.js;
  }

  manager(): JetStreamManager {
    if (!this.jsm) throw new Error('NATS chưa sẵn sàng');
    return this.jsm;
  }

  raw(): NatsConnection {
    if (!this.connection) throw new Error('NATS chưa sẵn sàng');
    return this.connection;
  }

  isConnected(): boolean {
    return !!this.connection && !this.connection.isClosed();
  }

  encode(value: unknown): Uint8Array {
    return codec.encode(value);
  }

  decode<T>(data: Uint8Array): T {
    return codec.decode(data) as T;
  }

  /** Tạo stream nếu chưa có; cập nhật nếu cấu hình đã đổi. Idempotent. */
  private async ensureStreams(): Promise<void> {
    const jsm = this.manager();

    const eventStream = {
      name: EVENT_STREAM_NAME,
      subjects: [`${EVENT_SUBJECT_PREFIX}.>`],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      discard: DiscardPolicy.Old,
      max_age: nanos(7 * 24 * 60 * 60 * 1000), // 7 ngày
      max_msgs: -1,
      // Cùng msgID trong cửa sổ này -> JetStream tự khử trùng.
      // Kết hợp với outbox.id, relay chạy lại không tạo bản sao ở broker.
      duplicate_window: nanos(2 * 60 * 1000),
      num_replicas: 1,
    };

    const dlqStream = {
      name: DLQ_STREAM_NAME,
      subjects: [`${DLQ_SUBJECT_PREFIX}.>`],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      max_age: nanos(30 * 24 * 60 * 60 * 1000), // 30 ngày — cần thời gian để điều tra
      num_replicas: 1,
    };

    for (const cfg of [eventStream, dlqStream]) {
      try {
        await jsm.streams.info(cfg.name);
        await jsm.streams.update(cfg.name, cfg);
      } catch {
        await jsm.streams.add(cfg);
        getLogger().info({ stream: cfg.name }, 'đã tạo JetStream stream');
      }
    }
  }

  /**
   * Tạo/cập nhật durable consumer cho service này.
   *
   * `ack_policy: explicit` là bắt buộc — ack tự động nghĩa là service crash
   * giữa lúc xử lý thì event mất luôn.
   */
  async ensureConsumer(
    durable: string,
    filterSubjects: string[],
    opts: {
      maxDeliver: number;
      ackWaitMs: number;
      maxAckPending: number;
    },
  ): Promise<void> {
    const jsm = this.manager();
    const config: Partial<ConsumerConfig> = {
      durable_name: durable,
      ack_policy: AckPolicy.Explicit,
      ack_wait: nanos(opts.ackWaitMs),
      max_deliver: opts.maxDeliver,
      max_ack_pending: opts.maxAckPending,
      filter_subjects: filterSubjects,
    };

    try {
      await jsm.consumers.info(EVENT_STREAM_NAME, durable);
      await jsm.consumers.update(EVENT_STREAM_NAME, durable, config);
    } catch {
      await jsm.consumers.add(EVENT_STREAM_NAME, config);
      getLogger().info({ durable, filterSubjects }, 'đã tạo JetStream consumer');
    }
  }

  private async watchStatus(): Promise<void> {
    if (!this.connection) return;
    for await (const status of this.connection.status()) {
      const log = getLogger();
      if (status.type === Events.Disconnect) log.warn({ data: status.data }, 'NATS mất kết nối');
      else if (status.type === Events.Reconnect)
        log.info({ data: status.data }, 'NATS đã kết nối lại');
      else if (status.type === Events.Error) log.error({ data: status.data }, 'NATS lỗi');
    }
  }
}
