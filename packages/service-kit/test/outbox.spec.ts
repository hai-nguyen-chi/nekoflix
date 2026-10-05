import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mongoose, { type Model } from 'mongoose';
import { OutboxEventSchema, type OutboxEvent } from '../src/outbox/outbox.schema';
import { clearCollections, startMongo, stopMongo } from './setup-mongo';

/**
 * Test cho Transactional Outbox — chạy trên MongoDB replica set THẬT.
 *
 * Đây là bài test quan trọng nhất của service-kit: nếu outbox sai, mọi
 * service đều phát event sai, và kiểu hỏng là IM LẶNG (không ném lỗi, chỉ
 * lệch dữ liệu dần).
 */

interface Echo {
  echoId: string;
  message: string;
}

const EchoSchema = new mongoose.Schema<Echo>(
  { echoId: { type: String, required: true, unique: true }, message: String },
  { collection: 'echoes' },
);

let Outbox: Model<OutboxEvent>;
let Echoes: Model<Echo>;

beforeAll(async () => {
  await startMongo();
  Outbox = mongoose.model<OutboxEvent>('OutboxEvent', OutboxEventSchema);
  Echoes = mongoose.model<Echo>('Echo', EchoSchema);
  await Promise.all([Outbox.createIndexes(), Echoes.createIndexes()]);
}, 180_000);

afterAll(async () => {
  await stopMongo();
});

afterEach(async () => {
  await clearCollections();
});

/** Mô phỏng đúng những gì OutboxService + domain service làm */
async function createEchoWithEvent(message: string, opts: { failAfterWrite?: boolean } = {}) {
  const session = await mongoose.connection.startSession();
  try {
    await session.withTransaction(async () => {
      await Echoes.create([{ echoId: `echo-${message}`, message }], { session });
      await Outbox.create(
        [
          {
            eventId: `evt-${message}`,
            type: 'ping.echo.created',
            version: 1,
            occurredAt: new Date(),
            producer: 'test@0.1.0',
            data: { message },
            status: 'pending',
            attempts: 0,
          },
        ],
        { session },
      );
      if (opts.failAfterWrite) throw new Error('lỗi cố ý sau khi ghi');
    });
  } finally {
    await session.endSession();
  }
}

describe('Transactional Outbox', () => {
  it('ghi dữ liệu nghiệp vụ và event trong CÙNG transaction', async () => {
    await createEchoWithEvent('alpha');

    expect(await Echoes.countDocuments()).toBe(1);
    const event = await Outbox.findOne({ type: 'ping.echo.created' }).lean();
    expect(event).toBeTruthy();
    expect(event?.status).toBe('pending');
    expect((event?.data as { message: string }).message).toBe('alpha');
  });

  it('lỗi sau khi ghi -> rollback CẢ HAI, không để lại event mồ côi', async () => {
    await expect(createEchoWithEvent('beta', { failAfterWrite: true })).rejects.toThrow();

    // Đây mới là điểm quan trọng. Nếu outbox nằm ngoài transaction, event
    // "beta" sẽ được phát cho một echo chưa bao giờ tồn tại — consumer ở
    // service khác xử lý một sự kiện không có thật.
    expect(await Echoes.countDocuments()).toBe(0);
    expect(await Outbox.countDocuments()).toBe(0);
  });

  it('rollback không ảnh hưởng transaction đã commit trước đó', async () => {
    await createEchoWithEvent('gamma');
    await expect(createEchoWithEvent('delta', { failAfterWrite: true })).rejects.toThrow();

    expect(await Echoes.countDocuments()).toBe(1);
    expect(await Outbox.countDocuments()).toBe(1);
    expect((await Outbox.findOne().lean())?.eventId).toBe('evt-gamma');
  });

  it('claim bằng findOneAndUpdate: hai relay không giành được cùng một event', async () => {
    await createEchoWithEvent('epsilon');

    const claim = () =>
      Outbox.findOneAndUpdate(
        { status: 'pending', attempts: { $lt: 10 } },
        { $set: { status: 'publishing', claimedAt: new Date() }, $inc: { attempts: 1 } },
        { sort: { createdAt: 1 }, returnDocument: 'after' },
      );

    // Hai instance relay chạy song song
    const [a, b] = await Promise.all([claim(), claim()]);

    const claimed = [a, b].filter(Boolean);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.status).toBe('publishing');
  });

  it('thu hồi được event bị kẹt ở publishing khi relay chết giữa chừng', async () => {
    await createEchoWithEvent('zeta');
    await Outbox.updateOne(
      { eventId: 'evt-zeta' },
      { $set: { status: 'publishing', claimedAt: new Date(Date.now() - 120_000) } },
    );

    const cutoff = new Date(Date.now() - 60_000);
    const res = await Outbox.updateMany(
      { status: 'publishing', claimedAt: { $lt: cutoff } },
      { $set: { status: 'pending', claimedAt: null } },
    );

    expect(res.modifiedCount).toBe(1);
    expect((await Outbox.findOne({ eventId: 'evt-zeta' }).lean())?.status).toBe('pending');
  });

  it('eventId là unique — relay chạy lại không tạo bản sao', async () => {
    await createEchoWithEvent('eta');
    await expect(
      Outbox.create({
        eventId: 'evt-eta',
        type: 'ping.echo.created',
        version: 1,
        occurredAt: new Date(),
        producer: 'test@0.1.0',
        data: {},
        status: 'pending',
      }),
    ).rejects.toThrow(/duplicate key/i);
  });
});
