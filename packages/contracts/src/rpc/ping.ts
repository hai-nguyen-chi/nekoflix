import { z } from 'zod';

/** RPC của walking skeleton Phase 0. Xóa khi sang Phase 1. */

export const pingRequest = z.object({
  message: z.string().min(1).max(200),
});
export type PingRequest = z.infer<typeof pingRequest>;

export const pingResponse = z.object({
  reply: z.string(),
  servedBy: z.string(),
  servedAt: z.string().datetime(),
  /** Chứng minh claim từ gateway đi xuống tới service */
  caller: z.object({
    userId: z.string().nullable(),
    requestId: z.string(),
    traceId: z.string(),
  }),
});
export type PingResponse = z.infer<typeof pingResponse>;

export const createEchoRequest = z.object({
  message: z.string().min(1).max(200),
  /** Cố ý gây lỗi SAU khi ghi DB — để test rollback của outbox */
  failAfterWrite: z.boolean().optional(),
});
export type CreateEchoRequest = z.infer<typeof createEchoRequest>;

export const createEchoResponse = z.object({
  echoId: z.string(),
  message: z.string(),
  createdAt: z.string().datetime(),
});
export type CreateEchoResponse = z.infer<typeof createEchoResponse>;

export const listEchoesResponse = z.object({
  items: z.array(
    z.object({
      echoId: z.string(),
      message: z.string(),
      createdAt: z.string().datetime(),
    }),
  ),
});
export type ListEchoesResponse = z.infer<typeof listEchoesResponse>;

/** Những gì pong-service đã nhận được qua event — dùng để verify end-to-end */
export const listReceivedResponse = z.object({
  items: z.array(
    z.object({
      echoId: z.string(),
      message: z.string(),
      receivedAt: z.string().datetime(),
      /** Số lần event này được GIAO tới (phải > 1 khi test redelivery) */
      deliveryCount: z.number().int(),
    }),
  ),
});
export type ListReceivedResponse = z.infer<typeof listReceivedResponse>;
