import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';
import { MATURITY_ORDER, type MaturityRating } from '@nekoflix/contracts';

/**
 * Hồ sơ xem trong một tài khoản.
 *
 * MỌI dữ liệu cá nhân hoá gắn với PROFILE, không phải account: tiến độ xem,
 * watchlist, đánh giá, gợi ý. Nhờ vậy cả nhà dùng chung một tài khoản mà
 * gợi ý phim không lẫn lộn.
 *
 * Các service khác (activity, reco) chỉ lưu `profileId` — chúng không đọc
 * được collection này (ADR-012), và biết profile bị xoá qua event.
 */
@Schema({ collection: 'profiles', timestamps: true })
export class Profile {
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, default: 'avatar-01' })
  avatarKey!: string;

  @Prop({ type: Boolean, default: false })
  isKid!: boolean;

  @Prop({ type: String, enum: MATURITY_ORDER, default: 'NC-17' })
  maturityLimit!: MaturityRating;

  @Prop({ type: String, enum: ['vi', 'en'], default: 'vi' })
  language!: 'vi' | 'en';

  /** argon2id của PIN 4 số. null = không đặt PIN. */
  @Prop({ type: String, default: null })
  pinHash!: string | null;

  /** Xoá mềm: activity/reco cần thời gian xử lý event dọn dữ liệu */
  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  _id!: Types.ObjectId;
  createdAt!: Date;
  updatedAt!: Date;
}

export type ProfileDocument = HydratedDocument<Profile>;
export const ProfileSchema = SchemaFactory.createForClass(Profile);

ProfileSchema.index({ userId: 1, deletedAt: 1 });
// Trùng tên trong cùng tài khoản gây nhầm lẫn khi chọn profile.
// partialFilterExpression: profile đã xoá không chiếm tên nữa.
ProfileSchema.index(
  { userId: 1, name: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
