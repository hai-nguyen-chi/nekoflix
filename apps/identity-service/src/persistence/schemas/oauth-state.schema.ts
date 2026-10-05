import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Trạng thái tạm của một phiên OAuth đang dở.
 *
 * Tài liệu thiết kế (docs/05) nói lưu ở Redis. Dùng MongoDB thay thế vì:
 *
 *  - `findOneAndDelete` cho đúng ngữ nghĩa cần thiết: đọc VÀ xoá trong một
 *    thao tác nguyên tử. State phải dùng được đúng một lần — nếu đọc rồi
 *    xoá ở hai bước, một request lặp lại có thể lọt qua khe hở giữa chúng.
 *  - TTL index tự dọn, không cần cron
 *  - identity-service chưa cần Redis cho việc gì khác; thêm một phụ thuộc
 *    cho mỗi thứ nhỏ là cách hạ tầng phình ra
 *
 * Redis sẽ vào khi có nhu cầu thật (cache, presence, rate limit).
 */
@Schema({ collection: 'oauthStates', timestamps: { createdAt: true, updatedAt: false } })
export class OAuthState {
  /** Chuỗi ngẫu nhiên gửi đi và nhận lại — chống CSRF trên luồng OAuth */
  @Prop({ type: String, required: true, unique: true })
  state!: string;

  @Prop({ type: String, required: true })
  provider!: string;

  /**
   * PKCE code_verifier.
   *
   * Nhà cung cấp chỉ nhận `code` kèm verifier khớp với challenge đã gửi.
   * Nhờ vậy kẻ chặn được `code` trên đường redirect vẫn không đổi được
   * nó lấy token — chúng không có verifier.
   */
  @Prop({ type: String, required: true })
  codeVerifier!: string;

  @Prop({ type: String, default: '/browse' })
  redirectPath!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  createdAt!: Date;
}

export type OAuthStateDocument = HydratedDocument<OAuthState>;
export const OAuthStateSchema = SchemaFactory.createForClass(OAuthState);
OAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Mã đổi dùng một lần, cấp sau khi OAuth thành công.
 *
 * Tồn tại để token KHÔNG bao giờ nằm trong URL. Mã này sống 60 giây và
 * chỉ đổi được đúng một lần.
 */
@Schema({ collection: 'oauthExchangeCodes', timestamps: { createdAt: true, updatedAt: false } })
export class OAuthExchangeCode {
  @Prop({ type: String, required: true, unique: true })
  code!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: Boolean, default: false })
  isNewUser!: boolean;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  createdAt!: Date;
}

export type OAuthExchangeCodeDocument = HydratedDocument<OAuthExchangeCode>;
export const OAuthExchangeCodeSchema = SchemaFactory.createForClass(OAuthExchangeCode);
OAuthExchangeCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
