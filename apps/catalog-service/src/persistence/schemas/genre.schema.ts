import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

/**
 * Thể loại phim.
 *
 * Tên lưu song ngữ ngay trong document thay vì để frontend tra bảng dịch:
 * danh sách thể loại là dữ liệu NỘI DUNG, do người biên tập đặt, không phải
 * chuỗi giao diện. "Chính kịch" hay "Phim bộ Hàn Quốc" là quyết định biên
 * tập, i18n của frontend không nên là nơi quyết định điều đó.
 */
@Schema({ collection: 'genres', timestamps: true })
export class Genre {
  @Prop({ type: String, required: true, unique: true })
  slug!: string;

  @Prop({
    type: { vi: { type: String, required: true }, en: { type: String, required: true } },
    required: true,
    _id: false,
  })
  name!: { vi: string; en: string };

  /** Thứ tự hiển thị trên trang duyệt. Nhỏ hơn đứng trước. */
  @Prop({ type: Number, default: 0 })
  order!: number;

  _id!: Types.ObjectId;
  createdAt!: Date;
  updatedAt!: Date;
}

export type GenreDocument = HydratedDocument<Genre>;
export const GenreSchema = SchemaFactory.createForClass(Genre);

GenreSchema.index({ order: 1 });
