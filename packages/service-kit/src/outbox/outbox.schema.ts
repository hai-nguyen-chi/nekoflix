import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type OutboxStatus = 'pending' | 'publishing' | 'published' | 'failed';

/**
 * Transactional Outbox.
 *
 * Tồn tại để giải bài toán dual write: ghi DB và phát event phải nguyên tử.
 * Ghi DB rồi publish là SAI — process chết giữa hai bước thì event mất vĩnh
 * viễn, và hệ thống lệch mà không ném ra lỗi nào.
 *
 * Collection này có ở MỌI database service.
 */
@Schema({ collection: 'outbox', timestamps: { createdAt: true, updatedAt: false } })
export class OutboxEvent {
  /**
   * UUID — trở thành envelope.id, và là msgID để NATS khử trùng.
   *
   * Tên là `eventId` chứ KHÔNG phải `id`: Mongoose có sẵn một virtual tên
   * `id` (chuỗi của _id). Đặt trùng tên làm TypeScript suy ra kiểu `any`
   * cho field này — mất sạch type-safety ở đúng chỗ quan trọng nhất.
   */
  @Prop({ type: String, required: true, unique: true })
  eventId!: string;

  /** vd 'identity.user.registered' */
  @Prop({ type: String, required: true })
  type!: string;

  @Prop({ type: Number, required: true })
  version!: number;

  /** Thời điểm sự kiện XẢY RA, không phải lúc publish */
  @Prop({ type: Date, required: true })
  occurredAt!: Date;

  @Prop({ type: String, required: true })
  producer!: string;

  @Prop({ type: String, default: '' })
  traceId!: string;

  /** W3C traceparent của bên phát — để consumer nối đúng span cha */
  @Prop({ type: String, default: null })
  traceparent!: string | null;

  @Prop({ type: String, default: '' })
  correlationId!: string;

  @Prop({ type: String, default: null })
  causationId!: string | null;

  @Prop({ type: Object, required: true })
  data!: Record<string, unknown>;

  @Prop({
    type: String,
    enum: ['pending', 'publishing', 'published', 'failed'],
    required: true,
    default: 'pending',
    index: true,
  })
  status!: OutboxStatus;

  @Prop({ type: Number, required: true, default: 0 })
  attempts!: number;

  /** Thời điểm relay nhận claim — dùng để thu hồi bản ghi kẹt */
  @Prop({ type: Date, default: null })
  claimedAt!: Date | null;

  @Prop({ type: String, default: null })
  lastError!: string | null;

  @Prop({ type: Date, default: null })
  publishedAt!: Date | null;

  createdAt!: Date;
}

export type OutboxEventDocument = HydratedDocument<OutboxEvent>;
export const OutboxEventSchema = SchemaFactory.createForClass(OutboxEvent);

// Relay quét theo đây
OutboxEventSchema.index({ status: 1, createdAt: 1 });
// Dọn bản ghi đã publish sau 7 ngày
OutboxEventSchema.index({ publishedAt: 1 }, { expireAfterSeconds: 604_800 });
