import { z } from 'zod';

/**
 * Khung chung cho MỌI event trong hệ thống.
 *
 * Ba field hay bị bỏ qua nhưng cực kỳ đáng giá khi debug:
 *  - traceId     : không truyền qua thì trace đứt ngay tại ranh giới event
 *  - causationId : dựng lại được chuỗi nhân quả, vô giá khi gỡ vòng lặp event
 *  - occurredAt  : thời điểm sự kiện XẢY RA, không phải lúc nhận được.
 *                  Hai cái này lệch nhau khi có retry, và consumer cần cái
 *                  trước để phát hiện event đến sai thứ tự.
 */
export const eventEnvelopeSchema = z.object({
  /** UUID — khóa idempotency ở phía consumer */
  id: z.string().uuid(),
  /** vd 'ping.echo.created' */
  type: z.string().min(1),
  /** Schema version, bắt đầu từ 1 */
  version: z.number().int().positive(),
  /** Thời điểm sự kiện xảy ra (ISO 8601) */
  occurredAt: z.string().datetime(),
  /** vd 'ping-service@0.1.0' */
  producer: z.string().min(1),
  /** Nối vào distributed trace — dùng để lọc log */
  traceId: z.string(),
  /**
   * W3C traceparent đầy đủ. `traceId` một mình KHÔNG đủ để nối span:
   * còn cần spanId của bên phát thì Jaeger mới vẽ được quan hệ cha-con.
   */
  traceparent: z.string().optional(),
  /** Request gốc của người dùng */
  correlationId: z.string(),
  /** Id của event đã gây ra event này */
  causationId: z.string().nullable(),
  /** Payload riêng của từng loại event */
  data: z.unknown(),
});

export type EventEnvelope<TData = unknown> = Omit<z.infer<typeof eventEnvelopeSchema>, 'data'> & {
  data: TData;
};

/** Prefix subject của mọi event. Stream EVENTS bắt `nekoflix.events.>` */
export const EVENT_SUBJECT_PREFIX = 'nekoflix.events';
export const DLQ_SUBJECT_PREFIX = 'nekoflix.dlq';

export const EVENT_STREAM_NAME = 'EVENTS';
export const DLQ_STREAM_NAME = 'DLQ';

/** 'ping.echo.created' -> 'nekoflix.events.ping.echo.created' */
export function eventSubject(type: string): string {
  return `${EVENT_SUBJECT_PREFIX}.${type}`;
}

/** 'nekoflix.events.ping.echo.created' -> 'ping.echo.created' */
export function eventTypeFromSubject(subject: string): string {
  return subject.startsWith(`${EVENT_SUBJECT_PREFIX}.`)
    ? subject.slice(EVENT_SUBJECT_PREFIX.length + 1)
    : subject;
}

export function dlqSubject(type: string): string {
  return `${DLQ_SUBJECT_PREFIX}.${type}`;
}

/**
 * Header truyền kèm mọi NATS request từ gateway xuống service.
 *
 * Gateway là ranh giới tin cậy: nó verify JWT một lần, service bên trong
 * TIN các claim này. An toàn chỉ khi NATS không lộ ra ngoài mạng nội bộ.
 */
export const NATS_HEADERS = {
  userId: 'x-user-id',
  profileId: 'x-profile-id',
  role: 'x-role',
  plan: 'x-plan',
  requestId: 'x-request-id',
  traceId: 'x-trace-id',
  correlationId: 'x-correlation-id',
} as const;

export interface CallerContext {
  userId?: string;
  profileId?: string;
  role?: string;
  plan?: string;
  requestId: string;
  traceId: string;
  correlationId: string;
}
