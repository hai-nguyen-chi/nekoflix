import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Bản ghi của pong-service về những echo nó NHẬN ĐƯỢC qua event.
 *
 * Lưu ý: đây KHÔNG phải bản sao của `echoes` ở ping-service. Nó là dữ liệu
 * riêng của pong-service, nằm ở database riêng, và pong-service không bao giờ
 * đọc database của ping-service (ADR-012).
 */
@Schema({ collection: 'received', timestamps: true })
export class Received {
  @Prop({ type: String, required: true, unique: true })
  echoId!: string;

  @Prop({ type: String, required: true })
  message!: string;

  @Prop({ type: String, required: true })
  eventId!: string;

  /**
   * Số lần JetStream GIAO event này tới.
   *
   * > 1 nghĩa là event đã được giao lại (consumer chết giữa chừng, hoặc
   * ack_wait hết hạn). Dùng để chứng minh idempotency hoạt động: giao 3 lần
   * nhưng chỉ có 1 bản ghi.
   */
  @Prop({ type: Number, required: true, default: 1 })
  deliveryCount!: number;

  @Prop({ type: Date, required: true })
  receivedAt!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ReceivedDocument = HydratedDocument<Received>;
export const ReceivedSchema = SchemaFactory.createForClass(Received);

ReceivedSchema.index({ receivedAt: -1 });
