import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, type ClientSession, Model, mongo } from 'mongoose';
import { ProcessedEvent } from './processed-event.schema';

export type RunOnceResult = 'processed' | 'duplicate';

const DUPLICATE_KEY = 11000;

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectModel(ProcessedEvent.name) private readonly model: Model<ProcessedEvent>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Chạy `fn` đúng một lần cho mỗi (eventId, consumer).
   *
   * INSERT TRƯỚC, XỬ LÝ SAU, trong cùng một transaction.
   *
   * Không được `findOne` rồi mới `insert`: hai bản sao của cùng event chạy
   * song song sẽ lọt cả hai qua khe hở giữa hai lệnh. Đây chính là lỗi mà
   * test tuần tự luôn bỏ lọt và chỉ lộ ra ở production.
   */
  async runOnce(
    eventId: string,
    consumer: string,
    eventType: string,
    fn: (session: ClientSession) => Promise<void>,
  ): Promise<RunOnceResult> {
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.model.create([{ eventId, consumer, eventType }], { session });
        await fn(session);
      });
      return 'processed';
    } catch (err) {
      if (isDuplicateKey(err)) return 'duplicate';
      throw err;
    } finally {
      await session.endSession();
    }
  }

  async wasProcessed(eventId: string, consumer: string): Promise<boolean> {
    const found = await this.model.exists({ eventId, consumer });
    return !!found;
  }
}

function isDuplicateKey(err: unknown): boolean {
  if (err instanceof mongo.MongoServerError && err.code === DUPLICATE_KEY) return true;
  // Trong transaction, lỗi duplicate đôi khi bị bọc thêm một lớp
  const code = (err as { code?: number; cause?: { code?: number } } | null)?.code;
  const causeCode = (err as { cause?: { code?: number } } | null)?.cause?.code;
  return code === DUPLICATE_KEY || causeCode === DUPLICATE_KEY;
}
