import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { createEchoRequest, pingRequest } from '@nekoflix/contracts';
import { RpcClient, zodPipe } from '@nekoflix/service-kit';

/**
 * Walking skeleton của Phase 0.
 *
 * Gateway KHÔNG có database và KHÔNG chứa business logic — nó chỉ định tuyến
 * và ghép dữ liệu. Mỗi khi định viết `if` nghiệp vụ ở đây, hãy hỏi: logic
 * này thuộc về service nào?
 */
@Controller('v1/ping')
export class PingController {
  constructor(private readonly rpc: RpcClient) {}

  /** HTTP -> NATS request/reply -> ping-service */
  @Post()
  ping(@Body(zodPipe(pingRequest)) body: { message: string }) {
    return this.rpc.request('ping.echo.ping', body);
  }

  /** Ghi DB + outbox trong một transaction, rồi relay publish lên JetStream */
  @Post('echo')
  createEcho(
    @Body(zodPipe(createEchoRequest)) body: { message: string; failAfterWrite?: boolean },
  ) {
    return this.rpc.request('ping.echo.create', body);
  }

  @Get('echo')
  listEchoes() {
    return this.rpc.request('ping.echo.list', {});
  }

  /** Những gì pong-service nhận được qua event — đầu kia của đường dây */
  @Get('received')
  listReceived() {
    return this.rpc.request('pong.received.list', {});
  }

  /**
   * API composition: gộp dữ liệu từ HAI service, gọi SONG SONG.
   *
   * `ping` là thiết yếu — hỏng thì trả lỗi.
   * `pong` không thiết yếu — hỏng thì trả phần còn lại kèm cờ degraded.
   *
   * Phân loại này quyết định UI trông ra sao khi hệ thống hỏng một phần.
   */
  @Get('status')
  async status(@Query('degraded') _degraded?: string) {
    const [echoes, received] = await Promise.all([
      this.rpc.request('ping.echo.list', {}),
      this.rpc.requestOr('pong.received.list', {}, null),
    ]);

    return {
      data: {
        published: echoes.items.length,
        delivered: received?.items.length ?? null,
        degraded: received === null,
        pending: received ? echoes.items.length - received.items.length : null,
      },
    };
  }
}
