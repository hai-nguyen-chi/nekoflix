import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

export type NotificationType =
  'welcome' | 'email_verified' | 'new_device_login' | 'security_alert' | 'password_reset';

/**
 * Thông báo trong app.
 *
 * Gắn với USER chứ không phải profile: đây là thông báo về tài khoản
 * (bảo mật, đăng nhập), mọi profile trong nhà đều nên thấy. Thông báo
 * theo profile (có tập mới của series trong watchlist) sẽ thêm ở Phase 2
 * với field `profileId`.
 */
@Schema({ collection: 'notifications', timestamps: true })
export class Notification {
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({ type: String, required: true })
  type!: NotificationType;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, required: true })
  body!: string;

  /** Dữ liệu để frontend dựng deep link */
  @Prop({ type: Object, default: {} })
  data!: Record<string, unknown>;

  @Prop({ type: Date, default: null })
  readAt!: Date | null;

  _id!: Types.ObjectId;
  createdAt!: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7_776_000 }); // 90 ngày
