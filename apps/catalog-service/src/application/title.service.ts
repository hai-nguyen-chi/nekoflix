import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type FilterQuery, type Model } from 'mongoose';
import {
  type GetTitleResponse,
  type ListTitlesRequest,
  type ListTitlesResponse,
  type PublicGenre,
  type TitlesByIdsRequest,
  type TitlesByIdsResponse,
} from '@nekoflix/contracts';
import { AppError } from '@nekoflix/service-kit';
import { Title } from '../persistence/schemas/title.schema';
import { Genre } from '../persistence/schemas/genre.schema';
import { SORT_FIELDS, buildNextCursor, decodeCursor } from '../domain/cursor';
import { orderByIds, toDetail, toSummary, type TitleRow } from '../domain/title-mapper';

/** Chỉ title đã công khai mới ra khỏi service này */
const PUBLIC: FilterQuery<Title> = { status: 'published', deletedAt: null };

@Injectable()
export class TitleService {
  constructor(
    @InjectModel(Title.name) private readonly titles: Model<Title>,
    @InjectModel(Genre.name) private readonly genres: Model<Genre>,
  ) {}

  async list(input: ListTitlesRequest): Promise<ListTitlesResponse> {
    const filter: FilterQuery<Title> = { ...PUBLIC };

    if (input.type) filter.type = input.type;
    if (input.rating) filter.maturityRating = input.rating;
    if (input.genre.length > 0) {
      const ids = await this.genreIdsOf(input.genre);
      // Không tìm thấy slug nào -> kết quả rỗng, KHÔNG phải bỏ qua bộ lọc.
      // Bỏ qua thì người dùng lọc sai lại nhận về toàn bộ danh sách.
      filter.genreIds = { $in: ids };
    }
    if (input.yearFrom !== undefined || input.yearTo !== undefined) {
      filter.releaseDate = {
        ...(input.yearFrom !== undefined ? { $gte: new Date(Date.UTC(input.yearFrom, 0, 1)) } : {}),
        ...(input.yearTo !== undefined
          ? { $lte: new Date(Date.UTC(input.yearTo, 11, 31, 23, 59, 59)) }
          : {}),
      };
    }

    const sort = SORT_FIELDS[input.sort];
    const cursor = decodeCursor(input.cursor);

    if (cursor) {
      /**
       * Điều kiện "đứng sau bản ghi cuối trang trước".
       *
       * Hai nhánh vì có thể trùng giá trị sắp xếp: lấy tiếp những bản ghi có
       * giá trị nhỏ hơn (sắp giảm dần), CỘNG những bản ghi cùng giá trị nhưng
       * `_id` lớn hơn. Thiếu nhánh thứ hai thì mọi bản ghi trùng giá trị với
       * bản cuối trang trước sẽ bị nhảy qua.
       */
      const cmp = sort.direction === -1 ? '$lt' : '$gt';
      filter.$or = [
        { [sort.field]: { [cmp]: cursor.v } },
        { [sort.field]: cursor.v, _id: { $gt: new Types.ObjectId(cursor.id) } },
      ] as FilterQuery<Title>[];
    }

    // Lấy dư 1 bản ghi để biết còn trang sau hay không, mà không phải count()
    const docs = await this.titles
      .find(filter)
      .sort({ [sort.field]: sort.direction, _id: 1 })
      .limit(input.limit + 1)
      .lean();

    const hasMore = docs.length > input.limit;
    const page = hasMore ? docs.slice(0, input.limit) : docs;

    const items = page.map((d) => toSummary(this.row(d)));
    const sortValues = new Map(
      page.map((d) => [
        String(d._id),
        this.valueAt(d as unknown as Record<string, unknown>, sort.field),
      ]),
    );

    return { items, nextCursor: buildNextCursor(items, sortValues, hasMore) };
  }

  async get(idOrSlug: string): Promise<GetTitleResponse> {
    const doc = await this.titles
      .findOne({
        ...PUBLIC,
        ...(Types.ObjectId.isValid(idOrSlug)
          ? { $or: [{ _id: new Types.ObjectId(idOrSlug) }, { slug: idOrSlug }] }
          : { slug: idOrSlug }),
      })
      .lean();

    if (!doc) throw AppError.notFound('Không tìm thấy phim.');

    const row = this.row(doc);
    return { title: toDetail(row, await this.genresOf(row.genreIds ?? [])) };
  }

  async byIds(input: TitlesByIdsRequest): Promise<TitlesByIdsResponse> {
    const objectIds = input.ids.filter((id) => Types.ObjectId.isValid(id));
    if (objectIds.length === 0) return { items: [] };

    const docs = await this.titles
      .find({ ...PUBLIC, _id: { $in: objectIds.map((id) => new Types.ObjectId(id)) } })
      .lean();

    return {
      items: orderByIds(
        docs.map((d) => toSummary(this.row(d))),
        input.ids,
      ),
    };
  }

  // ─────────────────────────────────────────────────────────────
  /** Document thô -> object phẳng, `_id` thành chuỗi, để mapper thuần dùng */
  private row(doc: Record<string, unknown> & { _id: unknown }): TitleRow {
    return { ...doc, id: String(doc._id) } as unknown as TitleRow;
  }

  /** Đọc `stats.popularity` từ object lồng, theo chuỗi đường dẫn */
  private valueAt(doc: Record<string, unknown>, path: string): string | number | null {
    const v = path.split('.').reduce<unknown>((acc, k) => {
      if (acc !== null && typeof acc === 'object' && k in acc) {
        return (acc as Record<string, unknown>)[k];
      }
      return undefined;
    }, doc);

    if (typeof v === 'string' || typeof v === 'number') return v;
    if (v instanceof Date) return v.toISOString();
    return null;
  }

  private async genreIdsOf(slugs: string[]): Promise<string[]> {
    const docs = await this.genres
      .find({ slug: { $in: slugs } })
      .select('_id')
      .lean();
    return docs.map((d) => String(d._id));
  }

  private async genresOf(ids: string[]): Promise<PublicGenre[]> {
    if (ids.length === 0) return [];
    const docs = await this.genres
      .find({ _id: { $in: ids.filter((i) => Types.ObjectId.isValid(i)) } })
      .sort({ order: 1 })
      .lean();

    return docs.map((d) => ({ id: String(d._id), slug: d.slug, name: d.name.vi }));
  }
}
