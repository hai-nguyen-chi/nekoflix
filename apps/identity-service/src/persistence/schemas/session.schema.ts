import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

export type SessionStatus = 'active' | 'rotated' | 'revoked';

/**
 * Một refresh token = một document.
 *
 * Mô hình TOKEN FAMILY:
 *  - Mỗi lần ĐĂNG NHẬP sinh một `familyId` mới
 *  - Mỗi lần REFRESH tạo document mới CÙNG familyId, document cũ -> 'rotated'
 *  - Token đã 'rotated' mà bị dùng lại  =>  token bị đánh cắp
 *      -> thu hồi TOÀN BỘ family + gửi mail cảnh báo
 *
 * Vì sao refresh token là chuỗi ngẫu nhiên chứ không phải JWT: nó phải
 * THU HỒI ĐƯỢC NGAY. JWT stateless không thu hồi được nếu không tra DB —
 * mà đã phải tra DB thì JWT chẳng còn lợi thế gì.
 */
@Schema({ collection: 'sessions', timestamps: true })
export class Session {
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  /** Mọi token sinh ra từ một lần đăng nhập dùng chung giá trị này */
  @Prop({ type: String, required: true, index: true })
  familyId!: string;

  /** SHA-256 của token. KHÔNG BAO GIỜ lưu token thô. */
  @Prop({ type: String, required: true, unique: true })
  tokenHash!: string;

  /**
   * Hash của token MỚI sinh ra khi document này bị rotate.
   *
   * Dùng cho "grace period": nhiều tab cùng gọi refresh một lúc là chuyện
   * bình thường. Nếu coi mọi lần dùng lại là tấn công thì người dùng bị đá
   * ra oan. Trong 10 giây đầu, dùng lại token đã rotate sẽ nhận LẠI đúng
   * cặp token đã sinh, thay vì bị thu hồi.
   */
  @Prop({ type: String, default: null })
  nextTokenHash!: string | null;

  /** Access token tương ứng, chỉ để trả lại trong grace period */
  @Prop({ type: String, default: null })
  nextAccessToken!: string | null;

  @Prop({ type: String, enum: ['active', 'rotated', 'revoked'], default: 'active', index: true })
  status!: SessionStatus;

  @Prop({ type: String, default: '' })
  deviceLabel!: string;

  @Prop({ type: String, default: '' })
  ip!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: () => new Date() })
  lastUsedAt!: Date;

  /** Thời điểm bị rotate — mốc tính grace period */
  @Prop({ type: Date, default: null })
  rotatedAt!: Date | null;

  _id!: Types.ObjectId;
  createdAt!: Date;
  updatedAt!: Date;
}

export type SessionDocument = HydratedDocument<Session>;
export const SessionSchema = SchemaFactory.createForClass(Session);

SessionSchema.index({ userId: 1, status: 1 });
// MongoDB tự xoá document hết hạn -> không cần cron dọn
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
