/**
 * Tiến độ feature, SUY RA TỪ GIT.
 *
 *   pnpm progress
 *
 * Vì sao không gõ tay một cột "trạng thái" trong roadmap: bảng gõ tay sẽ
 * lệch với thực tế đúng vào lúc bận nhất, và dự án này đã dính một lần —
 * tài liệu ghi "CI green" suốt 17 run đỏ liên tiếp vì không ai mở ra xem.
 *
 * Nguồn sự thật tách đôi, mỗi thứ một nơi:
 *   - ĐỊNH NGHĨA feature  -> docs/11-roadmap.md  (người viết)
 *   - TRẠNG THÁI feature  -> git                 (máy đọc)
 *
 * Quy ước để máy đọc được: commit message có mã feature trong ngoặc.
 *
 *     feat(catalog): text index bỏ dấu tiếng Việt (2.5)
 *
 * Quên ghi mã thì feature hiện là chưa làm — đó là chủ đích, nó nhắc ngay
 * ở lần chạy kế tiếp chứ không để trôi.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROADMAP = resolve(process.cwd(), 'docs/11-roadmap.md');
/** Nhánh dùng làm mốc "đã xong" — feature chỉ tính là xong khi đã vào đây */
const TRUNK = process.env.PROGRESS_BASE ?? 'develop';

interface Feature {
  id: string;
  branch: string;
  kind: string;
  what: string;
}
interface Phase {
  num: string;
  name: string;
  weeks: string;
  features: Feature[];
}

function git(...args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

// ── Đọc định nghĩa từ roadmap ────────────────────────────────────
function parseRoadmap(): Phase[] {
  const lines = readFileSync(ROADMAP, 'utf8').split(/\r?\n/);
  const phases: Phase[] = [];
  let current: Phase | null = null;

  for (const line of lines) {
    const head = /^## (?:✅ )?Phase (\d+) — (.+?) \(([^)]+)\)/.exec(line);
    if (head) {
      current = { num: head[1]!, name: head[2]!, weeks: head[3]!, features: [] };
      phases.push(current);
      continue;
    }

    // | 2.1 | `feat/x` | 🟦 | làm gì | xong khi |
    const row = /^\|\s*(\d+\.[0-9A-Z])\s*\|\s*`([^`]+)`\s*\|\s*(\S+)\s*\|\s*([^|]+?)\s*\|/.exec(
      line,
    );
    if (row && current) {
      current.features.push({ id: row[1]!, branch: row[2]!, kind: row[3]!, what: row[4]! });
    }
  }
  return phases;
}

// ── Đọc trạng thái từ git ────────────────────────────────────────
/** Mã feature đã xuất hiện trong lịch sử của TRUNK */
function mergedIds(): Set<string> {
  const log = git('log', TRUNK, '--format=%s%n%b');
  const ids = new Set<string>();
  for (const m of log.matchAll(/\((\d+\.[0-9A-Z])\)/g)) ids.add(m[1]!);
  return ids;
}

/** Nhánh đang tồn tại (local hoặc remote) nhưng chưa vào TRUNK */
function openBranches(): Set<string> {
  const out = git('branch', '-a', '--format=%(refname:short)');
  return new Set(
    out
      .split(/\r?\n/)
      .map((b) => b.trim().replace(/^origin\//, ''))
      .filter(Boolean),
  );
}

// ── In ───────────────────────────────────────────────────────────
const BAR_WIDTH = 24;

function bar(done: number, total: number): string {
  if (total === 0) return '';
  const filled = Math.round((done / total) * BAR_WIDTH);
  return `${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}`;
}

function main(): void {
  if (!git('rev-parse', '--git-dir')) {
    console.error('Không phải git repo.');
    process.exit(1);
  }
  if (!git('rev-parse', '--verify', TRUNK)) {
    console.error(`Không tìm thấy nhánh "${TRUNK}". Đặt PROGRESS_BASE để đổi.`);
    process.exit(1);
  }

  const phases = parseRoadmap();
  const done = mergedIds();
  const branches = openBranches();

  let totalDone = 0;
  let total = 0;
  const wip: Feature[] = [];
  let next: Feature | null = null;

  console.log(`\nTiến độ feature — mốc "xong" là nhánh ${TRUNK}\n`);

  for (const p of phases) {
    if (p.features.length === 0) continue;

    const d = p.features.filter((f) => done.has(f.id)).length;
    totalDone += d;
    total += p.features.length;

    const pct = Math.round((d / p.features.length) * 100);
    console.log(
      `Phase ${p.num} — ${p.name}  (${p.weeks})`.padEnd(52) +
        `${bar(d, p.features.length)} ${String(pct).padStart(3)}%  ${d}/${p.features.length}`,
    );

    for (const f of p.features) {
      let mark = '⬜';
      if (done.has(f.id)) mark = '✅';
      else if (branches.has(f.branch)) {
        mark = '🔄';
        wip.push(f);
      } else if (!next) next = f;

      console.log(`   ${mark} ${f.id.padEnd(4)} ${f.kind} ${f.branch.padEnd(34)} ${f.what}`);
    }
    console.log();
  }

  // ── Tổng ───────────────────────────────────────────────────────
  console.log('─'.repeat(78));
  const pct = total ? Math.round((totalDone / total) * 100) : 0;
  console.log(`  TỔNG  ${bar(totalDone, total)} ${pct}%   ${totalDone}/${total} feature\n`);

  if (wip.length) {
    console.log('  Đang làm (nhánh đã tồn tại, chưa vào ' + TRUNK + '):');
    for (const f of wip) console.log(`    ${f.id}  ${f.branch}`);
    console.log();
  }

  if (next) {
    console.log('  Feature kế tiếp:');
    console.log(`    ${next.id}  ${next.what}`);
    console.log(`    git checkout ${TRUNK} && git pull && git checkout -b ${next.branch}\n`);
  } else if (totalDone === total && total > 0) {
    console.log('  Hết feature trong roadmap.\n');
  }

  console.log('  Phase 0 và 1 đã xong trước khi có quy ước mã feature,');
  console.log('  nên không nằm trong bảng trên. Xem docs/11-roadmap.md.\n');
}

main();
