import { Controller, Get, Inject, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';
import type { Response } from 'express';
import { NatsConnectionProvider } from '../nats/nats.connection';
import { registry } from '../observability/metrics';
import { SERVICE_IDENTITY, type ServiceIdentity } from '../tokens';

@Controller()
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongo: Connection,
    private readonly nats: NatsConnectionProvider,
    @Inject(SERVICE_IDENTITY) private readonly identity: ServiceIdentity,
  ) {}

  /** Process còn sống. KHÔNG kiểm tra dependency. */
  @Get('health/live')
  live() {
    return { status: 'ok', service: this.identity.name, version: this.identity.version };
  }

  /**
   * Sẵn sàng nhận việc: kết nối được Mongo + NATS.
   *
   * CỐ Ý không kiểm tra service khác. Nếu catalog báo not-ready vì identity
   * chết, hai service kéo nhau xuống và orchestrator restart vòng tròn.
   */
  @Get('health/ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks = {
      mongo: this.mongo.readyState === ConnectionStates.connected,
      nats: this.nats.isConnected(),
    };
    const ok = Object.values(checks).every(Boolean);
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', service: this.identity.name, checks };
  }

  @Get('metrics')
  async metrics(@Res() res: Response) {
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  }
}
