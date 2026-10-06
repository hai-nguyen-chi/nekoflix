/**
 * Sinh dữ liệu mẫu cho môi trường dev.
 *
 *   pnpm db:seed            # thêm/cập nhật, giữ dữ liệu bạn tự tạo
 *   pnpm db:seed --reset    # XOÁ SẠCH rồi seed lại từ đầu
 *   pnpm db:seed --only ping
 *
 * Vì sao seed quan trọng khi làm trên nhiều máy:
 *
 * Dữ liệu dev nên là thứ **dựng lại được**, không phải thứ phải nâng niu.
 * Chạy seed trên máy nào cũng ra dữ liệu GIỐNG HỆT nhau — nhanh hơn copy
 * file dump, không cần mạng, và không bao giờ lệch phiên bản.
 *
 * `pnpm db:export`/`db:import` chỉ dành cho phần còn lại: dữ liệu bạn tạo
 * tay trong lúc thử nghiệm mà seed không sinh ra được.
 *
 * ──────────────────────────────────────────────────────────────────
 * THÊM SEED CHO SERVICE MỚI:
 *   1. Tạo scripts/seed/seeds/<tên>.seed.ts theo mẫu ping.seed.ts
 *   2. Thêm vào mảng SEEDS bên dưới
 * ──────────────────────────────────────────────────────────────────
 */
import { MongoClient } from 'mongodb';
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Seed } from './types';

if (existsSync(resolve(process.cwd(), '.env'))) {
  loadDotenv({ path: resolve(process.cwd(), '.env') });
}

/** Thứ tự quan trọng: seed phụ thuộc phải chạy trước */
const SEEDS: Seed[] = [
  // Phase 1:  identitySeed,
  // Phase 2:  catalogSeed,
  // Phase 3:  mediaSeed, activitySeed,
];

function buildRootUri(): string {
  const host = process.env.MONGO_HOST ?? 'localhost:27017';
  const user = process.env.MONGO_ROOT_USER ?? 'root';
  const password = process.env.MONGO_ROOT_PASSWORD ?? 'rootpassword';
  const replicaSet = process.env.MONGO_REPLICA_SET ?? 'rs0';

  // Seed dùng tài khoản ROOT vì nó ghi vào nhiều database của nhiều service.
  // Đây là ngoại lệ có chủ đích và DUY NHẤT của quy tắc "mỗi service một
  // user riêng" (ADR-012) — seed là công cụ vận hành, không phải service.
  return (
    `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}/` +
    `?replicaSet=${replicaSet}&directConnection=true&authSource=admin`
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const onlyIndex = args.indexOf('--only');
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;

  const seeds = only ? SEEDS.filter((s) => s.name === only) : SEEDS;

  if (only && seeds.length === 0) {
    console.error(
      `\nKhông có seed tên "${only}". Hiện có: ${SEEDS.map((s) => s.name).join(', ')}\n`,
    );
    process.exit(1);
  }

  const client = new MongoClient(buildRootUri(), { serverSelectionTimeoutMS: 8_000 });

  try {
    await client.connect();
  } catch (err) {
    console.error(`
Không kết nối được MongoDB.

  Đã chạy "pnpm infra:up" chưa?
  Kiểm tra:  docker ps --filter name=nekoflix-mongo

  Chi tiết: ${err instanceof Error ? err.message : String(err)}
`);
    process.exit(1);
  }

  console.log(`\nSeed dữ liệu dev${reset ? '  (--reset: XOÁ SẠCH trước)' : ''}\n`);

  let total = 0;
  for (const seed of seeds) {
    const db = client.db(seed.database);

    if (reset) {
      const collections = await db.listCollections().toArray();
      for (const c of collections) {
        // Giữ lại outbox/processedEvents: xoá chúng có thể làm event đang
        // bay nửa chừng bị xử lý lại hoặc mất dấu.
        if (c.name === 'outbox' || c.name === 'processedEvents') continue;
        await db.collection(c.name).deleteMany({});
      }
    }

    const count = await seed.run(db);
    total += count;
    console.log(`  ${seed.name.padEnd(12)} ${seed.database.padEnd(22)} ${count} bản ghi`);
  }

  await client.close();

  console.log(`
Xong — ${total} bản ghi.

Dữ liệu seed là TẤT ĐỊNH: chạy trên máy nào cũng ra kết quả giống nhau.
Nhờ vậy làm việc trên 2 máy không cần đồng bộ database.
`);
}

main().catch((err) => {
  console.error('\nSeed thất bại:', err instanceof Error ? err.message : err);
  process.exit(1);
});
