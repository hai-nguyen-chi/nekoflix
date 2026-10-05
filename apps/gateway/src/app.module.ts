import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ServiceKitModule } from '@nekoflix/service-kit';
import { RequestContextMiddleware } from './common/request-context.middleware';
import { GatewayHealthController } from './health/gateway-health.controller';
import { PingController } from './ping/ping.controller';

@Module({
  imports: [
    ServiceKitModule.forRoot({
      name: 'gateway',
      version: '0.1.0',
      // Gateway KHÔNG có database — nó không sở hữu dữ liệu nào cả
      database: undefined,
      outbox: false,
      consumeEvents: false,
    }),
  ],
  controllers: [GatewayHealthController, PingController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
