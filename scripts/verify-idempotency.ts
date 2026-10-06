/**
 * Kiểm chứng idempotency của consumer TRÊN HỆ THỐNG THẬT.
 *
 *   pnpm verify:idempotency
 *   (cần `pnpm infra:up` + notification-service đang chạy)
 *
 * Vì sao cần script riêng, không gộp vào `pnpm smoke`:
 *
 * JetStream giao at-least-once — mỗi event SẼ có lúc được giao hai lần.
 * Nhưng ở luồng chạy bình thường điều đó gần như không xảy ra, nên smoke
 * test không bao giờ chạm tới nhánh code đó. Script này ÉP nó xảy ra.
 *
 * Cách làm: publish thẳng lên JetStream nhiều bản sao của CÙNG một envelope,
 * KHÔNG kèm msgID. Bỏ msgID là cố ý — có msgID thì broker tự khử trùng trong
 * cửa sổ 2 phút, và ta sẽ chỉ test được dedup của NATS chứ không test được
 * idempotency của chính consumer.
 *
 * Thước đo là số email trong Mailpit, không phải số bản ghi trong DB: email
 * là thứ người dùng thật sự nhận. Hai email chào mừng cho một lần đăng ký là
 * lỗi nhìn thấy được, một dòng thừa trong collection thì không.
 */
import { connect, JSONCodec } from 'nats';

const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4222';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/**
 * Subject viết tay, KHÔNG import `eventSubject()` từ @nekoflix/contracts.
 *
 * Script này cố tình đóng vai một producer lạ nói chuyện trực tiếp với
 * JetStream. Dùng helper của chính hệ thống thì nếu helper đổi sai, script
 * cũng đổi sai theo và không phát hiện được gì.
 */
const SUBJECT = 'nekoflix.events.identity.user.registered';

const codec = JSONCodec();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Thời gian chờ relay quét outbox (1s/vòng) rồi gửi qua SMTP */
const SETTLE_MS = 8_000;

async function countEmails(to: string): Promise<number> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
  if (!res.ok) throw new Error(`Mailpit trả ${res.status} — đã chạy pnpm infra:up chưa?`);
  const body = (await res.json()) as { messages: unknown[] };
  return body.messages.length;
}

async function waitForCount(to: string, want: number, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let n = await countEmails(to);
  while (Date.now() < deadline && n < want) {
    await sleep(400);
    n = await countEmails(to);
  }
  return n;
}

function envelope(id: string, data: Record<string, unknown>) {
  return {
    id,
    type: 'identity.user.registered',
    version: 1,
    occurredAt: data.registeredAt,
    producer: 'verify-idempotency@0.1.0',
    traceId: '',
    correlationId: id,
    causationId: null,
    data,
  };
}

async function run(): Promise<number> {
  const stamp = Date.now();
  const to = `idem-${stamp}@nekoflix.local`;

  const payload = {
    userId: `probe-user-${stamp}`,
    email: to,
    displayName: 'Idempotency Probe',
    verificationToken: `probe-token-${stamp}`,
    verificationExpiresAt: new Date(stamp + 86_400_000).toISOString(),
    registeredAt: new Date(stamp).toISOString(),
  };

  const start = await countEmails(to);
  if (start !== 0) {
    console.error(`  Hộp thư ${to} đã có ${start} email — địa chỉ phải mới tinh.`);
    return 1;
  }

  const nc = await connect({ servers: NATS_URL.split(',') });
  const js = nc.jetstream();

  try {
    // ── 1. Gửi lần đầu ────────────────────────────────────────
    const eventId = `idem-probe-${stamp}`;
    await js.publish(SUBJECT, codec.encode(envelope(eventId, payload)));
    console.log(`  1. Đã publish ${eventId} -> ${SUBJECT}`);

    const afterFirst = await waitForCount(to, 1, 25_000);
    if (afterFirst !== 1) {
      console.error(`
  Sau lần publish đầu tiên có ${afterFirst} email (mong đợi 1).
  notification-service chưa chạy, hoặc email relay đang kẹt.
`);
      return 1;
    }
    console.log('  2. notification-service đã xử lý — 1 email trong hộp thư');

    // ── 2. Gửi lại y hệt 3 lần ────────────────────────────────
    console.log('  3. Publish LẠI cùng envelope đó 3 lần (không msgID) ...');
    for (let i = 0; i < 3; i++) {
      await js.publish(SUBJECT, codec.encode(envelope(eventId, payload)));
    }
    await sleep(SETTLE_MS);

    const afterReplay = await countEmails(to);
    console.log(`  4. Số email sau khi gửi lại: ${afterReplay}`);

    // ── 3. Đối chứng ──────────────────────────────────────────
    // Thiếu bước này thì kết quả "không tăng" là vô nghĩa: cả pipeline chết
    // cũng cho ra đúng con số đó. Event id KHÁC, payload giống hệt -> phải
    // ra email thứ hai. Đây là bằng chứng phép đo còn sống.
    console.log('  5. Đối chứng: publish envelope id KHÁC, payload giống hệt ...');
    await js.publish(SUBJECT, codec.encode(envelope(`${eventId}-control`, payload)));
    const afterControl = await waitForCount(to, afterReplay + 1, 25_000);
    console.log(`  6. Số email sau đối chứng: ${afterControl}`);

    // ── Kết luận ──────────────────────────────────────────────
    console.log(`\n${'─'.repeat(56)}`);

    if (afterReplay !== 1) {
      console.log(`
  THẤT BẠI. Gửi lại cùng một event -> số email tăng từ 1 lên ${afterReplay}.

  Consumer đang xử lý cùng một event nhiều lần. Kiểm tra:
    - IdempotencyService.runOnce có INSERT processedEvents TRƯỚC, xử lý SAU?
    - Unique index { eventId, consumer } trên processedEvents còn không?
    - Handler có ghi qua đúng session được truyền vào không?
    - EmailOutbox.eventId có còn unique không?
`);
      return 1;
    }

    if (afterControl !== 2) {
      console.log(`
  KHÔNG KẾT LUẬN ĐƯỢC. Đối chứng cho ra ${afterControl} email (mong đợi 2).

  Event id MỚI đáng lẽ phải tạo email mới. Nó không tạo, nghĩa là pipeline
  đang tắc ở đâu đó — nên kết quả "gửi lại không tăng" ở trên không chứng
  minh được idempotency, nó chỉ phản ánh việc không có gì chạy cả.

  Xem log notification-service và metric email_outbox_pending_count.
`);
      return 1;
    }

    console.log(`
  ĐẠT.
    cùng event id, publish 4 lần  -> 1 email
    event id khác, cùng payload   -> 2 email

  processedEvents (unique eventId + consumer) đã chặn ở lần thứ 2, 3, 4.
  Đây là thứ giữ hệ thống đúng khi JetStream giao lại — và nó SẼ giao lại:
  khi consumer chết giữa chừng, khi ack_wait hết hạn, khi outbox relay
  publish lại sau lỗi mạng.

  Xem hộp thư: ${MAILPIT}/search?q=${encodeURIComponent(`to:${to}`)}
`);
    return 0;
  } finally {
    await nc.drain();
  }
}

console.log('\nKiểm chứng idempotency của consumer (hệ thống thật)\n');

run()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error('\nKhông chạy được:', err instanceof Error ? err.message : err);
    console.error('Đã chạy `pnpm infra:up` và `pnpm dev:auth` chưa?\n');
    process.exit(1);
  });
