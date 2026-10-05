import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout as rxTimeout, TimeoutError } from 'rxjs';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  isRpcError,
  type RpcRequest,
  type RpcResponse,
  type RpcSubject,
} from '@nekoflix/contracts';
import { AppError } from '../errors/app-error';
import { rpcDuration } from '../observability/metrics';
import { getLogger } from '../observability/logger';
import { BreakerOpenError, CircuitBreaker } from './circuit-breaker';
import { wrapRpcPayload, type RpcMeta } from './rpc-payload';

export const NATS_CLIENT = Symbol('NATS_CLIENT');

export interface RpcCallOptions {
  /** Mặc định 2000ms — timeout phải GIẢM DẦN khi đi sâu vào trong */
  timeoutMs?: number;
  meta?: Partial<RpcMeta>;
  /** Bỏ qua circuit breaker (dùng cho health check) */
  skipBreaker?: boolean;
}

/**
 * Client typed cho NATS request/reply.
 *
 * Subject và kiểu payload lấy từ RPC_REGISTRY trong @nekoflix/contracts, nên
 * gọi sai subject hoặc sai kiểu là lỗi compile-time — không phải lỗi runtime
 * lúc 2 giờ sáng.
 */
@Injectable()
export class RpcClient implements OnApplicationShutdown {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(@Inject(NATS_CLIENT) private readonly client: ClientProxy) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }

  async request<S extends RpcSubject>(
    subject: S,
    data: RpcRequest<S>,
    opts: RpcCallOptions = {},
  ): Promise<RpcResponse<S>> {
    const timeoutMs = opts.timeoutMs ?? 2_000;
    const breaker = opts.skipBreaker ? undefined : this.breakerFor(subject);
    const tracer = trace.getTracer('@nekoflix/service-kit');

    const call = async (): Promise<RpcResponse<S>> => {
      const stop = rpcDuration.startTimer({ subject });
      return tracer.startActiveSpan(`rpc ${subject}`, async (span) => {
        span.setAttribute('rpc.system', 'nats');
        span.setAttribute('rpc.method', subject);
        try {
          const payload = wrapRpcPayload(data, opts.meta);
          const result = await firstValueFrom(
            this.client.send<RpcResponse<S>>(subject, payload).pipe(rxTimeout(timeoutMs)),
          );
          stop({ status: 'ok' });
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (err) {
          stop({ status: 'error' });
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw this.normalizeError(err, subject, timeoutMs);
        } finally {
          span.end();
        }
      });
    };

    if (!breaker) return call();

    try {
      return await breaker.execute(call);
    } catch (err) {
      if (err instanceof BreakerOpenError) {
        getLogger().warn({ subject }, 'request bị chặn bởi circuit breaker');
        throw AppError.unavailable('Dịch vụ tạm thời không khả dụng. Vui lòng thử lại sau.');
      }
      throw err;
    }
  }

  /**
   * Gọi và trả `fallback` nếu lỗi.
   *
   * Dùng cho dependency KHÔNG thiết yếu. Phân loại thiết yếu/không thiết yếu
   * nằm ở docs/02-architecture.md §7.1 — nó quyết định UI trông ra sao khi
   * hệ thống hỏng một phần.
   */
  async requestOr<S extends RpcSubject, F>(
    subject: S,
    data: RpcRequest<S>,
    fallback: F,
    opts: RpcCallOptions = {},
  ): Promise<RpcResponse<S> | F> {
    try {
      return await this.request(subject, data, opts);
    } catch (err) {
      getLogger().warn(
        { subject, err: err instanceof Error ? err.message : String(err) },
        'dependency không thiết yếu lỗi, dùng fallback',
      );
      return fallback;
    }
  }

  private breakerFor(subject: string): CircuitBreaker {
    let breaker = this.breakers.get(subject);
    if (!breaker) {
      breaker = new CircuitBreaker({ name: subject });
      this.breakers.set(subject, breaker);
    }
    return breaker;
  }

  private normalizeError(err: unknown, subject: string, timeoutMs: number): Error {
    if (err instanceof TimeoutError) {
      return AppError.timeout(`"${subject}" không phản hồi trong ${timeoutMs}ms.`);
    }
    // Lỗi nghiệp vụ do service phía kia ném — giữ nguyên code
    if (isRpcError(err)) {
      return new AppError(err.code, err.message, err.details);
    }
    if (err instanceof AppError) return err;

    // Không có ai subscribe subject này -> service chưa chạy
    const message = err instanceof Error ? err.message : String(err);
    if (/no responders/i.test(message)) {
      return AppError.unavailable(`Dịch vụ phục vụ "${subject}" hiện không chạy.`);
    }
    getLogger().error({ subject, err: message }, 'NATS request lỗi không xác định');
    return AppError.internal();
  }
}
