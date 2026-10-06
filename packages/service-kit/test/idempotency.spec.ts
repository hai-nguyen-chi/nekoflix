import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose, { type ClientSession, type Model } from 'mongoose';
import {
  ProcessedEventSchema,
  type ProcessedEvent,
} from '../src/idempotency/processed-event.schema';
import { clearCollections, startMongo, stopMongo } from './setup-mongo';

/**
 * Test cho idempotency ở consumer.
 *
 * JetStream giao at-least-once: mỗi event SẼ có lúc được giao hai lần. Không
 * phải "nếu" mà là "khi nào". Test ở đây chứng minh việc giao lại không gây
 * ra tác dụng phụ lần hai.
 */

interface Received {
  echoId: string;
  message: string;
}

const ReceivedSchema = new mongoose.Schema<Received>(
  { echoId: { type: String, required: true, unique: true }, message: String },
  { collection: 'received' },
);

let Processed: Model<ProcessedEvent>;
let Received: Model<Received>;

const DUPLICATE_KEY = 11000;

beforeAll(async () => {
  await startMongo();
  Processed = mongoose.model<ProcessedEvent>('ProcessedEvent', ProcessedEventSchema);
  Received = mongoose.model<Received>('Received', ReceivedSchema);
  await Promise.all([Processed.createIndexes(), Received.createIndexes()]);
}, 180_000);

afterAll(async () => {
  await stopMongo();
});

afterEach(async () => {
  await clearCollections();
});

function isDuplicateKey(err: unknown): boolean {
  const code = (err as { code?: number; cause?: { code?: number } } | null)?.code;
  const causeCode = (err as { cause?: { code?: number } } | null)?.cause?.code;
  return code === DUPLICATE_KEY || causeCode === DUPLICATE_KEY;
}

/** Bản sao logic của IdempotencyService.runOnce, chạy trên Mongo thật */
async function runOnce(
  eventId: string,
  consumer: string,
  fn: (session: ClientSession) => Promise<void>,
): Promise<'processed' | 'duplicate'> {
  const session = await mongoose.connection.startSession();
  try {
    await session.withTransaction(async () => {
      // INSERT TRƯỚC, XỬ LÝ SAU. Không được findOne rồi mới insert.
      await Processed.create([{ eventId, consumer, eventType: 'identity.user.registered' }], {
        session,
      });
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

describe('Idempotency ở consumer', () => {
  it('xử lý event lần đầu -> processed', async () => {
    const effect = vi.fn();
    const result = await runOnce('evt-1', 'notification-service', async (session) => {
      await Received.create([{ echoId: 'e1', message: 'hello' }], { session });
      effect();
    });

    expect(result).toBe('processed');
    expect(effect).toHaveBeenCalledTimes(1);
    expect(await Received.countDocuments()).toBe(1);
  });

  it('cùng event giao lại -> duplicate, KHÔNG chạy tác dụng phụ lần hai', async () => {
    const effect = vi.fn();
    const handler = (session: ClientSession) =>
      Received.create([{ echoId: 'e1', message: 'hello' }], { session }).then(() => {
        effect();
      });

    expect(await runOnce('evt-1', 'notification-service', handler)).toBe('processed');
    expect(await runOnce('evt-1', 'notification-service', handler)).toBe('duplicate');

    expect(effect).toHaveBeenCalledTimes(1);
    expect(await Received.countDocuments()).toBe(1);
  });

  it('HAI BẢN SAO CHẠY SONG SONG -> chỉ một chạy được', async () => {
    const effect = vi.fn();
    const handler = (session: ClientSession) =>
      Received.create([{ echoId: 'e1', message: 'hello' }], { session }).then(() => {
        effect();
      });

    // Bài test quan trọng nhất ở đây. Nó bắt được lỗi `findOne` rồi mới
    // `insert` — hai bản sao sẽ lọt cả hai qua khe hở giữa hai lệnh. Test
    // tuần tự luôn bỏ lọt lỗi này; nó chỉ lộ ra ở production.
    const results = await Promise.all([
      runOnce('evt-1', 'notification-service', handler).catch(() => 'error' as const),
      runOnce('evt-1', 'notification-service', handler).catch(() => 'error' as const),
    ]);

    expect(results.filter((r) => r === 'processed')).toHaveLength(1);
    expect(effect).toHaveBeenCalledTimes(1);
    expect(await Received.countDocuments()).toBe(1);
  });

  it('cùng event, consumer KHÁC NHAU -> cả hai đều chạy', async () => {
    const handler = () => Promise.resolve();

    expect(await runOnce('evt-1', 'notification-service', handler)).toBe('processed');
    expect(await runOnce('evt-1', 'reco-service', handler)).toBe('processed');

    expect(await Processed.countDocuments({ eventId: 'evt-1' })).toBe(2);
  });

  it('handler lỗi -> rollback CẢ bản ghi processedEvents', async () => {
    await expect(
      runOnce('evt-1', 'notification-service', () => Promise.reject(new Error('handler hỏng'))),
    ).rejects.toThrow('handler hỏng');

    // Nếu processedEvents còn lại, event sẽ bị coi là "đã xử lý" trong khi
    // thực tế chưa — và JetStream giao lại cũng vô ích. Event mất vĩnh viễn.
    expect(await Processed.countDocuments({ eventId: 'evt-1' })).toBe(0);

    // Giao lại phải xử lý được
    const result = await runOnce('evt-1', 'notification-service', () => Promise.resolve());
    expect(result).toBe('processed');
  });

  it('chống out-of-order: event cũ hơn không ghi đè dữ liệu mới', async () => {
    const titleId = 't1';
    const Projection = mongoose.model(
      'Projection',
      new mongoose.Schema({ titleId: String, title: String, updatedAt: Date }),
    );

    const apply = (title: string, occurredAt: Date) =>
      Projection.updateOne(
        { titleId, updatedAt: { $lt: occurredAt } },
        { $set: { titleId, title, updatedAt: occurredAt } },
        { upsert: true },
      ).catch(() => undefined); // upsert đua nhau có thể đụng unique, bỏ qua

    const newer = new Date('2026-10-05T10:00:00Z');
    const older = new Date('2026-10-05T09:00:00Z');

    await apply('Tên mới', newer);
    await apply('Tên cũ', older); // đến sau nhưng cũ hơn

    const doc = await Projection.findOne({ titleId }).lean();
    expect((doc as { title: string }).title).toBe('Tên mới');
  });
});
