import { Controller, Inject } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import {
  createEchoRequest,
  pingRequest,
  type CreateEchoResponse,
  type ListEchoesResponse,
  type PingResponse,
} from '@nekoflix/contracts';
import {
  Caller,
  RpcData,
  SERVICE_IDENTITY,
  type RpcMeta,
  type ServiceIdentity,
} from '@nekoflix/service-kit';
import { EchoService } from './echo.service';

/**
 * Biên NATS của service. CHỈ làm: parse payload, gọi domain, trả kết quả.
 * Không chứa business logic — nó nằm ở EchoService.
 */
@Controller()
export class EchoController {
  constructor(
    private readonly echoes: EchoService,
    @Inject(SERVICE_IDENTITY) private readonly identity: ServiceIdentity,
  ) {}

  @MessagePattern('ping.echo.ping')
  ping(@RpcData() raw: unknown, @Caller() caller?: RpcMeta): PingResponse {
    const { message } = pingRequest.parse(raw);
    return {
      reply: `pong: ${message}`,
      servedBy: `${this.identity.name}@${this.identity.version}`,
      servedAt: new Date().toISOString(),
      caller: {
        userId: caller?.userId ?? null,
        requestId: caller?.requestId ?? '',
        traceId: caller?.carrier?.['traceparent'] ?? '',
      },
    };
  }

  @MessagePattern('ping.echo.create')
  create(@RpcData() raw: unknown, @Caller() caller?: RpcMeta): Promise<CreateEchoResponse> {
    const input = createEchoRequest.parse(raw);
    return this.echoes.create(input, caller?.userId ?? 'anonymous');
  }

  @MessagePattern('ping.echo.list')
  list(): Promise<ListEchoesResponse> {
    return this.echoes.list();
  }
}
