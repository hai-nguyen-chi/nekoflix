import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';
import { MATURITY_ORDER, type MaturityRating } from '@nekoflix/contracts';

export const TITLE_TYPES = ['movie', 'series'] as const;
export type TitleType = (typeof TITLE_TYPES)[number];

export const TITLE_STATUSES = ['draft', 'published', 'archived'] as const;
export type TitleStatus = (typeof TITLE_STATUSES)[number];

/** Trần kích thước mảng — xem ghi chú ở cuối file */
export const MAX_GENRES = 8;
export const MAX_KEYWORDS = 30;
export const MAX_CREDITS_PER_KIND = 30;
export const MAX_SEASONS = 50;

/**
 * Document trung tâm của catalog. Một title là phim lẻ hoặc phim bộ.
 *
 * Hai quyết định về hình dạng, cả hai đều cố ý:
 *
 * **Embed `seasons`, tách `episodes`.** Một series hiếm khi quá 50 season, và
 * giao diện luôn cần danh sách season ngay khi mở trang chi tiết. Ngược lại
 * một series có thể có hàng trăm episode, mỗi cái mang metadata nặng, và chỉ
 * được tải khi người xem chọn season.
 *
 * **Embed `credits` kèm sẵn `name`.** Trang chi tiết luôn hiện tên diễn viên;
 * lưu kèm tên thì không phải join sang `people`. Cái giá là đổi tên một người
 * phải cập nhật lại các title liên quan — chấp nhận được, vì chuyện đó hiếm
 * hơn nhiều so với việc mở trang chi tiết.
 */
@Schema({ collection: 'titles', timestamps: true })
export class Title {
  @Prop({ type: String, enum: TITLE_TYPES, required: true })
  type!: TitleType;

  @Prop({ type: String, required: true, unique: true })
  slug!: string;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, default: '' })
  originalTitle!: string;

  /**
   * Chuỗi phục vụ tìm kiếm tiếng Việt: chữ thường, ĐÃ BỎ DẤU, gộp tên phim +
   * tên gốc + tên diễn viên.
   *
   * Bỏ dấu lúc GHI chứ không lúc đọc: MongoDB text index không hiểu tiếng
   * Việt, nên "bo gia" sẽ không khớp "Bố Già" nếu chỉ đánh index trên `title`.
   * Trường này do tầng application dựng, schema chỉ lưu.
   *
   * KHÔNG đặt `index: 'text'` ở đây. MongoDB chỉ cho MỘT text index mỗi
   * collection, và khai báo ở đây sẽ chiếm chỗ của index gộp có trọng số
   * khai ở cuối file — index gộp sẽ không tạo được, âm thầm mất trọng số.
   */
  @Prop({ type: String, default: '' })
  searchText!: string;

  @Prop({ type: String, default: '' })
  description!: string;

  @Prop({ type: String, default: '' })
  tagline!: string;

  @Prop({ type: Date, default: null })
  releaseDate!: Date | null;

  /** Chỉ series đã kết thúc mới có */
  @Prop({ type: Date, default: null })
  endDate!: Date | null;

  /** ISO 3166-1 alpha-2 */
  @Prop({ type: [String], default: [] })
  country!: string[];

  /** ISO 639-1 */
  @Prop({ type: [String], default: [] })
  spokenLanguages!: string[];

  @Prop({ type: String, enum: MATURITY_ORDER, required: true })
  maturityRating!: MaturityRating;

  @Prop({ type: [String], default: [] })
  genreIds!: string[];

  @Prop({ type: [String], default: [] })
  keywords!: string[];

  @Prop({
    type: {
      cast: {
        type: [
          {
            personId: { type: String, required: true },
            name: { type: String, required: true },
            character: { type: String, default: '' },
            order: { type: Number, default: 0 },
          },
        ],
        default: [],
      },
      crew: {
        type: [
          {
            personId: { type: String, required: true },
            name: { type: String, required: true },
            job: { type: String, enum: ['director', 'writer', 'producer'], required: true },
          },
        ],
        default: [],
      },
    },
    default: () => ({ cast: [], crew: [] }),
    _id: false,
  })
  credits!: {
    cast: { personId: string; name: string; character: string; order: number }[];
    crew: { personId: string; name: string; job: 'director' | 'writer' | 'producer' }[];
  };

  @Prop({
    type: {
      posterUrl: { type: String, default: '' },
      backdropUrl: { type: String, default: '' },
      logoUrl: { type: String, default: null },
    },
    default: () => ({ posterUrl: '', backdropUrl: '', logoUrl: null }),
    _id: false,
  })
  images!: { posterUrl: string; backdropUrl: string; logoUrl: string | null };

  @Prop({
    type: {
      provider: { type: String, enum: ['youtube', 'local'], required: true },
      key: { type: String, required: true },
    },
    default: null,
    _id: false,
  })
  trailer!: { provider: 'youtube' | 'local'; key: string } | null;

  /**
   * Chỉ có khi `type === 'movie'`.
   *
   * `assetId` trỏ sang `nekoflix_media` — catalog KHÔNG đọc được database đó
   * (ADR-012). Nó chỉ giữ id và biết asset sẵn sàng qua event `media.asset.ready`.
   */
  @Prop({
    type: {
      assetId: { type: String, default: null },
      runtimeSec: { type: Number, default: 0 },
      introStart: { type: Number, default: null },
      introEnd: { type: Number, default: null },
      creditsStart: { type: Number, default: null },
    },
    default: null,
    _id: false,
  })
  movie!: {
    assetId: string | null;
    runtimeSec: number;
    introStart: number | null;
    introEnd: number | null;
    creditsStart: number | null;
  } | null;

  /** Chỉ có khi `type === 'series'` */
  @Prop({
    type: [
      {
        seasonNumber: { type: Number, required: true },
        name: { type: String, default: '' },
        description: { type: String, default: '' },
        posterUrl: { type: String, default: null },
        airDate: { type: Date, default: null },
        // Denormalize: đếm episode mỗi lần mở trang là một truy vấn thừa
        episodeCount: { type: Number, default: 0 },
      },
    ],
    default: null,
    _id: false,
  })
  seasons!:
    | {
        seasonNumber: number;
        name: string;
        description: string;
        posterUrl: string | null;
        airDate: Date | null;
        episodeCount: number;
      }[]
    | null;

  /**
   * Số liệu tổng hợp, cập nhật theo lô qua event — KHÔNG ghi từng lượt xem.
   *
   * Ghi từng lượt nghĩa là mỗi người bấm play là một lần ghi vào document
   * nóng nhất của hệ thống.
   */
  @Prop({
    type: {
      viewCount: { type: Number, default: 0 },
      viewCount7d: { type: Number, default: 0 },
      avgRating: { type: Number, default: 0 },
      ratingCount: { type: Number, default: 0 },
      likeCount: { type: Number, default: 0 },
      popularity: { type: Number, default: 0 },
    },
    default: () => ({
      viewCount: 0,
      viewCount7d: 0,
      avgRating: 0,
      ratingCount: 0,
      likeCount: 0,
      popularity: 0,
    }),
    _id: false,
  })
  stats!: {
    viewCount: number;
    viewCount7d: number;
    avgRating: number;
    ratingCount: number;
    likeCount: number;
    popularity: number;
  };

  @Prop({ type: String, enum: TITLE_STATUSES, default: 'draft', index: true })
  status!: TitleStatus;

  @Prop({ type: Date, default: null })
  publishedAt!: Date | null;

  @Prop({
    type: {
      tmdbId: { type: Number, default: null },
      imdbId: { type: String, default: null },
    },
    default: () => ({ tmdbId: null, imdbId: null }),
    _id: false,
  })
  externalIds!: { tmdbId: number | null; imdbId: string | null };

  /** Xoá mềm: media và activity cần thời gian xử lý event dọn dữ liệu */
  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  _id!: Types.ObjectId;
  createdAt!: Date;
  updatedAt!: Date;
}

