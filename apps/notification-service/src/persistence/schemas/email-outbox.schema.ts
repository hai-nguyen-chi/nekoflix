import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type EmailStatus = 'pending' | 'sending' | 'sent' | 'failed';

/**
 * Hàng đợi email — cùng một pattern với Transactional Outbox.
 *
 * VÌ SAO KHÔNG GỬI THẲNG TRONG HANDLER:
 *
 * Handler chạy bên trong transaction do IdempotencyService mở. Gửi email ở
 * đó thì:
 *   - Transaction rollback sau khi email đã bay đi -> không thu lại được,
 *     người dùng nhận email cho một sự kiện không xảy ra
 *   - Hoặc email gửi xong nhưng transaction abort -> processedEvents cũng
 *     rollback -> JetStream giao lại -> gửi email LẦN HAI
 *
 * Đây đúng là bài toán dual-write mà outbox sinh ra để giải. Nên: handler
 * chỉ GHI một dòng vào đây (trong transaction), một relay riêng đọc và gửi.
 *
 * `eventId` unique khiến event bị giao lại không tạo thêm email mới.
 */
@Schema({ collection: 'emailOutbox', timestamps: true })
export class EmailOutbox {
  /** Id của event đã sinh ra email này — khoá chống trùng */
  @Prop({ type: String, required: true, unique: true })
  eventId!: string;

  @Prop({ type: String, required: true })
  to!: string;

  @Prop({ type: String, required: true })
  subject!: string;

  @Prop({ type: String, required: true })
  html!: string;

  @Prop({ type: String, required: true })
  text!: string;

  /** Loại email, để thống kê và lọc log */
  @Prop({ type: String, required: true })
  template!: string;

  @Prop({
    type: String,
    enum: ['pending', 'sending', 'sent', 'failed'],
    default: 'pending',
    index: true,
  })
  status!: EmailStatus;

  @Prop({ type: Number, default: 0 })
  attempts!: number;

  @Prop({ type: Date, default: null })
  claimedAt!: Date | null;

  @Prop({ type: String, default: null })
  lastError!: string | null;

  @Prop({ type: Date, default: null })
  sentAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type EmailOutboxDocument = HydratedDocument<EmailOutbox>;
export const EmailOutboxSchema = SchemaFactory.createForClass(EmailOutbox);

EmailOutboxSchema.index({ status: 1, createdAt: 1 });
// Dọn email đã gửi sau 30 ngày
EmailOutboxSchema.index({ sentAt: 1 }, { expireAfterSeconds: 2_592_000 });
