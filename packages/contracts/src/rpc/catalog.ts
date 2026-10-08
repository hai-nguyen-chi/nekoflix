import { z } from 'zod';
import { maturityRating } from './profile';

/**
 * Hợp đồng của catalog-service.
 *
 * RANH GIỚI QUAN TRỌNG: ở đây KHÔNG có `userState`, `inWatchlist`, `progress`
 * hay row "Xem tiếp". Những thứ đó thuộc activity-service và được gateway ghép
 * vào ([04 §3](../../../docs/04-api-specification.md)).
 *
 * Nhét chúng vào đây nghĩa là catalog phải hỏi activity trước khi trả lời —
 * một lời gọi đồng bộ cho mọi lần mở trang, và catalog chết theo activity.
 */

export const TITLE_TYPES = ['movie', 'series'] as const;
export const titleType = z.enum(TITLE_TYPES);
export type TitleType = z.infer<typeof titleType>;

export const TITLE_SORTS = ['popularity', 'newest', 'rating', 'title'] as const;
export const titleSort = z.enum(TITLE_SORTS);

/** Trần số bản ghi một lần gọi. Client xin hơn thì bị cắt về đây. */
export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 24;
/** `byIds` phục vụ composition — xin quá nhiều là dấu hiệu gọi sai chỗ */
export const MAX_BATCH_IDS = 100;

// ── Mảnh dùng lại ────────────────────────────────────────────────
export const publicGenre = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});
export type PublicGenre = z.infer<typeof publicGenre>;

/**
 * Bản rút gọn cho danh sách, row trang chủ, kết quả tìm kiếm.
 *
 * Tách khỏi `titleDetail` vì một row trang chủ có 20 phần tử — trả kèm
 * `description`, `credits`, `seasons` cho cả 20 là lãng phí băng thông cho
 * thứ giao diện không hiển thị.
 */
export const titleSummary = z.object({
  id: z.string(),
  type: titleType,
  slug: z.string(),
  title: z.string(),
  posterUrl: z.string(),
  backdropUrl: z.string(),
  maturityRating,
  /** null khi chưa có ngày phát hành */
  year: z.number().int().nullable(),
  /** Phim lẻ mới có. Series thì độ dài nằm ở từng tập. */
  runtimeSec: z.number().int().nullable(),
});
export type TitleSummary = z.infer<typeof titleSummary>;

export const titleDetail = titleSummary.extend({
  originalTitle: z.string(),
  description: z.string(),
  tagline: z.string(),
  releaseDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  country: z.array(z.string()),
  spokenLanguages: z.array(z.string()),
  genres: z.array(publicGenre),
  keywords: z.array(z.string()),
  credits: z.object({
    cast: z.array(
      z.object({
        personId: z.string(),
        name: z.string(),
        character: z.string(),
        order: z.number().int(),
      }),
    ),
    crew: z.array(
      z.object({
        personId: z.string(),
        name: z.string(),
        job: z.enum(['director', 'writer', 'producer']),
      }),
    ),
  }),
  images: z.object({
    posterUrl: z.string(),
    backdropUrl: z.string(),
    logoUrl: z.string().nullable(),
  }),
  trailer: z.object({ provider: z.enum(['youtube', 'local']), key: z.string() }).nullable(),
  /** Chỉ phim lẻ */
  movie: z
    .object({
      assetId: z.string().nullable(),
      runtimeSec: z.number().int(),
      introStart: z.number().int().nullable(),
      introEnd: z.number().int().nullable(),
      creditsStart: z.number().int().nullable(),
    })
    .nullable(),
  /** Chỉ series */
  seasons: z
    .array(
      z.object({
        seasonNumber: z.number().int(),
        name: z.string(),
        description: z.string(),
        posterUrl: z.string().nullable(),
        airDate: z.string().datetime().nullable(),
        episodeCount: z.number().int(),
      }),
    )
    .nullable(),
  stats: z.object({
    avgRating: z.number(),
    ratingCount: z.number().int(),
    viewCount: z.number().int(),
  }),
});
export type TitleDetail = z.infer<typeof titleDetail>;

