import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  createParamDecorator,
} from '@nestjs/common';
import { context as otelContext, trace } from '@opentelemetry/api';
import { Observable, type Subscription } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { requestStorage } from '../observability/logger';
import { extractRpcContext, isRpcPayload, type RpcMeta } from './rpc-payload';

/**
 * Khôi phục ngữ cảnh của bên gọi cho mỗi NATS request.
 *
 * Phải subscribe handler BÊN TRONG cả otel context lẫn AsyncLocalStorage.
 * Gọi `next.handle()` rồi mới bọc context sẽ không có tác dụng: observable
 * của Nest chỉ chạy handler lúc subscribe, mà lúc đó đã ra khỏi scope.
 */
@Injectable()
export class RpcContextInterceptor implements NestInterceptor {
  intercept(execCtx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (execCtx.getType() !== 'rpc') return next.handle();

    const raw = execCtx.switchToRpc().getData<unknown>();
    const meta = isRpcPayload(raw) ? raw.meta : undefined;
    const parentCtx = extractRpcContext(meta);

    const store = {
      requestId: meta?.requestId ?? randomUUID(),
      correlationId: meta?.correlationId ?? randomUUID(),
      traceId: trace.getSpanContext(parentCtx)?.traceId ?? '',
      ...(meta?.userId ? { userId: meta.userId } : {}),
    };

    return new Observable((subscriber) => {
      let sub: Subscription | undefined;
      otelContext.with(parentCtx, () => {
        requestStorage.run(store, () => {
          sub = next.handle().subscribe(subscriber);
        });
      });
      return () => sub?.unsubscribe();
    });
  }
}

/** Lấy phần `data` của payload, bỏ qua lớp meta */
export const RpcData = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const raw = ctx.switchToRpc().getData<unknown>();
  return isRpcPayload(raw) ? raw.data : raw;
});

/** Lấy ngữ cảnh người gọi (userId, requestId, ...) */
export const Caller = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RpcMeta | undefined => {
    const raw = ctx.switchToRpc().getData<unknown>();
    return isRpcPayload(raw) ? raw.meta : undefined;
  },
);
