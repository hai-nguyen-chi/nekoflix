/**
 * Mang dữ liệu MongoDB giữa các máy.
 *
 *   pnpm db:export          # xuất ra .data/nekoflix-<ngày>.gz
 *   pnpm db:import          # nhập bản mới nhất
 *   pnpm db:import <file>   # nhập một file cụ thể
 *   pnpm db:list            # xem các bản đã xuất
 *
 * Dành cho trường hợp làm việc trên nhiều máy (vd máy công ty + máy nhà).
 *
 * LƯU Ý về triết lý: dữ liệu dev nên là thứ **dựng lại được**, không phải
 * thứ phải nâng niu. Khi `pnpm db:seed` có ở Phase 2, phần lớn nhu cầu
 * đồng bộ sẽ biến mất — chạy seed trên máy nào cũng ra dữ liệu giống nhau,
 * nhanh hơn và không cần mạng.
 *
 * Script này dành cho phần CÒN LẠI: dữ liệu bạn tạo tay trong lúc thử
 * nghiệm mà seed không sinh ra được.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_DIR = resolve(process.cwd(), '.data');
const CONTAINER = process.env.MONGO_CONTAINER ?? 'nekoflix-mongo';
const ROOT_USER = process.env.MONGO_ROOT_USER ?? 'root';
const ROOT_PASSWORD = process.env.MONGO_ROOT_PASSWORD ?? 'rootpassword';

function docker(args: string[], opts: { input?: Buffer; capture?: boolean } = {}): Buffer {
  return execFileSync('docker', args, {
    input: opts.input,
    maxBuffer: 1024 * 1024 * 512, // 512MB
    stdio: opts.input ? ['pipe', 'inherit', 'inherit'] : ['inherit', 'pipe', 'inherit'],
  }) as Buffer;
}

function assertContainerRunning(): void {
  try {
    const out = execFileSync('docker', [
      'ps',
      '--filter',
      `name=^${CONTAINER}$`,
      '--format',
      '{{.Names}}',
    ])
      .toString()
      .trim();
    if (!out) throw new Error('not running');
  } catch {
    console.error(`\nContainer "${CONTAINER}" chưa chạy. Gõ trước:  pnpm infra:up\n`);
    process.exit(1);
  }
}

function listDumps(): string[] {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.gz'))
    .map((f) => resolve(DATA_DIR, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

function humanSize(bytes: number): string {
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`;
}

// ─────────────────────────────────────────────────────────────────
function doExport(): void {
  assertContainerRunning();
  mkdirSync(DATA_DIR, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const target = resolve(DATA_DIR, `nekoflix-${stamp}.gz`);

  console.log(`\nĐang xuất toàn bộ database nekoflix_* ...`);

  // --archive + --gzip cho một file duy nhất, dễ copy
  const archive = docker([
    'exec',
    CONTAINER,
    'mongodump',
    '-u',
    ROOT_USER,
    '-p',
    ROOT_PASSWORD,
    '--authenticationDatabase',
    'admin',
    '--archive',
    '--gzip',
    // mongodump KHÔNG có --nsInclude (chỉ mongorestore có), nên xuất tất cả
    // rồi lọc ở bước nhập. Xem doImport().
  ]);

  require('node:fs').writeFileSync(target, archive);
  const size = statSync(target).size;

  console.log(`
  Đã xuất: ${target}
  Dung lượng: ${humanSize(size)}

  Mang sang máy khác bằng cách nào cũng được (USB, Google Drive, Dropbox).
  Thư mục .data/ đã được gitignore — ĐỪNG commit dump lên Git:
  nó là file nhị phân, phình nhanh, và có thể chứa dữ liệu nhạy cảm.

  Ở máy kia:  pnpm infra:up && pnpm db:import
`);
}

// ─────────────────────────────────────────────────────────────────
function doImport(fileArg?: string): void {
  assertContainerRunning();

  const file = fileArg ? resolve(fileArg) : listDumps()[0];
  if (!file || !existsSync(file)) {
    console.error(`\nKhông tìm thấy file dump nào trong .data/\n`);
    console.error(`Chạy "pnpm db:export" ở máy kia trước, rồi copy file .gz vào .data/\n`);
    process.exit(1);
  }

  console.log(`\nĐang nhập: ${file}  (${humanSize(statSync(file).size)})`);
  console.log(`  --drop: collection trùng tên sẽ bị GHI ĐÈ.\n`);

  docker(
    [
      'exec',
      '-i',
      CONTAINER,
      'mongorestore',
      '-u',
      ROOT_USER,
      '-p',
      ROOT_PASSWORD,
      '--authenticationDatabase',
      'admin',
      '--archive',
      '--gzip',
      '--drop',
      // CHỈ khôi phục database của dự án.
      //
      // Bắt buộc phải lọc: bản dump chứa cả `admin` (tài khoản DB) và
      // `local` (cấu hình replica set). Khôi phục `local` sẽ ghi đè cấu
      // hình replica set của máy này bằng cấu hình máy kia — hỏng cụm.
      '--nsInclude',
      'nekoflix_*.*',
    ],
    { input: require('node:fs').readFileSync(file) },
  );

  console.log(`
  Xong. Khởi động lại service để Mongoose tạo lại index:
    pnpm dev:ping
`);
}

// ─────────────────────────────────────────────────────────────────
function doList(): void {
  const dumps = listDumps();
  if (!dumps.length) {
    console.log('\nChưa có bản xuất nào. Gõ: pnpm db:export\n');
    return;
  }
  console.log('\nCác bản đã xuất (mới nhất trước):\n');
  for (const d of dumps) {
    const s = statSync(d);
    console.log(
      `  ${humanSize(s.size).padStart(9)}  ${s.mtime.toISOString().slice(0, 16).replace('T', ' ')}  ${d}`,
    );
  }
  console.log('');
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case 'export':
    doExport();
    break;
  case 'import':
    doImport(arg);
    break;
  case 'list':
    doList();
    break;
  default:
    console.error(`
Cách dùng:
  pnpm db:export          xuất dữ liệu ra .data/
  pnpm db:import [file]   nhập (mặc định: bản mới nhất)
  pnpm db:list            xem các bản đã xuất
`);
    process.exit(1);
}
