import { z } from 'zod';

/**
 * Mã lỗi ổn định. Client switch theo `code`, không theo `message`.
 * `message` dành cho người đọc và có thể đổi bất cứ lúc nào.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  TOKEN_EXPIRED: 401,
  TOKEN_INVALID: 401,
  TOKEN_REUSE_DETECTED: 401,
  INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  EMAIL_NOT_VERIFIED: 403,
  INSUFFICIENT_ROLE: 403,
  MATURITY_BLOCKED: 403,
  PROFILE_PIN_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  ALREADY_EXISTS: 409,
  PROFILE_LIMIT_REACHED: 409,
  STREAM_LIMIT_EXCEEDED: 409,
  CONFLICT: 409,
  TOKEN_CONSUMED: 410,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  UPSTREAM_TIMEOUT: 504,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function httpStatusForCode(code: string): number {
  return (ERROR_CODES as Record<string, number>)[code] ?? 500;
}

export const errorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.array(z.object({ field: z.string(), issue: z.string() })).optional(),
  requestId: z.string().optional(),
});
export type ErrorPayload = z.infer<typeof errorPayloadSchema>;

/** Hình dạng lỗi khi truyền qua NATS — service ném, gateway bắt và map sang HTTP */
export const RPC_ERROR_MARKER = '__nekoflix_error__';

export interface RpcErrorShape {
  [RPC_ERROR_MARKER]: true;
  code: string;
  message: string;
  details?: { field: string; issue: string }[];
}

export function isRpcError(value: unknown): value is RpcErrorShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)[RPC_ERROR_MARKER] === true
  );
}
