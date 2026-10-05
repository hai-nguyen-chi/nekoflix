import type { Db } from 'mongodb';
import { seedId, type Seed } from '../types';

/**
 * Seed cho walking skeleton Phase 0.
 * XOÁ CẢ FILE NÀY khi xoá ping-service ở Phase 1 — nó chỉ tồn tại để làm
 * mẫu cho các seed thật sau này.
 */
const ECHOES = [
  { key: 'echo:xin-chao', message: 'Xin chào Nekoflix' },
  { key: 'echo:outbox', message: 'Event này đi qua outbox' },
  { key: 'echo:idempotent', message: 'Gửi lại bao nhiêu lần cũng vậy' },
];

export const pingSeed: Seed = {
  name: 'ping',
  database: 'nekoflix_ping',

  async run(db: Db): Promise<number> {
    const col = db.collection('echoes');
    const now = new Date('2026-01-01T00:00:00.000Z'); // cố định -> tất định

    for (const e of ECHOES) {
      await col.updateOne(
        { _id: seedId(e.key) },
        {
          // $setOnInsert cho createdAt: chạy seed lại không làm đổi thời gian
          $setOnInsert: { createdAt: now, echoId: e.key },
          $set: { message: e.message, createdBy: 'seed', updatedAt: now },
        },
        { upsert: true },
      );
    }

    return ECHOES.length;
  },
};
