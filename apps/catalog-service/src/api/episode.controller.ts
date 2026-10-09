import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import {
  getEpisodeRequest,
  listEpisodesRequest,
  type GetEpisodeResponse,
  type ListEpisodesResponse,
} from '@nekoflix/contracts';
import { RpcData } from '@nekoflix/service-kit';
import { EpisodeService } from '../application/episode.service';

@Controller()
export class EpisodeController {
  constructor(private readonly episodes: EpisodeService) {}

  @MessagePattern('catalog.episodes.list')
  list(@RpcData() raw: unknown): Promise<ListEpisodesResponse> {
    return this.episodes.list(listEpisodesRequest.parse(raw));
  }

  @MessagePattern('catalog.episodes.get')
  get(@RpcData() raw: unknown): Promise<GetEpisodeResponse> {
    return this.episodes.get(getEpisodeRequest.parse(raw).episodeId);
  }
}
