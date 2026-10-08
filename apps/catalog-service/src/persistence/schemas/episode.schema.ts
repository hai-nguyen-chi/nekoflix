import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

export const EPISODE_STATUSES = ['draft', 'published'] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

/**
 * Một tập của series.
 *
 * Tách khỏi `titles` vì một series có thể có hàng trăm tập, mỗi tập mang
 * metadata nặng, và chỉ được tải khi người xem chọn season — xem ghi chú ở
 * `title.schema.ts`.
 */
@Schema({ collection: 'episodes', timestamps: true })
export class Episode {
  @Prop({ type: String, required: true, index: true })
  titleId!: string;

  @Prop({ type: Number, required: true })
  seasonNumber!: number;

  @Prop({ type: Number, required: true })
  episodeNumber!: number;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, default: '' })
  description!: string;

  /** Ảnh đại diện của tập */
  @Prop({ type: String, default: null })
  stillUrl!: string | null;

  @Prop({ type: Date, default: null })
  airDate!: Date | null;

  @Prop({ type: Number, default: 0 })
  runtimeSec!: number;

  /** Trỏ sang `nekoflix_media`. Catalog chỉ giữ id, không đọc được DB đó. */
  @Prop({ type: String, default: null })
  assetId!: string | null;

  /** Mốc giây để Skip Intro / Next Episode. null = chưa gắn mốc. */
  @Prop({ type: Number, default: null })
  introStart!: number | null;

  @Prop({ type: Number, default: null })
  introEnd!: number | null;

  @Prop({ type: Number, default: null })
  creditsStart!: number | null;

  @Prop({ type: String, enum: EPISODE_STATUSES, default: 'draft' })
  status!: EpisodeStatus;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  _id!: Types.ObjectId;
  createdAt!: Date;
  updatedAt!: Date;
}

export type EpisodeDocument = HydratedDocument<Episode>;
export const EpisodeSchema = SchemaFactory.createForClass(Episode);

/**
 * Một series không thể có hai tập cùng số trong cùng season.
 *
 * `partialFilterExpression` để tập đã xoá mềm không chiếm chỗ số tập — nếu
 * không, xoá nhầm tập 5 rồi tạo lại sẽ bị chặn vĩnh viễn.
 */
EpisodeSchema.index(
  { titleId: 1, seasonNumber: 1, episodeNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);

// Danh sách tập của một season, đã sắp sẵn
EpisodeSchema.index({ titleId: 1, seasonNumber: 1, status: 1 });
