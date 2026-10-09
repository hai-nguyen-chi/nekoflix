import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type FilterQuery, type Model } from 'mongoose';
import type {
  GetEpisodeResponse,
  ListEpisodesRequest,
  ListEpisodesResponse,
} from '@nekoflix/contracts';
import { AppError } from '@nekoflix/service-kit';
import { Episode } from '../persistence/schemas/episode.schema';
import { toEpisode } from '../domain/title-mapper';

const PUBLIC: FilterQuery<Episode> = { status: 'published', deletedAt: null };

@Injectable()
export class EpisodeService {
  constructor(@InjectModel(Episode.name) private readonly episodes: Model<Episode>) {}

  /**
   * Danh sách tập, đã sắp sẵn theo season rồi tới số tập.
   *
   * Sắp ở database chứ không ở giao diện: thứ tự tập là thuộc tính của dữ
   * liệu, và mỗi nơi hiển thị tự sắp lại là mỗi nơi có cơ hội sắp sai.
   */
  async list(input: ListEpisodesRequest): Promise<ListEpisodesResponse> {
    if (!Types.ObjectId.isValid(input.titleId)) return { items: [] };

    const docs = await this.episodes
      .find({
        ...PUBLIC,
        titleId: input.titleId,
        ...(input.seasonNumber !== undefined ? { seasonNumber: input.seasonNumber } : {}),
      })
      .sort({ seasonNumber: 1, episodeNumber: 1 })
      .lean();

    return {
      items: docs.map((d) => toEpisode({ ...d, id: String(d._id) })),
    };
  }

  async get(episodeId: string): Promise<GetEpisodeResponse> {
    if (!Types.ObjectId.isValid(episodeId)) throw AppError.notFound('Không tìm thấy tập phim.');

    const doc = await this.episodes
      .findOne({ ...PUBLIC, _id: new Types.ObjectId(episodeId) })
      .lean();
    if (!doc) throw AppError.notFound('Không tìm thấy tập phim.');

    return { episode: toEpisode({ ...doc, id: String(doc._id) }) };
  }
}
