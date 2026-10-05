import { AsyncLocalStorage } from 'node:async_hooks';
import type { LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';

export interface RequestStore {
  requestId: string;
  traceId: string;
  correlationId: string;
  userId?: string;
}

/** Mang requestId/traceId xuyên suốt call stack mà không phải truyền tay qua mọi hàm */
export const requestStorage = new AsyncLocalStorage<RequestStore>();

export function currentRequestStore(): RequestStore | undefined {
  return requestStorage.getStore();
}

let root: Logger | undefined;

export function createRootLogger(serviceName: string, level = 'info'): Logger {
  root = pino({
    level,
    base: { service: serviceName },
    timestamp: pino.stdTimeFunctions.isoTime,
    // KHÔNG BAO GIỜ log những field này — kể cả khi lỡ đưa vào object
    redact: {
      paths: [
        'password',
        '*.password',
        'passwordHash',
        '*.passwordHash',
        'accessToken',
        '*.accessToken',
        'refreshToken',
        '*.refreshToken',
        'token',
        '*.token',
        'secret',
        '*.secret',
        'authorization',
        'req.headers.authorization',
        'req.headers.cookie',
      ],
      censor: '[REDACTED]',
    },
    // Tự chèn ngữ cảnh request vào mọi dòng log
    mixin() {
      const store = requestStorage.getStore();
      return store
        ? { requestId: store.requestId, traceId: store.traceId, userId: store.userId }
        : {};
    },
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
        : undefined,
  });
  return root;
}

export function getLogger(): Logger {
  if (!root) root = createRootLogger(process.env.SERVICE_NAME ?? 'unknown');
  return root;
}

/** Adapter để NestJS dùng pino thay cho logger mặc định */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: string) {
    this.logger.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string) {
    this.logger.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string) {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string) {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string) {
    this.logger.trace({ context }, String(message));
  }
}
