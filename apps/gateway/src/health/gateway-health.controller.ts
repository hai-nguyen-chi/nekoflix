import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { NatsConnectionProvider, registry } from '@nekoflix/service-kit';
import { Public } from '../auth/jwt.guard';

/**
 * Gateway không có database nên không dùng HealthController của service-kit.
 *
 * `ready` CỐ Ý không kiểm tra service phía sau. Nếu gateway báo not-ready vì
 * identity-service chết, orchestrator sẽ restart gateway — trong khi gateway
 * hoàn toàn khỏe và vẫn phục vụ được các route khác.
 */
// Health check và metrics PHẢI công khai: Docker healthcheck và Prometheus
// không có access token, và chặn chúng sẽ làm container không bao giờ healthy.
@Public()
@Controller()
export class GatewayHealthController {
  constructor(private readonly nats: NatsConnectionProvider) {}

  @Get('health/live')
  live() {
    return { status: 'ok', service: 'gateway' };
  }

  @Get('health/ready')
  ready(@Res({ passthrough: true }) res: Response) {
    const ok = this.nats.isConnected();
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', service: 'gateway', checks: { nats: ok } };
  }

  @Get('metrics')
  async metrics(@Res() res: Response) {
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  }
}
