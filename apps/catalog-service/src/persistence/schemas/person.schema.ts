import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

/**
 * Diễn viên, đạo diễn, biên kịch.
 *
 * `titles.credits` embed sẵn `name` nên trang chi tiết phim KHÔNG phải join
 * sang đây. Collection này chỉ cần khi mở trang riêng của một người, hoặc
 * khi đồng bộ lại metadata từ TMDB.
 */
@Schema({ collection: 'people', timestamps: true })
export class Person {
  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true, unique: true })
  slug!: string;

  @Prop({ type: String, default: null })
  profileUrl!: string | null;

  @Prop({ type: String, default: '' })
  biography!: string;

  @Prop({ type: Date, default: null })
  birthday!: Date | null;

  @Prop({
    type: { tmdbId: { type: Number, default: null } },
    default: () => ({ tmdbId: null }),
    _id: false,
  })
  externalIds!: { tmdbId: number | null };

  _id!: Types.ObjectId;
  createdAt!: Date;
  updatedAt!: Date;
}

export type PersonDocument = HydratedDocument<Person>;
export const PersonSchema = SchemaFactory.createForClass(Person);

// sparse: phần lớn người nhập tay không có tmdbId, và unique trên nhiều
// giá trị null sẽ chặn hết từ bản ghi thứ hai.
PersonSchema.index({ 'externalIds.tmdbId': 1 }, { sparse: true });
