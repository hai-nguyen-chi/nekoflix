import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ServiceKitModule } from '@nekoflix/service-kit';
import { EchoController } from './echo/echo.controller';
import { Echo, EchoSchema } from './echo/echo.schema';
import { EchoService } from './echo/echo.service';

@Module({
  imports: [
    ServiceKitModule.forRoot({
      name: 'ping-service',
      version: '0.1.0',
      database: 'nekoflix_ping',
      outbox: true,
      // ping-service chỉ PHÁT event, không nghe
      consumeEvents: false,
    }),
    MongooseModule.forFeature([{ name: Echo.name, schema: EchoSchema }]),
  ],
  controllers: [EchoController],
  providers: [EchoService],
})
export class AppModule {}
