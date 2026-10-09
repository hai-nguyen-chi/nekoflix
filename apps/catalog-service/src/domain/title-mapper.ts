import type {
  MaturityRating,
  PublicEpisode,
  PublicGenre,
  TitleDetail,
  TitleSummary,
  TitleType,
} from '@nekoflix/contracts';

/**
 * Chuyển document trong database sang hình dạng của hợp đồng.
 *
 * Thuần: nhận object đã được service chuyển `_id` thành chuỗi, không biết
 * Mongoose. Nhờ vậy test được mà không cần database.
 *
 * Đây cũng là lớp chặn cuối: field nào không có trong hợp đồng thì KHÔNG lọt
 * ra ngoài. Trả thẳng document là cách rò rỉ `searchText`, `deletedAt`, và
 * mọi thứ thêm vào schema sau này mà không ai để ý.
 */

export interface TitleRow {
  id: string;
  type: string;
  slug: string;
  title: string;
  originalTitle?: string;
  description?: string;
  tagline?: string;
  releaseDate?: Date | null;
  endDate?: Date | null;
  country?: string[];
  spokenLanguages?: string[];
  maturityRating: string;
  genreIds?: string[];
  keywords?: string[];
  credits?: {
    cast: { personId: string; name: string; character: string; order: number }[];
    crew: { personId: string; name: string; job: string }[];
  };
  images?: { posterUrl: string; backdropUrl: string; logoUrl: string | null };
  trailer?: { provider: string; key: string } | null;
  movie?: {
    assetId: string | null;
    runtimeSec: number;
    introStart: number | null;
    introEnd: number | null;
    creditsStart: number | null;
  } | null;
  seasons?:
    | {
        seasonNumber: number;
        name: string;
        description: string;
        posterUrl: string | null;
        airDate: Date | null;
        episodeCount: number;
      }[]
    | null;
  stats?: { avgRating: number; ratingCount: number; viewCount: number };
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Năm phát hành, suy từ `releaseDate`. Giao diện chỉ hiện năm. */
const yearOf = (d: Date | null | undefined): number | null => (d ? d.getUTCFullYear() : null);

export function toSummary(row: TitleRow): TitleSummary {
  return {
    id: row.id,
    type: row.type as TitleType,
    slug: row.slug,
    title: row.title,
    posterUrl: row.images?.posterUrl ?? '',
    backdropUrl: row.images?.backdropUrl ?? '',
    maturityRating: row.maturityRating as MaturityRating,
    year: yearOf(row.releaseDate),
    // Series không có độ dài chung — độ dài nằm ở từng tập
    runtimeSec: row.type === 'movie' ? (row.movie?.runtimeSec ?? null) : null,
  };
}

export function toDetail(row: TitleRow, genres: PublicGenre[]): TitleDetail {
  return {
    ...toSummary(row),
    originalTitle: row.originalTitle ?? '',
    description: row.description ?? '',
    tagline: row.tagline ?? '',
    releaseDate: iso(row.releaseDate),
    endDate: iso(row.endDate),
    country: row.country ?? [],
    spokenLanguages: row.spokenLanguages ?? [],
    genres,
    keywords: row.keywords ?? [],
    credits: {
      cast: row.credits?.cast ?? [],
      crew: (row.credits?.crew ?? []).map((c) => ({
        personId: c.personId,
        name: c.name,
        job: c.job as 'director' | 'writer' | 'producer',
      })),
    },
    images: row.images ?? { posterUrl: '', backdropUrl: '', logoUrl: null },
    trailer: row.trailer
      ? { provider: row.trailer.provider as 'youtube' | 'local', key: row.trailer.key }
      : null,
    movie: row.type === 'movie' ? (row.movie ?? null) : null,
    seasons:
      row.type === 'series'
        ? (row.seasons ?? []).map((s) => ({ ...s, airDate: iso(s.airDate) }))
        : null,
    stats: {
      avgRating: row.stats?.avgRating ?? 0,
      ratingCount: row.stats?.ratingCount ?? 0,
      viewCount: row.stats?.viewCount ?? 0,
    },
  };
}

export interface EpisodeRow {
  id: string;
  titleId: string;
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  description?: string;
  stillUrl?: string | null;
  airDate?: Date | null;
  runtimeSec?: number;
  assetId?: string | null;
  introStart?: number | null;
  introEnd?: number | null;
  creditsStart?: number | null;
}

export function toEpisode(row: EpisodeRow): PublicEpisode {
  return {
    id: row.id,
    titleId: row.titleId,
    seasonNumber: row.seasonNumber,
    episodeNumber: row.episodeNumber,
    name: row.name,
    description: row.description ?? '',
    stillUrl: row.stillUrl ?? null,
    airDate: iso(row.airDate),
    runtimeSec: row.runtimeSec ?? 0,
    assetId: row.assetId ?? null,
    introStart: row.introStart ?? null,
    introEnd: row.introEnd ?? null,
    creditsStart: row.creditsStart ?? null,
  };
}

/**
 * Sắp lại theo đúng thứ tự `ids` yêu cầu, bỏ qua id không tìm thấy.
 *
 * MongoDB trả về theo thứ tự tự nhiên của nó, không theo thứ tự `$in`. Bên gọi
 * (gateway dựng row "Xem tiếp") đã sắp sẵn theo thời điểm xem gần nhất và
 * không có cách nào sắp lại nếu catalog trả về lộn xộn.
 */
export function orderByIds<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return ids.map((id) => byId.get(id)).filter((i): i is T => i !== undefined);
}
