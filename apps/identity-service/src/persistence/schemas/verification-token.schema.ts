import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type VerificationTokenType = 'email_verify' | 'password_reset' | 'email_change';

/**
 * Token dùng MỘT LẦN gửi qua email.
 *
 * Giống refresh token: chỉ lưu SHA-256, không lưu token thô. Nếu database
 * bị lộ, kẻ tấn công vẫn không reset được mật khẩu của ai.
 */
@Schema({ collection: 'verificationTokens', timestamps: { createdAt: true, updatedAt: false } })
export class VerificationToken {
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({
    type: String,
    enum: ['email_verify', 'password_reset', 'email_change'],
    required: true,
  })
  type!: VerificationTokenType;

  @Prop({ type: String, required: true, unique: true })
  tokenHash!: string;

  /** Dữ liệu kèm theo, vd { newEmail } cho email_change */
  @Prop({ type: Object, default: null })
  payload!: Record<string, unknown> | null;

  /** Khác null = đã dùng. Dùng lại -> 410 TOKEN_CONSUMED */
  @Prop({ type: Date, default: null })
  consumedAt!: Date | null;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  createdAt!: Date;
}

export type VerificationTokenDocument = HydratedDocument<VerificationToken>;
export const VerificationTokenSchema = SchemaFactory.createForClass(VerificationToken);

VerificationTokenSchema.index({ userId: 1, type: 1 });
VerificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
