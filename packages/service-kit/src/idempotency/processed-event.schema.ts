import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Ghi nhận event đã xử lý.
 *
 * JetStream giao at-least-once: mỗi event SẼ có lúc được giao hai lần — khi
 * consumer xử lý xong nhưng chết trước khi ack, khi ack_wait hết hạn, khi
 * relay publish lại. Không phải "nếu", mà là "khi nào".
 */
@Schema({ collection: 'processedEvents', timestamps: false })
export class ProcessedEvent {
  @Prop({ type: String, required: true })
  eventId!: string;

  /** Cùng một event có thể được nhiều consumer trong cùng service xử lý */
  @Prop({ type: String, required: true })
  consumer!: string;

  @Prop({ type: String, required: true })
  eventType!: string;

  @Prop({ type: Date, required: true, default: () => new Date() })
  processedAt!: Date;
}

export type ProcessedEventDocument = HydratedDocument<ProcessedEvent>;
export const ProcessedEventSchema = SchemaFactory.createForClass(ProcessedEvent);

// KHÓA CHỐNG TRÙNG — toàn bộ cơ chế idempotency dựa vào index này
ProcessedEventSchema.index({ eventId: 1, consumer: 1 }, { unique: true });
ProcessedEventSchema.index({ processedAt: 1 }, { expireAfterSeconds: 2_592_000 }); // 30 ngày
