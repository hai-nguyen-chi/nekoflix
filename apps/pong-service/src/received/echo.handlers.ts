import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import type { EventEnvelope, PingEchoCreatedV1 } from '@nekoflix/contracts';
import { OnEvent, getLogger } from '@nekoflix/service-kit';
import { Received } from './received.schema';

@Injectable()
export class EchoHandlers {
  constructor(@InjectModel(Received.name) private readonly model: Model<Received>) {}

  /**
   * Nhận event từ ping-service.
   *
   * Handler chạy BÊN TRONG transaction do IdempotencyService mở, và phải dùng
   * `session` được truyền vào. Ghi ngoài session đó thì bản ghi nằm ngoài
   * transaction — idempotency sẽ nói "đã xử lý" trong khi dữ liệu có thể
   * chưa được ghi.
   *
   * Handler KHÔNG cần tự kiểm tra trùng: JetStreamConsumer đã bọc sẵn. Nhưng
   * vẫn phải biết rằng nó có thể được gọi lại nếu process chết giữa chừng.
   */
  @OnEvent('ping.echo.created')
  async onEchoCreated(
    event: EventEnvelope<PingEchoCreatedV1>,
    session: ClientSession,
  ): Promise<void> {
    const { echoId, message } = event.data;

    await this.model.create(
      [
        {
          echoId,
          message,
          eventId: event.id,
          deliveryCount: 1,
          receivedAt: new Date(),
        },
      ],
      { session },
    );

    getLogger().info(
      { echoId, eventId: event.id, traceId: event.traceId },
      'pong-service đã nhận echo qua event',
    );
  }
}
