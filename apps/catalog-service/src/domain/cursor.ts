import type { TitleSummary } from '@nekoflix/contracts';

/**
 * Cursor cho phân trang.
 *
 * Nội dung là **giá trị của trường đang sắp** cộng với `_id` làm mốc phá hoà.
 * Chỉ mang `_id` là không đủ: hai title có thể cùng `stats.popularity`, và khi
 * đó không biết cái nào đứng trước — trang sau sẽ lặp hoặc bỏ sót.
 *
 * Mã base64url rồi mới trả ra ngoài. Không phải để giấu (ai cũng giải được),
 * mà để client KHÔNG tự đoán ra cấu trúc rồi tự chế cursor. Đổi cách sắp xếp
 * sau này sẽ làm mọi cursor tự chế gãy im lặng.
 */
export interface Cursor {
  /** Giá trị trường sắp xếp tại bản ghi cuối trang trước */
  v: string | number | null;
  /** `_id` của bản ghi cuối trang trước */
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

/**
 * Giải mã. Trả `null` khi cursor hỏng — KHÔNG ném lỗi.
 *
 * Cursor hỏng gần như luôn là do client giữ link cũ sau khi đổi cách sắp xếp.
 * Trả về trang đầu thì người dùng thấy kết quả; ném 400 thì họ thấy trang lỗi
 * mà không hiểu mình làm sai gì.
 */
export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      typeof (parsed as Cursor).id === 'string'
    ) {
      return parsed as Cursor;
    }
    return null;
  } catch {
    return null;
  }
}

/** Trường MongoDB tương ứng mỗi kiểu sắp xếp, kèm chiều */
export const SORT_FIELDS = {
  popularity: { field: 'stats.popularity', direction: -1 },
  newest: { field: 'publishedAt', direction: -1 },
  rating: { field: 'stats.avgRating', direction: -1 },
  title: { field: 'title', direction: 1 },
} as const satisfies Record<string, { field: string; direction: 1 | -1 }>;

export type SortKey = keyof typeof SORT_FIELDS;

/**
 * Lấy giá trị trường sắp xếp từ một title đã map, để dựng cursor cho trang sau.
 *
 * Nhận bản ĐÃ MAP chứ không phải document thô: hàm này thuần, không biết
 * Mongoose, nên không đọc được `stats.popularity` của document gốc. Service
 * truyền vào giá trị đó.
 */
export function buildNextCursor(
  items: TitleSummary[],
  sortValues: Map<string, string | number | null>,
  hasMore: boolean,
): string | null {
  if (!hasMore || items.length === 0) return null;
  const last = items[items.length - 1]!;
  return encodeCursor({ v: sortValues.get(last.id) ?? null, id: last.id });
}
