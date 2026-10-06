import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ServiceKitModule } from '@nekoflix/service-kit';
import { IdentityHandlers } from './events/identity.handlers';
import { MailerService } from './infra/mailer.service';
import { EmailRelayService } from './infra/email-relay.service';
import { NotificationController } from './api/notification.controller';
import { EmailOutbox, EmailOutboxSchema } from './persistence/schemas/email-outbox.schema';
import { Notification, NotificationSchema } from './persistence/schemas/notification.schema';

@Module({
  imports: [
    ServiceKitModule.forRoot({
      name: 'notification-service',
      version: '0.1.0',
      database: 'nekoflix_notification',
      // Service THUẦN CONSUMER: chỉ nghe event, chưa phát event nào.
      // Phase 4 sẽ bật outbox để phát notification.created cho realtime.
      outbox: false,
      consumeEvents: true,
    }),
    MongooseModule.forFeature([
      { name: EmailOutbox.name, schema: EmailOutboxSchema },
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [NotificationController],
  providers: [IdentityHandlers, MailerService, EmailRelayService],
})
export class AppModule {}
