import { ROOT_CONTEXT, context, propagation } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import { currentRequestStore } from '../observability/logger';

/**
 * Khung payload cho mọi NATS request/reply.
 *
 * Tài liệu kiến trúc mô tả ngữ cảnh đi qua NATS *header*. Thực tế transporter
 * NATS của NestJS không expose header per-request, nên ngữ cảnh được nhúng
 * thẳng vào payload. Hiệu quả tương đương, và đơn giản hơn nhiều.
 */
export interface RpcMeta {
  requestId: string;
  correlationId: string;
  userId?: string;
  profileId?: string;
  role?: string;
  plan?: string;
  /** W3C trace context (traceparent/tracestate) — nối trace xuyên NATS */
  carrier: Record<string, string>;
}

export interface RpcPayload<T> {
  meta: RpcMeta;
  data: T;
}

/**
 * Gói payload kèm ngữ cảnh hiện tại.
 *
 * `propagation.inject` ghi `traceparent` vào carrier. Không có bước này,
 * trace đứt ngay tại ranh giới NATS và Jaeger hiện ra hai trace rời rạc
 * thay vì một chuỗi liền mạch — đúng thứ khiến debug hệ 9 service trở nên
 * bất khả thi.
 */
export function wrapRpcPayload<T>(data: T, overrides: Partial<RpcMeta> = {}): RpcPayload<T> {
  const store = currentRequestStore();
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);

  return {
    meta: {
      requestId: overrides.requestId ?? store?.requestId ?? randomUUID(),
      correlationId: overrides.correlationId ?? store?.correlationId ?? randomUUID(),
      ...((overrides.userId ?? store?.userId) ? { userId: overrides.userId ?? store?.userId } : {}),
      ...(overrides.profileId ? { profileId: overrides.profileId } : {}),
      ...(overrides.role ? { role: overrides.role } : {}),
      ...(overrides.plan ? { plan: overrides.plan } : {}),
      carrier,
    },
    data,
  };
}

/** Khôi phục trace context của bên gọi để span mới nối đúng vào trace cha */
export function extractRpcContext(meta: RpcMeta | undefined) {
  return propagation.extract(ROOT_CONTEXT, meta?.carrier ?? {});
}

export function isRpcPayload<T>(value: unknown): value is RpcPayload<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'meta' in value &&
    'data' in value &&
    typeof (value as RpcPayload<T>).meta === 'object'
  );
}
