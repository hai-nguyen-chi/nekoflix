import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Connection, type ClientSession, Model } from 'mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import { context as otelContext, propagation, trace } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import { type EventData, type EventType, eventVersion, parseEventData } from '@nekoflix/contracts';
import { currentRequestStore } from '../observability/logger';
import { SERVICE_IDENTITY, type ServiceIdentity } from '../tokens';
import { OutboxEvent } from './outbox.schema';

export interface PublishOptions {
  /**
   * BẮT BUỘC. Session của transaction đang ghi dữ liệu nghiệp vụ.
   *
   * Bắt buộc có chủ đích: nếu cho phép publish ngoài transaction thì outbox
   * mất hết ý nghĩa, và sẽ có người (thường là chính mình, lúc 11h đêm) dùng
   * nó như một hàng đợi thường.
   */
  session: ClientSession;
  /** Id của event đã gây ra event này — dựng lại được chuỗi nhân quả */
  causationId?: string | null;
}

@Injectable()
export class OutboxService {
  constructor(
    @InjectModel(OutboxEvent.name) private readonly model: Model<OutboxEvent>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(SERVICE_IDENTITY) private readonly identity: ServiceIdentity,
  ) {}

  /**
   * Ghi event vào outbox, trong CÙNG transaction với dữ liệu nghiệp vụ.
   *
   * ```ts
   * await outbox.withTransaction(async (session) => {
   *   await this.echoes.create([doc], { session });
   *   await this.outbox.publish('ping.echo.created', payload, { session });
   * });
   * ```
   */
  async publish<T extends EventType>(
    type: T,
    data: EventData<T>,
    opts: PublishOptions,
  ): Promise<string> {
    // Validate ngay lúc phát: event sai hợp đồng phải chết ở đây, không phải
    // ở consumer của service khác 3 ngày sau.
    const validated = parseEventData(type, data);

    const store = currentRequestStore();
    const spanCtx = trace.getActiveSpan()?.spanContext();
    const id = randomUUID();

    // Chụp lại trace context hiện tại để consumer nối span vào đúng chỗ
    const carrier: Record<string, string> = {};
    propagation.inject(otelContext.active(), carrier);

    await this.model.create(
      [
        {
          eventId: id,
          type,
          version: eventVersion(type),
          occurredAt: new Date(),
          producer: `${this.identity.name}@${this.identity.version}`,
          traceId: spanCtx?.traceId ?? store?.traceId ?? '',
          traceparent: carrier['traceparent'] ?? null,
          correlationId: store?.correlationId ?? '',
          causationId: opts.causationId ?? null,
          data: validated,
          status: 'pending',
          attempts: 0,
        },
      ],
      { session: opts.session },
    );

    return id;
  }

  /** Chạy một hàm trong transaction; tự commit/abort */
  async withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
}
