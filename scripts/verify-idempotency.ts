/**
 * Kiểm chứng idempotency của consumer TRÊN HỆ THỐNG THẬT.
 *
 *   pnpm verify:idempotency    (cần hạ tầng + 3 service đang chạy)
 *
 * Vì sao cần script riêng, không gộp vào `pnpm smoke`:
 *
 * JetStream giao at-least-once — mỗi event SẼ có lúc được giao hai lần.
 * Nhưng ở luồng chạy bình thường điều đó gần như không xảy ra, nên smoke
 * test không bao giờ chạm tới nhánh code đó. Script này ÉP nó xảy ra.
 *
 * Cách làm: publish thẳng lên JetStream một bản sao của event đã xử lý,
 * KHÔNG kèm msgID. Bỏ msgID là cố ý — có msgID thì broker tự khử trùng
 * trong cửa sổ 2 phút và ta sẽ chỉ test được dedup của NATS, chứ không test
 * được idempotency của chính consumer.
 */
import { connect, JSONCodec } from 'nats';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:4000';
const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4222';

const codec = JSONCodec();

async function countReceived(): Promise<number> {
  const res = await fetch(`${GATEWAY}/v1/ping/received`);
  const body = (await res.json()) as { items: unknown[] };
  return body.items.length;
}

async function main(): Promise<void> {
  console.log('\nKiểm chứng idempotency của consumer (hệ thống thật)\n');

  // 1. Tạo một echo mới và chờ pong-service xử lý
  const created = (await (
    await fetch(`${GATEWAY}/v1/ping/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `idem-${Date.now()}` }),
    })
  ).json()) as { echoId: string; message: string; createdAt: string };

  console.log(`  1. Đã tạo echo ${created.echoId}`);

  const deadline = Date.now() + 15_000;
  let before = await countReceived();
  const target = before + 1;
  while (Date.now() < deadline && before < target) {
    await new Promise((r) => setTimeout(r, 300));
    before = await countReceived();
  }
  console.log(`  2. pong-service đã nhận. Tổng bản ghi: ${before}`);

  // 2. Lấy lại envelope thật từ outbox của ping-service, rồi publish lại
  //    y hệt — cùng envelope.id, nhưng KHÔNG msgID.
  const nc = await connect({ servers: NATS_URL.split(',') });
  const js = nc.jetstream();

  const envelope = {
    id: `replay-probe-${created.echoId}`,
    type: 'ping.echo.created',
    version: 1,
    occurredAt: created.createdAt,
    producer: 'verify-idempotency@0.1.0',
    traceId: '',
    correlationId: '',
    causationId: null,
    data: {
      echoId: created.echoId, // CÙNG echoId -> nếu xử lý 2 lần sẽ đụng unique index
      message: created.message,
      createdBy: 'verify-script',
      createdAt: created.createdAt,
    },
  };

  console.log('  3. Publish bản sao lên JetStream (không msgID) x3 ...');
  for (let i = 0; i < 3; i++) {
    await js.publish('nekoflix.events.ping.echo.created', codec.encode(envelope));
  }

  await new Promise((r) => setTimeout(r, 6_000));
  const after = await countReceived();
  await nc.drain();

  // 3. Kết luận
  console.log(`  4. Tổng bản ghi sau khi gửi lại 3 lần: ${after}`);
  console.log(`\n${'─'.repeat(52)}`);

  if (after === before) {
    console.log(`
  ĐẠT. Gửi lại cùng một event 3 lần -> KHÔNG tạo thêm bản ghi nào.

  processedEvents (unique eventId + consumer) đã chặn ở lần thứ 2 và 3.
  Đây là thứ giữ cho hệ thống đúng khi JetStream giao lại — và nó SẼ
  giao lại: khi consumer chết giữa chừng, khi ack_wait hết hạn, khi
  outbox relay publish lại sau lỗi mạng.
`);
    process.exit(0);
  }

  console.log(`
  THẤT BẠI. Số bản ghi tăng từ ${before} lên ${after}.

  Consumer đang xử lý cùng một event nhiều lần. Kiểm tra:
    - IdempotencyService.runOnce có INSERT TRƯỚC, xử lý SAU không?
    - Unique index { eventId, consumer } trên processedEvents còn không?
    - Handler có ghi qua đúng session được truyền vào không?
`);
  process.exit(1);
}

main().catch((err) => {
  console.error('\nKhông chạy được:', err instanceof Error ? err.message : err);
  console.error('Đã chạy `pnpm infra:up` và `pnpm dev:ping` chưa?\n');
  process.exit(1);
});
