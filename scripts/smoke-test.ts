/**
 * Kiểm chứng "definition of done" của Phase 0.
 *
 * Chạy: pnpm smoke   (cần gateway + ping-service + pong-service đang chạy)
 *
 * Đây không phải unit test — nó chạy trên hệ thống thật và trả lời đúng câu
 * hỏi của Phase 0: đường dây HTTP -> NATS -> DB+outbox -> JetStream ->
 * consumer -> idempotency có thực sự thông không.
 */
const BASE = process.env.GATEWAY_URL ?? 'http://localhost:4000';

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log('OK');
    passed++;
  } catch (err) {
    console.log(`THẤT BẠI\n      ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body: body as Record<string, unknown> | null, res };
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null>,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result !== null) return result;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Quá ${timeoutMs}ms vẫn chưa thấy: ${label}`);
}

async function main(): Promise<void> {
  console.log(`\nNekoflix — smoke test Phase 0 (${BASE})\n`);

  // ── 1. Hạ tầng ──────────────────────────────────────────────
  console.log('1. Health check');

  await check('gateway /health/live', async () => {
    const { status } = await api('/health/live');
    assert(status === 200, `mong đợi 200, nhận ${status}`);
  });

  await check('gateway /health/ready (NATS đã kết nối)', async () => {
    const { status, body } = await api('/health/ready');
    assert(status === 200, `mong đợi 200, nhận ${status} — NATS chưa chạy?`);
    assert((body?.checks as Record<string, boolean>)?.nats, 'NATS chưa kết nối');
  });

  // ── 2. HTTP -> NATS request/reply ───────────────────────────
  console.log('\n2. HTTP -> NATS request/reply -> ping-service');

  await check('POST /v1/ping trả lời từ ping-service', async () => {
    const { status, body } = await api('/v1/ping', {
      method: 'POST',
      body: JSON.stringify({ message: 'xin chào' }),
    });
    assert(status === 201 || status === 200, `mong đợi 2xx, nhận ${status}`);
    assert(body?.reply === 'pong: xin chào', `reply sai: ${JSON.stringify(body)}`);
    assert(String(body?.servedBy).startsWith('ping-service'), 'không phải ping-service phục vụ');
  });

  await check('requestId được truyền xuống service', async () => {
    const { body } = await api('/v1/ping', {
      method: 'POST',
      headers: { 'x-request-id': 'smoke-test-123' },
      body: JSON.stringify({ message: 'trace' }),
    });
    const caller = body?.caller as Record<string, string> | undefined;
    assert(caller?.requestId === 'smoke-test-123', `requestId không tới nơi: ${caller?.requestId}`);
  });

  await check('validate payload sai -> 400 VALIDATION_FAILED', async () => {
    const { status, body } = await api('/v1/ping', {
      method: 'POST',
      body: JSON.stringify({ message: '' }),
    });
    assert(status === 400, `mong đợi 400, nhận ${status}`);
    const error = body?.error as Record<string, unknown> | undefined;
    assert(error?.code === 'VALIDATION_FAILED', `code sai: ${error?.code}`);
  });

  // ── 3. Outbox -> JetStream -> consumer ──────────────────────
  console.log('\n3. Outbox -> JetStream -> pong-service');

  const marker = `smoke-${Date.now()}`;

  const created = await (async () => {
    const { status, body } = await api('/v1/ping/echo', {
      method: 'POST',
      body: JSON.stringify({ message: marker }),
    });
    assert(status === 201 || status === 200, `tạo echo thất bại: ${status}`);
    return body as { echoId: string };
  })();

  await check('echo đã ghi vào ping-service', async () => {
    const { body } = await api('/v1/ping/echo');
    const items = (body as { items: { echoId: string }[] }).items;
    assert(
      items.some((i) => i.echoId === created.echoId),
      'không thấy echo vừa tạo',
    );
  });

  await check('event tới pong-service qua JetStream (<15s)', async () => {
    await waitFor(`echo ${created.echoId} ở pong-service`, async () => {
      const { body } = await api('/v1/ping/received');
      const items = (body as { items: { echoId: string }[] }).items;
      return items.find((i) => i.echoId === created.echoId) ?? null;
    });
  });

  // ── 4. Rollback của transaction ─────────────────────────────
  console.log('\n4. Transaction rollback (ghi DB + outbox là nguyên tử)');

  const before = await api('/v1/ping/echo');
  const beforeCount = (before.body as { items: unknown[] }).items.length;

  await check('lỗi sau khi ghi -> rollback CẢ dữ liệu lẫn outbox', async () => {
    const { status } = await api('/v1/ping/echo', {
      method: 'POST',
      body: JSON.stringify({ message: 'phải-bị-rollback', failAfterWrite: true }),
    });
    assert(status >= 500, `mong đợi lỗi 5xx, nhận ${status}`);

    const after = await api('/v1/ping/echo');
    const afterCount = (after.body as { items: unknown[] }).items.length;
    assert(
      afterCount === beforeCount,
      `rollback hỏng: trước ${beforeCount}, sau ${afterCount} — có bản ghi mồ côi`,
    );
  });

  await check('không có event mồ côi tới pong-service', async () => {
    await new Promise((r) => setTimeout(r, 3_000)); // cho relay thời gian chạy
    const { body } = await api('/v1/ping/received');
    const items = (body as { items: { message: string }[] }).items;
    assert(
      !items.some((i) => i.message === 'phải-bị-rollback'),
      'LỖI NGHIÊM TRỌNG: event được phát dù transaction đã rollback',
    );
  });

  // ── 5. API composition ──────────────────────────────────────
  console.log('\n5. API composition ở gateway');

  await check('GET /v1/ping/status ghép 2 service', async () => {
    const { status, body } = await api('/v1/ping/status');
    assert(status === 200, `mong đợi 200, nhận ${status}`);
    const data = (body as { data: Record<string, unknown> }).data;
    assert(typeof data.published === 'number', 'thiếu published');
    assert(data.degraded === false, 'pong-service nên đang chạy');
  });

  // ── Kết quả ─────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  ${passed} đạt, ${failed} thất bại`);

  if (failed === 0) {
    console.log(`
  Phase 0 ĐẠT. Đường dây đã thông:
    HTTP -> NATS -> DB+outbox (1 transaction) -> JetStream
         -> consumer -> idempotency

  Còn một việc PHẢI tự kiểm tra bằng mắt:
    Mở http://localhost:16686 (Jaeger), chọn service "gateway",
    tìm trace gần nhất. Trace phải LIỀN MẠCH qua cả 3 chặng:
      gateway -> ping-service -> pong-service
    Nếu thấy nhiều trace rời rạc thay vì một chuỗi, trace context
    đang bị đứt — sửa xong mới được sang Phase 1.
`);
  } else {
    console.log('\n  Phase 0 CHƯA ĐẠT.\n');
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSmoke test không chạy được:', err instanceof Error ? err.message : err);
  console.error('Đã chạy `pnpm infra:up` và `pnpm dev:ping` chưa?\n');
  process.exit(1);
});
