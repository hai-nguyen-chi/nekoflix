import { z } from 'zod';
import { maturityRating } from '../rpc/profile';
import { titleType } from '../rpc/catalog';

/**
 * Event do catalog-service phát ra.
 *
 * Nguyên tắc như mọi event khác: payload phải TỰ CHỨA ĐỦ dữ liệu để consumer
 * làm xong việc của nó. Cụ thể ở đây:
 *
 *  - notification nghe `catalog.episode.published` để báo người theo dõi, nên
 *    payload mang sẵn **tên phim** — nếu không, nó phải gọi ngược về catalog
 *    và email không gửi được khi catalog đang chết.
 *
 *  - activity dựng read model `titleProjections` từ `catalog.title.updated`,
 *    nên payload mang sẵn **đúng những field read model cần**. Chỉ gửi id thì
 *    read model mất hết ý nghĩa: nó tồn tại để hỏi catalog ít đi, chứ không
 *    phải để hỏi nhiều hơn.
 */

/**
 * Bản chiếu của title sang service khác.
 *
 * Đây là "mặt công khai" của một title trong thế giới event. Giữ nó NHỎ và
 * ổn định: mỗi field thêm vào đây là một field mà mọi read model phải lưu,
 * và là một lý do nữa để phải phát event khi nó đổi.
 */
export const titleProjection = z.object({
  titleId: z.string(),
  slug: z.string(),
  type: titleType,
  title: z.string(),
  posterUrl: z.string(),
  backdropUrl: z.string(),
  maturityRating,
  year: z.number().int().nullable(),
  genreIds: z.array(z.string()),
});
export type TitleProjection = z.infer<typeof titleProjection>;

export const titlePublishedV1 = titleProjection.extend({
  publishedAt: z.string().datetime(),
});
export type TitlePublishedV1 = z.infer<typeof titlePublishedV1>;

/**
 * Sửa metadata của title đã công khai.
 *
 * `changedFields` để consumer bỏ qua sớm: cache trang chủ chỉ cần dựng lại khi
 * `posterUrl` hoặc `title` đổi, không cần khi sửa mỗi `description`.
 */
export const titleUpdatedV1 = titleProjection.extend({
  changedFields: z.array(z.string()),
  updatedAt: z.string().datetime(),
});
export type TitleUpdatedV1 = z.infer<typeof titleUpdatedV1>;

/** Gỡ khỏi trang công khai nhưng KHÔNG xoá — dữ liệu người dùng giữ nguyên */
export const titleUnpublishedV1 = z.object({
  titleId: z.string(),
  slug: z.string(),
  unpublishedAt: z.string().datetime(),
});
export type TitleUnpublishedV1 = z.infer<typeof titleUnpublishedV1>;

/**
 * Xoá hẳn.
 *
 * media nghe để dọn asset, activity nghe để dọn watchlist/tiến độ trỏ tới nó.
 * Khác hẳn `unpublished` ở chỗ đây là lệnh dọn dẹp, không phải đổi trạng thái
 * hiển thị.
 */
export const titleDeletedV1 = z.object({
  titleId: z.string(),
  slug: z.string(),
  /** Để media biết cần dọn bao nhiêu asset mà không phải hỏi lại */
  episodeIds: z.array(z.string()),
  deletedAt: z.string().datetime(),
});
export type TitleDeletedV1 = z.infer<typeof titleDeletedV1>;

export const episodePublishedV1 = z.object({
  episodeId: z.string(),
  titleId: z.string(),
  /** Tên phim, mang sẵn để notification không phải gọi ngược về catalog */
  titleName: z.string(),
  titleSlug: z.string(),
  seasonNumber: z.number().int(),
  episodeNumber: z.number().int(),
  name: z.string(),
  publishedAt: z.string().datetime(),
});
export type EpisodePublishedV1 = z.infer<typeof episodePublishedV1>;