export type TitleDocument = HydratedDocument<Title>;
export const TitleSchema = SchemaFactory.createForClass(Title);

// Trang duyệt: phim mới nhất
TitleSchema.index({ status: 1, publishedAt: -1 });
// Trang chủ: row trending / phổ biến
TitleSchema.index({ status: 1, 'stats.popularity': -1 });
// Row theo thể loại
TitleSchema.index({ genreIds: 1, status: 1, 'stats.popularity': -1 });
// Lọc phim lẻ / phim bộ theo năm
TitleSchema.index({ type: 1, status: 1, releaseDate: -1 });
TitleSchema.index({ 'externalIds.tmdbId': 1 }, { sparse: true });

/**
 * `searchText` nặng gấp 10 `description`.
 *
 * Không có trọng số thì một phim nhắc tên diễn viên trong phần mô tả sẽ xếp
 * ngang với chính phim của diễn viên đó.
 */
TitleSchema.index(
  { searchText: 'text', description: 'text' },
  { weights: { searchText: 10, description: 1 }, name: 'title_search' },
);

/**
 * Trần kích thước mảng, ép ở tầng schema.
 *
 * Mongoose không có `maxItems`, nên phải validate tay. Không có trần thì một
 * lần import TMDB lỗi có thể nhét 500 diễn viên vào một document, và giới hạn
 * 16MB của MongoDB sẽ là thứ phát hiện ra điều đó — quá muộn.
 */
const cap = (path: string, max: number): void => {
  TitleSchema.path(path).validate(
    (v: unknown[] | null) => v === null || v === undefined || v.length <= max,
    `${path} vượt quá ${max} phần tử`,
  );
};

cap('genreIds', MAX_GENRES);
cap('keywords', MAX_KEYWORDS);
cap('credits.cast', MAX_CREDITS_PER_KIND);
cap('credits.crew', MAX_CREDITS_PER_KIND);
cap('seasons', MAX_SEASONS);
