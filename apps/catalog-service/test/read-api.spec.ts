import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose, { type Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { TitleService } from '../src/application/title.service';
import { EpisodeService } from '../src/application/episode.service';
import { Title, TitleSchema } from '../src/persistence/schemas/title.schema';
import { Episode, EpisodeSchema } from '../src/persistence/schemas/episode.schema';
import { Genre, GenreSchema } from '../src/persistence/schemas/genre.schema';

let replSet: MongoMemoryReplSet;
let Titles: Model<Title>;
let Episodes: Model<Episode>;
let Genres: Model<Genre>;
let titles: TitleService;
let episodes: EpisodeService;

let hoatHinhId: string;
let hanhDongId: string;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'test' });

  Titles = mongoose.model<Title>(Title.name, TitleSchema);
  Episodes = mongoose.model<Episode>(Episode.name, EpisodeSchema);
  Genres = mongoose.model<Genre>(Genre.name, GenreSchema);
  await Promise.all([Titles.createIndexes(), Episodes.createIndexes(), Genres.createIndexes()]);

  titles = new TitleService(Titles, Genres);
  episodes = new EpisodeService(Episodes);
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

beforeEach(async () => {
  const [a, b] = await Genres.create([
    { slug: 'hoat-hinh', name: { vi: 'Hoạt hình', en: 'Animation' }, order: 1 },
    { slug: 'hanh-dong', name: { vi: 'Hành động', en: 'Action' }, order: 2 },
  ]);
  hoatHinhId = String(a!._id);
  hanhDongId = String(b!._id);
});

/** Title tối thiểu, mặc định là phim lẻ đã công khai */
async function makeTitle(over: Partial<Record<string, unknown>> = {}) {
  const n = Math.random().toString(36).slice(2, 8);
  const [doc] = await Titles.create([
    {
      type: 'movie',
      slug: `phim-${n}`,
      title: `Phim ${n}`,
      maturityRating: 'PG',
      status: 'published',
      publishedAt: new Date(),
      releaseDate: new Date('2021-06-15T00:00:00Z'),
      movie: {
        assetId: null,
        runtimeSec: 7200,
        introStart: null,
        introEnd: null,
        creditsStart: null,
      },
      ...over,
    },
  ]);
  return doc!;
}

// ═══════════════════════════════════════════════════════════════
describe('titles.list', () => {
  it('chỉ trả title đã công khai', async () => {
    await makeTitle({ title: 'Đã công khai' });
    await makeTitle({ title: 'Bản nháp', status: 'draft' });
    await makeTitle({ title: 'Đã xoá', deletedAt: new Date() });

    const res = await titles.list({ genre: [], sort: 'popularity', limit: 24 });

    // Bản nháp lọt ra ngoài là lộ nội dung chưa biên tập xong
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.title).toBe('Đã công khai');
  });

  it('lọc theo thể loại bằng slug', async () => {
    await makeTitle({ title: 'Phim hoạt hình', genreIds: [hoatHinhId] });
    await makeTitle({ title: 'Phim hành động', genreIds: [hanhDongId] });

    const res = await titles.list({ genre: ['hoat-hinh'], sort: 'popularity', limit: 24 });
    expect(res.items.map((i) => i.title)).toEqual(['Phim hoạt hình']);
  });

  it('slug thể loại không tồn tại -> rỗng, KHÔNG trả về tất cả', async () => {
    await makeTitle();
    await makeTitle();

    // Bỏ qua bộ lọc sai sẽ khiến người dùng nhận về toàn bộ danh sách và
    // tưởng là kết quả đúng
    const res = await titles.list({ genre: ['khong-ton-tai'], sort: 'popularity', limit: 24 });
    expect(res.items).toHaveLength(0);
  });

  it('lọc theo khoảng năm', async () => {
    await makeTitle({ title: 'Cũ', releaseDate: new Date('2015-03-01T00:00:00Z') });
    await makeTitle({ title: 'Mới', releaseDate: new Date('2023-11-20T00:00:00Z') });

    const res = await titles.list({ genre: [], sort: 'popularity', limit: 24, yearFrom: 2020 });
    expect(res.items.map((i) => i.title)).toEqual(['Mới']);
  });

  it('sắp theo popularity giảm dần', async () => {
    await makeTitle({ title: 'Thấp', stats: { popularity: 1 } });
    await makeTitle({ title: 'Cao', stats: { popularity: 99 } });

    const res = await titles.list({ genre: [], sort: 'popularity', limit: 24 });
    expect(res.items.map((i) => i.title)).toEqual(['Cao', 'Thấp']);
  });
});

