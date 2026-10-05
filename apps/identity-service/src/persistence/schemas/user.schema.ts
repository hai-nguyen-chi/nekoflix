import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type UserStatus = 'active' | 'suspended' | 'deleted';
export type UserRoleValue = 'user' | 'moderator' | 'admin';

@Schema({ collection: 'users', timestamps: true })
export class User {
  /** Luôn lowercase. Chuẩn hoá ở tầng contract (zod .toLowerCase()) */
  @Prop({ type: String, required: true, unique: true })
  email!: string;

  /** null = chưa xác thực email -> vào được app nhưng KHÔNG xem được video */
  @Prop({ type: Date, default: null })
  emailVerifiedAt!: Date | null;

  /** null khi tài khoản chỉ đăng nhập bằng OAuth (Phase 1.5) */
  @Prop({ type: String, default: null })
  passwordHash!: string | null;

  @Prop({ type: String, required: true })
  displayName!: string;

  @Prop({ type: String, enum: ['user', 'moderator', 'admin'], default: 'user' })
  role!: UserRoleValue;

  @Prop({ type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' })
  status!: UserStatus;

  @Prop({ type: Date, default: null })
  lastLoginAt!: Date | null;

  /**
   * Vân tay các thiết bị đã từng đăng nhập thành công.
   *
   * Dùng để phát hiện "đăng nhập từ thiết bị mới" và gửi mail cảnh báo.
   * Chỉ lưu hash, không lưu User-Agent thô — tránh tích trữ dữ liệu
   * định danh không cần thiết. Trần 20 để document không phình.
   */
  @Prop({ type: [String], default: [] })
  knownDevices!: string[];

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ role: 1, status: 1 });
