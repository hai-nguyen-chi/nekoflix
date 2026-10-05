import { z } from 'zod';

/**
 * Event của walking skeleton Phase 0.
 * Xóa cả file này khi sang Phase 1 — nó chỉ tồn tại để chứng minh
 * đường đi outbox -> NATS -> consumer -> idempotency hoạt động.
 */
export const pingEchoCreatedV1 = z.object({
  echoId: z.string(),
  message: z.string(),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
});
export type PingEchoCreatedV1 = z.infer<typeof pingEchoCreatedV1>;
