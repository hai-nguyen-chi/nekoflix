import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ServiceKitModule } from '@nekoflix/service-kit';
import { AuthController } from './auth/auth.controller';
import { JwtAuthGuard } from './auth/jwt.guard';
import { ProfileController } from './profiles/profile.controller';
import { OAuthController } from './auth/oauth.controller';
import { PasswordController } from './auth/password.controller';
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
  controllers: [
    GatewayHealthController,
    PingController,
    AuthController,
    ProfileController,
    OAuthController,
    PasswordController,
  ],
  // Guard TOÀN CỤC: mặc định MỌI route cần đăng nhập.
  // Route công khai phải đánh dấu @Public() tường minh.
  //
  // Mặc định đóng an toàn hơn mặc định mở: quên @Public() thì route bị
  // chặn (phát hiện ngay), còn quên @UseGuards() thì route hở (im lặng).
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
