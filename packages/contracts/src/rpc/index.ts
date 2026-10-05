import type { z } from 'zod';
import {
  createEchoRequest,
  createEchoResponse,
  listEchoesResponse,
  listReceivedResponse,
  pingRequest,
  pingResponse,
} from './ping';

export * from './ping';

const empty = { parse: (v: unknown) => v } as unknown as z.ZodType<Record<string, never>>;

/**
 * Nguồn sự thật cho mọi NATS request/reply.
 *
 * Key chính là NATS subject. Client typed trong service-kit dùng registry này
 * để suy ra kiểu request/response, nên gọi sai subject hoặc sai payload là
 * lỗi compile-time, không phải lỗi runtime lúc 2 giờ sáng.
 */
export const RPC_REGISTRY = {
  'ping.echo.ping': { request: pingRequest, response: pingResponse },
  'ping.echo.create': { request: createEchoRequest, response: createEchoResponse },
  'ping.echo.list': { request: empty, response: listEchoesResponse },
  'pong.received.list': { request: empty, response: listReceivedResponse },
} as const;

export type RpcRegistry = typeof RPC_REGISTRY;
export type RpcSubject = keyof RpcRegistry;

export type RpcRequest<T extends RpcSubject> = z.infer<RpcRegistry[T]['request']>;
export type RpcResponse<T extends RpcSubject> = z.infer<RpcRegistry[T]['response']>;

export const ALL_RPC_SUBJECTS = Object.keys(RPC_REGISTRY) as RpcSubject[];