describe('Phân trang bằng cursor', () => {
  it('đi hết các trang, không lặp và không bỏ sót', async () => {
    for (let i = 0; i < 7; i++) await makeTitle({ stats: { popularity: 100 - i } });

    const seen: string[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 5; page++) {
      const res = await titles.list({ genre: [], sort: 'popularity', limit: 3, cursor });
      seen.push(...res.items.map((i) => i.id));
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('TRÙNG giá trị sắp xếp vẫn không bỏ sót bản ghi', async () => {
    // Đây là lý do cursor phải mang cả `_id`: chỉ mang popularity thì mọi
    // bản ghi cùng điểm với bản cuối trang trước sẽ bị nhảy qua.
    for (let i = 0; i < 6; i++) await makeTitle({ stats: { popularity: 50 } });

    const seen: string[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 5; page++) {
      const res = await titles.list({ genre: [], sort: 'popularity', limit: 2, cursor });
      seen.push(...res.items.map((i) => i.id));
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }

    expect(new Set(seen).size).toBe(6);
  });

  it('trang cuối trả nextCursor = null', async () => {
    await makeTitle();
    const res = await titles.list({ genre: [], sort: 'popularity', limit: 24 });
    expect(res.nextCursor).toBeNull();
  });

  it('cursor hỏng -> trả trang đầu, không ném lỗi', async () => {
    await makeTitle();
    // Link cũ sau khi đổi cách sắp xếp. Ném 400 thì người dùng thấy trang
    // lỗi mà không hiểu mình làm sai gì.
    const res = await titles.list({ genre: [], sort: 'popularity', limit: 24, cursor: 'rac!!!' });
    expect(res.items).toHaveLength(1);
  });
});

describe('titles.get', () => {
  it('lấy được bằng slug và bằng id, kèm thể loại đã nở', async () => {
    const doc = await makeTitle({ slug: 'bo-gia-2021', genreIds: [hoatHinhId] });

    const bySlug = await titles.get('bo-gia-2021');
    const byId = await titles.get(String(doc._id));

    expect(bySlug.title.id).toBe(byId.title.id);
    expect(bySlug.title.genres).toEqual([{ id: hoatHinhId, slug: 'hoat-hinh', name: 'Hoạt hình' }]);
  });

  it('KHÔNG để lọt field nội bộ ra ngoài hợp đồng', async () => {
    await makeTitle({ slug: 'kin-dao', searchText: 'bi mat noi bo' });

    const res = await titles.get('kin-dao');
    const keys = Object.keys(res.title);

    // searchText và deletedAt chỉ phục vụ nội bộ. Trả thẳng document là
    // cách rò rỉ mọi field thêm vào schema sau này.
    expect(keys).not.toContain('searchText');
    expect(keys).not.toContain('deletedAt');
    expect(keys).not.toContain('_id');
  });

  it('bản nháp -> NOT_FOUND', async () => {
    await makeTitle({ slug: 'nhap', status: 'draft' });
    await expect(titles.get('nhap')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('slug không tồn tại -> NOT_FOUND', async () => {
    await expect(titles.get('khong-co')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('series trả seasons, phim lẻ trả movie', async () => {
    await makeTitle({
      slug: 'series-abc',
      type: 'series',
      movie: null,
      seasons: [
        {
          seasonNumber: 1,
          name: 'Phần 1',
          description: '',
          posterUrl: null,
          airDate: null,
          episodeCount: 8,
        },
      ],
    });

    const series = await titles.get('series-abc');
    expect(series.title.movie).toBeNull();
    expect(series.title.seasons).toHaveLength(1);
    expect(series.title.runtimeSec).toBeNull();
  });
});

describe('titles.byIds', () => {
  it('giữ ĐÚNG thứ tự ids yêu cầu', async () => {
    const a = await makeTitle({ title: 'A', stats: { popularity: 1 } });
    const b = await makeTitle({ title: 'B', stats: { popularity: 99 } });
    const c = await makeTitle({ title: 'C', stats: { popularity: 50 } });

    // Bên gọi đã sắp sẵn (vd theo thời điểm xem gần nhất) và không sắp lại
    // được nếu catalog trả về lộn xộn
    const ids = [String(c._id), String(a._id), String(b._id)];
    const res = await titles.byIds({ ids });

    expect(res.items.map((i) => i.title)).toEqual(['C', 'A', 'B']);
  });

  it('id không tồn tại hoặc không công khai thì bỏ qua, không làm hỏng cả lô', async () => {
    const a = await makeTitle({ title: 'A' });
    const draft = await makeTitle({ title: 'Nháp', status: 'draft' });

    const res = await titles.byIds({
      ids: [String(a._id), String(draft._id), '65a1f0c3e4b0a1d2c3e4b0ff'],
    });

    expect(res.items.map((i) => i.title)).toEqual(['A']);
  });

  it('id sai định dạng không làm ném lỗi', async () => {
    const res = await titles.byIds({ ids: ['khong-phai-objectid'] });
    expect(res.items).toEqual([]);
  });
});

describe('episodes', () => {
  async function makeEpisode(titleId: string, season: number, ep: number, over = {}) {
    const [doc] = await Episodes.create([
      {
        titleId,
        seasonNumber: season,
        episodeNumber: ep,
        name: `S${season}E${ep}`,
        status: 'published',
        ...over,
      },
    ]);
    return doc!;
  }

  it('sắp theo season rồi tới số tập', async () => {
    const t = await makeTitle({ type: 'series', movie: null });
    const id = String(t._id);

    await makeEpisode(id, 2, 1);
    await makeEpisode(id, 1, 2);
    await makeEpisode(id, 1, 1);

    const res = await episodes.list({ titleId: id });
    expect(res.items.map((e) => e.name)).toEqual(['S1E1', 'S1E2', 'S2E1']);
  });

  it('lọc theo season', async () => {
    const t = await makeTitle({ type: 'series', movie: null });
    const id = String(t._id);
    await makeEpisode(id, 1, 1);
    await makeEpisode(id, 2, 1);

    const res = await episodes.list({ titleId: id, seasonNumber: 2 });
    expect(res.items.map((e) => e.name)).toEqual(['S2E1']);
  });

  it('tập nháp không lọt ra', async () => {
    const t = await makeTitle({ type: 'series', movie: null });
    const id = String(t._id);
    await makeEpisode(id, 1, 1, { status: 'draft' });

    expect((await episodes.list({ titleId: id })).items).toHaveLength(0);
  });

  it('titleId sai định dạng -> rỗng, không ném lỗi', async () => {
    expect((await episodes.list({ titleId: 'rac' })).items).toEqual([]);
  });

  it('get tập không tồn tại -> NOT_FOUND', async () => {
    await expect(episodes.get('65a1f0c3e4b0a1d2c3e4b0ff')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
