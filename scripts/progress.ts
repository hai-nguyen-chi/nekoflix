/**
 * Tiến độ feature.
 *
 *   pnpm progress
 *
 * Đọc cột **Xong** trong bảng feature của `docs/11-roadmap.md`. Làm xong một
 * feature thì tự tay đổi ⬜ thành ✅ và điền SHA commit vào cột Commit —
 * script chỉ tổng hợp lại và chỉ ra việc kế tiếp.
 *
 * Một PHASE là một nhánh, mỗi feature trong phase là một commit. Tên nhánh
 * ghi ngay dưới tiêu đề phase trong roadmap.
 *
 * Bản trước suy trạng thái từ lịch sử git bằng cách tìm mã feature trong
 * commit message. Nghe thì chặt hơn, nhưng nó thêm được một kiểu sai mới:
 * commit NHẮC TỚI một mã cũng bị tính là đã giao. Đã dính đúng vậy — chính
 * commit thêm script này viết `feat(catalog): ... (2.5)` làm ví dụ, và 2.5
 * lập tức hiện ✅ trong khi chưa ai động vào tìm kiếm.
 *
 * Bảng gõ tay cũng sai được, nhưng sai theo kiểu nhìn ra ngay. Suy luận sai
 * thì trông rất thật.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROADMAP = resolve(process.cwd(), 'docs/11-roadmap.md');

const DONE = '✅';
const WIP = '🔄';
const TODO = '⬜';

interface Feature {
  status: string;
  id: string;
  /** SHA commit đã giao feature, hoặc `—` khi chưa làm */
  commit: string;
  kind: string;
  what: string;
}
interface Phase {
  num: string;
  name: string;
  weeks: string;
  /** Nhánh của cả phase. Rỗng với phase đã xong từ trước. */
  branch: string;
  features: Feature[];
}

/** `| ✅ | 2.1 | `921ed70` | 🟦 | làm gì | xong khi |` — cột 3 là `—` khi chưa làm */
const ROW =
  /^\|\s*(✅|🔄|⬜)\s*\|\s*(\d+\.[0-9A-Z])\s*\|\s*(`[^`]+`|—)\s*\|\s*(\S+)\s*\|\s*([^|]+?)\s*\|/;
const HEADING = /^## (?:✅ )?Phase (\d+) — (.+?) \(([^)]+)\)/;
const BRANCH_LINE = /^\*\*Nhánh\*\*: `([^`]+)`/;

function parseRoadmap(): Phase[] {
  const phases: Phase[] = [];
  let current: Phase | null = null;

  for (const line of readFileSync(ROADMAP, 'utf8').split(/\r?\n/)) {
    const head = HEADING.exec(line);
    if (head) {
      current = { num: head[1]!, name: head[2]!, weeks: head[3]!, branch: '', features: [] };
      phases.push(current);
      continue;
    }

    const br = BRANCH_LINE.exec(line);
    if (br && current) {
      current.branch = br[1]!;
      continue;
    }

    const row = ROW.exec(line);
    if (row && current) {
      current.features.push({
        status: row[1]!,
        id: row[2]!,
        commit: row[3]!.replace(/`/g, ''),
        kind: row[4]!,
        what: row[5]!,
      });
    }
  }
  return phases;
}

const BAR_WIDTH = 24;

function bar(done: number, total: number): string {
  if (total === 0) return '';
  const filled = Math.round((done / total) * BAR_WIDTH);
  return `${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}`;
}

function main(): void {
  const phases = parseRoadmap();

  if (phases.every((p) => p.features.length === 0)) {
    console.error(`Không đọc được bảng feature nào trong ${ROADMAP}.`);
    console.error('Bảng phải có cột đầu là Xong, giá trị ✅ / 🔄 / ⬜.');
    process.exit(1);
  }

  let totalDone = 0;
  let total = 0;
  const wip: Feature[] = [];
  let next: Feature | null = null;

  console.log('\nTiến độ feature — nguồn: docs/11-roadmap.md\n');

  for (const p of phases) {
    if (p.features.length === 0) continue;

    const d = p.features.filter((f) => f.status === DONE).length;
    totalDone += d;
    total += p.features.length;

    const pct = Math.round((d / p.features.length) * 100);
    console.log(
      `Phase ${p.num} — ${p.name}  (${p.weeks})`.padEnd(52) +
        `${bar(d, p.features.length)} ${String(pct).padStart(3)}%  ${d}/${p.features.length}`,
    );

    for (const f of p.features) {
      if (f.status === WIP) wip.push(f);
      else if (f.status === TODO && !next) next = f;

      console.log(`   ${f.status} ${f.id.padEnd(4)} ${f.kind} ${f.commit.padEnd(9)} ${f.what}`);
    }
    console.log();
  }

  console.log('─'.repeat(78));
  const pct = total ? Math.round((totalDone / total) * 100) : 0;
  console.log(`  TỔNG  ${bar(totalDone, total)} ${pct}%   ${totalDone}/${total} feature\n`);

  if (wip.length) {
    console.log('  Đang làm:');
    for (const f of wip) console.log(`    ${f.id}  ${f.what}`);
    console.log();
  }

  if (next) {
    const phase = phases.find((p) => p.features.includes(next!));
    console.log('  Feature kế tiếp:');
    console.log(`    ${next.id}  ${next.what}`);
    if (phase?.branch) {
      console.log(`\n  Cả phase ${phase.num} nằm trên nhánh ${phase.branch}:`);
      console.log(`    git checkout ${phase.branch} \\`);
      console.log(`      || (git checkout develop && git pull && git checkout -b ${phase.branch})`);
    }
    console.log();
  } else if (totalDone === total && total > 0) {
    console.log('  Hết feature trong roadmap.\n');
  }

  console.log('  Xong một feature thì đổi ⬜ -> ✅ và điền SHA vào cột Commit');
  console.log('  trong docs/11-roadmap.md (dùng 🔄 cho feature đang làm dở).\n');
}

main();
