import { Model } from 'mongoose';
import type {
  CreateEchoRequest,
  CreateEchoResponse,
  ListEchoesResponse,
} from '@nekoflix/contracts';
import { OutboxService } from '@nekoflix/service-kit';
import { Echo } from './echo.schema';
export declare class EchoService {
  private readonly model;
  private readonly outbox;
  constructor(model: Model<Echo>, outbox: OutboxService);
  /**
   * Ghi dữ liệu nghiệp vụ + phát event trong MỘT transaction.
   *
   * Đây là pattern được lặp lại ở mọi service. Viết sai ở đây thì sai ở
   * khắp nơi — nên walking skeleton tồn tại chính là để chứng minh nó đúng
   * trước khi có bất kỳ nghiệp vụ thật nào.
   */
  create(input: CreateEchoRequest, createdBy: string): Promise<CreateEchoResponse>;
  list(): Promise<ListEchoesResponse>;
}
//# sourceMappingURL=echo.service.d.ts.map
