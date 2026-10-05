import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { trace } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import { getLogger, requestStorage } from '@nekoflix/service-kit';

/**
 * Gắn requestId + traceId cho mọi request, và giữ chúng trong
 * AsyncLocalStorage suốt vòng đời request.
 *
 * Nhờ đó mọi dòng log ở mọi tầng tự có requestId mà không phải truyền tay
 * qua từng hàm — và khi một request lỗi, lọc log theo traceId là ra đủ
 * chuỗi 4 hop.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    const correlationId = (req.headers['x-correlation-id'] as string | undefined) ?? requestId;
    const traceId = trace.getActiveSpan()?.spanContext().traceId ?? '';

    res.setHeader('x-request-id', requestId);
    if (traceId) res.setHeader('x-trace-id', traceId);

    const started = Date.now();
    res.on('finish', () => {
      // Health check mỗi 5 giây sẽ làm ngập log
      if (req.path.startsWith('/health') || req.path.startsWith('/metrics')) return;
      getLogger().info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - started,
        },
        'http request',
      );
    });

    requestStorage.run({ requestId, correlationId, traceId }, () => next());
  }
}