export const publicEpisode = z.object({
  id: z.string(),
  titleId: z.string(),
  seasonNumber: z.number().int(),
  episodeNumber: z.number().int(),
  name: z.string(),
  description: z.string(),
  stillUrl: z.string().nullable(),
  airDate: z.string().datetime().nullable(),
  runtimeSec: z.number().int(),
  assetId: z.string().nullable(),
  introStart: z.number().int().nullable(),
  introEnd: z.number().int().nullable(),
  creditsStart: z.number().int().nullable(),
});
export type PublicEpisode = z.infer<typeof publicEpisode>;

/**
 * Phân trang bằng CURSOR, không phải `skip`/`offset`.
 *
 * `skip` phải đếm qua n bản ghi bị bỏ, nên trang càng sâu càng chậm. Nó còn
 * nhảy cóc hoặc lặp bản ghi khi dữ liệu đổi giữa hai lần gọi — mà trang duyệt
 * phim thì sắp theo `popularity`, một con số thay đổi liên tục.
 */
export const cursorPage = z.object({
  items: z.array(titleSummary),
  /** null = hết dữ liệu */
  nextCursor: z.string().nullable(),
});
export type CursorPage = z.infer<typeof cursorPage>;

// ── titles.list ──────────────────────────────────────────────────
export const listTitlesRequest = z.object({
  /** slug thể loại, lặp lại được */
  genre: z.array(z.string()).default([]),
  type: titleType.optional(),
  yearFrom: z.number().int().optional(),
  yearTo: z.number().int().optional(),
  rating: maturityRating.optional(),
  sort: titleSort.default('popularity'),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListTitlesRequest = z.infer<typeof listTitlesRequest>;
export const listTitlesResponse = cursorPage;
export type ListTitlesResponse = z.infer<typeof listTitlesResponse>;

// ── titles.get ───────────────────────────────────────────────────
export const getTitleRequest = z.object({
  /** Nhận cả ObjectId lẫn slug — giao diện dùng slug cho URL đẹp */
  idOrSlug: z.string().min(1),
});
export type GetTitleRequest = z.infer<typeof getTitleRequest>;
export const getTitleResponse = z.object({ title: titleDetail });
export type GetTitleResponse = z.infer<typeof getTitleResponse>;

// ── titles.byIds ─────────────────────────────────────────────────
/**
 * Batch — BẮT BUỘC phải có.
 *
 * Thiếu nó, gateway ghép row "Xem tiếp" sẽ gọi `titles.get` trong vòng lặp:
 * N+1 qua mạng, tệ hơn N+1 qua database rất nhiều.
 */
export const titlesByIdsRequest = z.object({
  ids: z.array(z.string()).min(1).max(MAX_BATCH_IDS),
});
export type TitlesByIdsRequest = z.infer<typeof titlesByIdsRequest>;
/**
 * Trả về theo ĐÚNG thứ tự `ids`, id không tìm thấy thì bỏ qua.
 *
 * Giữ thứ tự vì bên gọi đã sắp sẵn (vd theo thời điểm xem gần nhất) và
 * không có cách nào sắp lại nếu catalog trả về lộn xộn.
 */
export const titlesByIdsResponse = z.object({ items: z.array(titleSummary) });
export type TitlesByIdsResponse = z.infer<typeof titlesByIdsResponse>;

// ── titles.similar ───────────────────────────────────────────────
export const similarTitlesRequest = z.object({
  titleId: z.string(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(12),
});
export const similarTitlesResponse = z.object({ items: z.array(titleSummary) });
export type SimilarTitlesResponse = z.infer<typeof similarTitlesResponse>;

// ── episodes ─────────────────────────────────────────────────────
export const listEpisodesRequest = z.object({
  titleId: z.string(),
  seasonNumber: z.number().int().optional(),
});
export type ListEpisodesRequest = z.infer<typeof listEpisodesRequest>;
export const listEpisodesResponse = z.object({ items: z.array(publicEpisode) });
export type ListEpisodesResponse = z.infer<typeof listEpisodesResponse>;

export const getEpisodeRequest = z.object({ episodeId: z.string() });
export const getEpisodeResponse = z.object({ episode: publicEpisode });
export type GetEpisodeResponse = z.infer<typeof getEpisodeResponse>;

// ── search ───────────────────────────────────────────────────────
export const searchRequest = z.object({
  /**
   * Tối thiểu 2 ký tự. Một ký tự khớp gần như mọi thứ, vừa vô dụng vừa là
   * cách rẻ nhất để bắt server quét cả collection.
   */
  q: z.string().min(2).max(100),
  genre: z.array(z.string()).default([]),
  type: titleType.optional(),
  yearFrom: z.number().int().optional(),
  yearTo: z.number().int().optional(),
  rating: maturityRating.optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type SearchRequest = z.infer<typeof searchRequest>;
export const searchResponse = z.object({
  items: z.array(titleSummary),
  /** Tổng số khớp, để giao diện hiện "khoảng N kết quả" */
  total: z.number().int(),
});
export type SearchResponse = z.infer<typeof searchResponse>;

export const suggestRequest = z.object({
  q: z.string().min(2).max(100),
  limit: z.number().int().min(1).max(8).default(8),
});
export const suggestResponse = z.object({
  items: z.array(z.object({ id: z.string(), slug: z.string(), title: z.string() })),
});
export type SuggestResponse = z.infer<typeof suggestResponse>;

// ── rows (trang chủ) ─────────────────────────────────────────────
export const ROW_LAYOUTS = ['poster', 'backdrop', 'ranked'] as const;
export const rowLayout = z.enum(ROW_LAYOUTS);

/**
 * CHỈ các row catalog tự dựng được.
 *
 * Row "Xem tiếp" (`continue`) và "Danh sách của tôi" thuộc activity-service.
 * Gateway chèn chúng vào kết quả này — xem [14 §4](../../../docs/14-inter-service-communication.md).
 */
export const catalogRow = z.object({
  key: z.string(),
  title: z.string(),
  layout: rowLayout,
  items: z.array(titleSummary),
});
export type CatalogRow = z.infer<typeof catalogRow>;

export const getRowsRequest = z.object({
  /** Giới hạn độ tuổi của profile đang xem. Bỏ trống = khách chưa đăng nhập. */
  maxMaturity: maturityRating.optional(),
  itemsPerRow: z.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});
export type GetRowsRequest = z.infer<typeof getRowsRequest>;
export const getRowsResponse = z.object({
  /** Phim nổi bật trên đầu trang. null khi chưa có title nào published. */
  hero: titleDetail.nullable(),
  rows: z.array(catalogRow),
});
export type GetRowsResponse = z.infer<typeof getRowsResponse>;

// ── genres ───────────────────────────────────────────────────────
export const listGenresRequest = z.object({
  lang: z.enum(['vi', 'en']).default('vi'),
});
export const listGenresResponse = z.object({ items: z.array(publicGenre) });
export type ListGenresResponse = z.infer<typeof listGenresResponse>;

// ── admin ────────────────────────────────────────────────────────
export const upsertTitleRequest = z.object({
  type: titleType,
  slug: z.string().min(1),
  title: z.string().min(1),
  originalTitle: z.string().default(''),
  description: z.string().default(''),
  tagline: z.string().default(''),
  releaseDate: z.string().datetime().nullable().default(null),
  country: z.array(z.string()).default([]),
  spokenLanguages: z.array(z.string()).default([]),
  maturityRating,
  genreIds: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
});
export type UpsertTitleRequest = z.infer<typeof upsertTitleRequest>;

export const createTitleRequest = upsertTitleRequest;
export const updateTitleRequest = upsertTitleRequest.partial().extend({
  titleId: z.string(),
});
export const adminTitleResponse = z.object({ title: titleDetail });
export type AdminTitleResponse = z.infer<typeof adminTitleResponse>;

export const publishTitleRequest = z.object({
  titleId: z.string(),
  /** false = gỡ khỏi trang công khai */
  published: z.boolean().default(true),
});
export const publishTitleResponse = z.object({
  titleId: z.string(),
  status: z.enum(['draft', 'published', 'archived']),
});
export type PublishTitleResponse = z.infer<typeof publishTitleResponse>;

export const deleteTitleRequest = z.object({ titleId: z.string() });
export const deleteTitleResponse = z.object({ deleted: z.boolean() });
export type DeleteTitleResponse = z.infer<typeof deleteTitleResponse>;

export const importTmdbRequest = z.object({
  tmdbId: z.number().int().positive(),
  type: titleType,
});
export const importTmdbResponse = z.object({
  titleId: z.string(),
  /** false = title đã có, chỉ cập nhật metadata */
  created: z.boolean(),
});
export type ImportTmdbResponse = z.infer<typeof importTmdbResponse>;
