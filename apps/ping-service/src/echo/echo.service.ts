import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import type {
  CreateEchoRequest,
  CreateEchoResponse,
  ListEchoesResponse,
} from '@nekoflix/contracts';
import { AppError, OutboxService, getLogger } from '@nekoflix/service-kit';
import { Echo } from './echo.schema';

@Injectable()
export class EchoService {
  constructor(
    @InjectModel(Echo.name) private readonly model: Model<Echo>,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Ghi dữ liệu nghiệp vụ + phát event trong MỘT transaction.
   *
   * Đây là pattern được lặp lại ở mọi service. Viết sai ở đây thì sai ở
   * khắp nơi — nên walking skeleton tồn tại chính là để chứng minh nó đúng
   * trước khi có bất kỳ nghiệp vụ thật nào.
   */
  async create(input: CreateEchoRequest, createdBy: string): Promise<CreateEchoResponse> {
    const echoId = randomUUID();
    const createdAt = new Date();

    const result = await this.outbox.withTransaction(async (session) => {
      await this.model.create([{ echoId, message: input.message, createdBy }], { session });

      await this.outbox.publish(
        'ping.echo.created',
        {
          echoId,
          message: input.message,
          createdBy,
          createdAt: createdAt.toISOString(),
        },
        { session },
      );

      // Cố ý ném lỗi SAU khi đã ghi cả hai. Dùng để chứng minh transaction
      // rollback CẢ dữ liệu lẫn outbox — không để lại event mồ côi.
      if (input.failAfterWrite) {
        throw AppError.internal('Lỗi cố ý để kiểm tra rollback của outbox.');
      }

      return { echoId, message: input.message, createdAt: createdAt.toISOString() };
    });

    getLogger().info({ echoId }, 'đã tạo echo và ghi outbox');
    return result;
  }

  async list(): Promise<ListEchoesResponse> {
    const docs = await this.model.find().sort({ createdAt: -1 }).limit(50).lean();
    return {
      items: docs.map((d) => ({
        echoId: d.echoId,
        message: d.message,
        createdAt: new Date(d.createdAt).toISOString(),
      })),
    };
  }
}
