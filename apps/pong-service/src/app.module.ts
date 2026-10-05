import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ServiceKitModule } from '@nekoflix/service-kit';
import { EchoHandlers } from './received/echo.handlers';
import { Received, ReceivedSchema } from './received/received.schema';
import { ReceivedController } from './received/received.controller';

@Module({
  imports: [
    ServiceKitModule.forRoot({
      name: 'pong-service',
      version: '0.1.0',
      database: 'nekoflix_pong',
      // pong-service chỉ NGHE, không phát event
      outbox: false,
      consumeEvents: true,
    }),
    MongooseModule.forFeature([{ name: Received.name, schema: ReceivedSchema }]),
  ],
  controllers: [ReceivedController],
  providers: [EchoHandlers],
})
export class AppModule {}
