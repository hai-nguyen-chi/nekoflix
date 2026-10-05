import { Catch, type ArgumentsHost, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { ZodError } from 'zod';
import { AppError, toRpcError } from '../errors/app-error';
import { currentRequestStore, getLogger } from '../observability/logger';

/**
 * Filter dùng chung cho cả HTTP (gateway) lẫn RPC (service).
 *
 * Trên app hybrid, filter global chạy cho cả hai loại context — nên phải
 * phân nhánh theo `host.getType()`, nếu không response HTTP sẽ bị trả về
 * dưới dạng Observable và request treo.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): Observable<never> | void {
    const normalized = normalize(exception);

    if (!(normalized instanceof AppError) || normalized.code === 'INTERNAL_ERROR') {
      getLogger().error(
        { err: exception instanceof Error ? exception.stack : String(exception) },
        'lỗi chưa xử lý',
      );
    }

    if (host.getType() === 'http') {
      const res = host.switchToHttp().getResponse<Response>();
      const store = currentRequestStore();
      res.status(normalized.httpStatus).json({
        error: {
          code: normalized.code,
          message: normalized.message,
          ...(normalized.details ? { details: normalized.details } : {}),
          ...(store ? { requestId: store.requestId } : {}),
        },
      });
      return;
    }

    // Context RPC: trả Observable lỗi để client của Nest nhận đúng payload
    return throwError(() => toRpcError(normalized));
  }
}

function normalize(exception: unknown): AppError {
  if (exception instanceof AppError) return exception;

  if (exception instanceof ZodError) {
    return AppError.validation(
      'Dữ liệu gửi lên không hợp lệ.',
      exception.issues.map((i) => ({ field: i.path.join('.') || '(root)', issue: i.message })),
    );
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = HTTP_STATUS_TO_CODE[status] ?? 'INTERNAL_ERROR';
    return new AppError(code, exception.message);
  }

  return AppError.internal();
}

const HTTP_STATUS_TO_CODE: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
  504: 'UPSTREAM_TIMEOUT',
};
