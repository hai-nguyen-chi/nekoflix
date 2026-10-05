import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

let initialized = false;

export function initMetrics(serviceName: string): void {
  if (initialized) return;
  registry.setDefaultLabels({ service: serviceName });
  collectDefaultMetrics({ register: registry });
  initialized = true;
}

export const rpcDuration = new Histogram({
  name: 'nats_rpc_duration_seconds',
  help: 'Thời gian xử lý một NATS request/reply',
  labelNames: ['subject', 'status'] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const eventDuration = new Histogram({
  name: 'event_processing_duration_seconds',
  help: 'Thời gian xử lý một event',
  labelNames: ['type', 'status'] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const eventFailures = new Counter({
  name: 'event_processing_failures_total',
  help: 'Số lần xử lý event thất bại',
  labelNames: ['type'] as const,
  registers: [registry],
});

export const eventDuplicates = new Counter({
  name: 'event_duplicates_total',
  help: 'Số event bị giao lại và đã được bỏ qua nhờ idempotency',
  labelNames: ['type'] as const,
  registers: [registry],
});

export const dlqTotal = new Counter({
  name: 'event_dlq_total',
  help: 'Số event bị đẩy sang Dead Letter Queue',
  labelNames: ['type'] as const,
  registers: [registry],
});

/**
 * CHỈ SỐ QUAN TRỌNG NHẤT của kiến trúc này.
 *
 * Tăng dần = outbox relay chết = event không được phát = hệ thống đang lệch
 * dần mà KHÔNG ném ra lỗi nào. Đây là kiểu hỏng nguy hiểm nhất: im lặng.
 *
 * Đặt cảnh báo khi > 100 hoặc khi event cũ nhất > 5 phút.
 */
export const outboxPending = new Gauge({
  name: 'outbox_pending_count',
  help: 'Số event đang nằm chờ trong outbox',
  registers: [registry],
});

export const outboxOldestAgeSeconds = new Gauge({
  name: 'outbox_oldest_age_seconds',
  help: 'Tuổi của event cũ nhất đang chờ trong outbox',
  registers: [registry],
});

export const outboxPublished = new Counter({
  name: 'outbox_published_total',
  help: 'Số event đã được relay publish thành công',
  labelNames: ['type'] as const,
  registers: [registry],
});
