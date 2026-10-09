import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import {
  getTitleRequest,
  listTitlesRequest,
  titlesByIdsRequest,
  type GetTitleResponse,
  type ListTitlesResponse,
  type TitlesByIdsResponse,
} from '@nekoflix/contracts';
import { RpcData } from '@nekoflix/service-kit';
import { TitleService } from '../application/title.service';

/**
 * Biên NATS. Parse payload bằng schema trong hợp đồng rồi gọi xuống —
 * không có logic nghiệp vụ nào ở đây.
 *
 * `parse` chứ không phải `safeParse`: payload sai hình dạng là lỗi lập trình
 * của bên gọi, và AllExceptionsFilter đã biến ZodError thành
 * VALIDATION_FAILED kèm đường dẫn field sai.
 */
@Controller()
export class TitleController {
  constructor(private readonly titles: TitleService) {}

  @MessagePattern('catalog.titles.list')
  list(@RpcData() raw: unknown): Promise<ListTitlesResponse> {
    return this.titles.list(listTitlesRequest.parse(raw));
  }

  @MessagePattern('catalog.titles.get')
  get(@RpcData() raw: unknown): Promise<GetTitleResponse> {
    return this.titles.get(getTitleRequest.parse(raw).idOrSlug);
  }

  @MessagePattern('catalog.titles.byIds')
  byIds(@RpcData() raw: unknown): Promise<TitlesByIdsResponse> {
    return this.titles.byIds(titlesByIdsRequest.parse(raw));
  }
}
