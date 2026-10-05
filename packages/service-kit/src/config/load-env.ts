import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

let loaded = false;

/**
 * Nạp file `.env` ở thư mục gốc monorepo.
 *
 * Phải tự làm vì mỗi service chạy từ thư mục riêng (`apps/<name>`), và
 * `node dist/main.js` không nạp `.env` giùm ai cả.
 *
 * Thiếu bước này, thứ hỏng đầu tiên là `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
 * rỗng → tracing tắt IM LẶNG, không một lỗi nào. Mọi thứ khác vẫn chạy vì
 * code có giá trị mặc định cho localhost — nên bug chỉ lộ ra khi mở Jaeger
 * và thấy trống trơn.
 *
 * Biến môi trường có sẵn (Docker, CI) LUÔN được ưu tiên — `.env` chỉ điền
 * vào chỗ còn trống.
 */
export function loadEnv(): string | null {
  if (loaded) return null;
  loaded = true;

  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, override: false });
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
