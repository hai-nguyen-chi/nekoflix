import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { EVENT_REGISTRY } from '../src/events/index';
import { RPC_REGISTRY } from '../src/rpc/index';
import { checkBackwardCompatible, describeSchema, type SchemaShape } from './schema-shape';

/**
 * Lưới an toàn quan trọng nhất của contracts.
 *
 * Snapshot trong `snapshots/` là hình dạng hợp đồng ĐANG CHẠY THẬT. Mỗi lần
 * sửa schema, test này so hình dạng mới với nó và chặn những thay đổi làm
 * chết bên kia — xoá field, đổi kiểu, biến tuỳ chọn thành bắt buộc.
 *
 * Vì sao cần: identity-service và notification-service deploy riêng, và
 * event nằm sẵn trong JetStream để replay. Một dòng sửa schema có thể làm
 * consumer ở service khác chết mà không ai biết cho tới lúc chạy thật.
 *
 * Khi thay đổi là CÓ CHỦ Ý và đã xử lý hai bên:
 *
 *   UPDATE_CONTRACT_SNAPSHOT=1 pnpm --filter @nekoflix/contracts test
 *
 * rồi commit file snapshot cùng với thay đổi schema. Diff của snapshot
 * chính là thứ người review cần nhìn.
 */
const SNAPSHOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'snapshots');
const UPDATING = process.env.UPDATE_CONTRACT_SNAPSHOT === '1';

type ShapeFile = Record<string, SchemaShape>;

function load(file: string): ShapeFile | null {
  const path = resolve(SNAPSHOT_DIR, file);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as ShapeFile;
}

function save(file: string, shapes: ShapeFile): void {
  const path = resolve(SNAPSHOT_DIR, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(shapes, null, 2)}\n`);
}

/** Hình dạng hiện tại của toàn bộ event, key là `<type>.v<version>` */
function currentEventShapes(): ShapeFile {
  const out: ShapeFile = {};
  for (const [type, entry] of Object.entries(EVENT_REGISTRY)) {
    out[`${type}.v${entry.version}`] = describeSchema(entry.schema);
  }
  return out;
}

function currentRpcShapes(): ShapeFile {
  const out: ShapeFile = {};
  for (const [subject, entry] of Object.entries(RPC_REGISTRY)) {
    out[`${subject}#request`] = describeSchema(entry.request);
    out[`${subject}#response`] = describeSchema(entry.response);
  }
  return out;
}

function report(name: string, published: SchemaShape, current: SchemaShape): string {
  const r = checkBackwardCompatible(published, current);
  if (r.compatible) return '';
  return [
    `\n  ${name}`,
    ...r.breaking.map((m) => `    PHÁ VỠ: ${m}`),
    ...r.risky.map((m) => `    RỦI RO: ${m}`),
  ].join('\n');
}

function runSuite(file: string, current: ShapeFile, label: string): void {
  describe(label, () => {
    const published = load(file);

    if (UPDATING) {
      it('đã ghi lại snapshot (UPDATE_CONTRACT_SNAPSHOT=1)', () => {
        save(file, current);
        expect(load(file)).toEqual(current);
      });
      return;
    }

    if (!published) {
      it('tạo snapshot lần đầu', () => {
        save(file, current);
        console.log(`\n  Đã tạo ${file} lần đầu — hãy commit file này.\n`);
      });
      return;
    }

    it('không có hợp đồng nào bị xoá', () => {
      const missing = Object.keys(published).filter((k) => !(k in current));
      // Xoá một event khỏi registry không làm consumer đang chạy biến mất.
      // Nó chỉ làm event ngừng được phát, và consumer chờ mãi không tới.
      expect(missing, `hợp đồng biến mất khỏi registry: ${missing.join(', ')}`).toEqual([]);
    });

    it('không thay đổi nào phá vỡ tương thích ngược', () => {
      const problems = Object.keys(published)
        .filter((k) => k in current)
        .map((k) => report(k, published[k]!, current[k]!))
        .filter(Boolean)
        .join('');

      expect(
        problems,
        `${problems}\n\n  Nếu đây là thay đổi có chủ ý và đã xử lý cả hai bên:\n` +
          `    UPDATE_CONTRACT_SNAPSHOT=1 pnpm --filter @nekoflix/contracts test\n`,
      ).toBe('');
    });

    it('hợp đồng mới được ghi vào snapshot', () => {
      // Không chặn thêm event mới — chỉ bắt buộc snapshot phải đi kèm,
      // nếu không lần sửa SAU sẽ không có gì để so.
      const added = Object.keys(current).filter((k) => !(k in published));
      expect(
        added,
        `hợp đồng mới chưa có trong snapshot: ${added.join(', ')}\n` +
          `  Chạy: UPDATE_CONTRACT_SNAPSHOT=1 pnpm --filter @nekoflix/contracts test`,
      ).toEqual([]);
    });
  });
}

runSuite('events.json', currentEventShapes(), 'Tương thích ngược — event');
runSuite('rpc.json', currentRpcShapes(), 'Tương thích ngược — RPC');
