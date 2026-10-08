/**
 * Kiểm chứng hệ thống trên hạ tầng THẬT.
 *
 * Chạy: pnpm smoke
 *   (cần `pnpm infra:up` + gateway, identity-service, notification-service)
 *
 * Khác `pnpm test`: unit test chạy trên MongoDB in-memory, không có NATS,
 * không có SMTP. Script này trả lời câu hỏi mà unit test không trả lời được —
 * đường dây GIỮA các service có thực sự thông không:
 *
 *   HTTP -> gateway -> NATS -> identity -> DB+outbox (1 transaction)
 *        -> JetStream -> notification -> email outbox -> SMTP -> Mailpit
 */
const BASE = process.env.GATEWAY_URL ?? 'http://localhost:4000';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/** Grace period của rotation là 10s — chờ dư 1.5s cho chắc */
const GRACE_WAIT_MS = 11_500;

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

interface ApiResult {
  status: number;
  body: Record<string, unknown> | null;
  cookies: string[];
}

async function api(path: string, init: RequestInit = {}, cookie?: string): Promise<ApiResult> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as Record<string, unknown> | null,
    cookies: res.headers.getSetCookie(),
  };
}

/** Lấy phần `nf_rt=...` của cookie, bỏ các thuộc tính Path/HttpOnly/... */
function refreshCookie(cookies: string[]): string {
  const raw = cookies.find((c) => c.startsWith('nf_rt='));
  assert(raw, 'response không đặt cookie nf_rt');
  return raw.split(';')[0]!;
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result != null) return result;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Quá ${timeoutMs}ms vẫn chưa thấy: ${label}`);
}

const data = <T>(r: ApiResult): T => (r.body as { data: T }).data;

const errorCode = (r: ApiResult): string =>
  (r.body as { error?: { code?: string } } | null)?.error?.code ??
  `(không có mã, HTTP ${r.status})`;

const ok2xx = (r: ApiResult): boolean => r.status >= 200 && r.status < 300;

// ── Mailpit ──────────────────────────────────────────────────────
interface MailSummary {
  ID: string;
  Subject: string;
}

async function inbox(email: string): Promise<MailSummary[]> {
  const res = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=50`,
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { messages: MailSummary[] };
  return body.messages;
}

async function mailText(id: string): Promise<string> {
  const res = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  const body = (await res.json()) as { Text: string };
  return body.Text;
}

// ═════════════════════════════════════════════════════════════════
async function main(): Promise<void> {
  console.log(`\nNekoflix — smoke test (${BASE})\n`);

  const email = `smoke-${Date.now()}@nekoflix.local`;
  const PASSWORD = 'Matkhau123';

  // ── 1. Hạ tầng ──────────────────────────────────────────────
  console.log('1. Sức khoẻ hệ thống');

  for (const [name, port] of [
    ['gateway', 4000],
    ['identity-service', 4001],
    ['notification-service', 4007],
  ] as const) {
    await check(`${name} sẵn sàng`, async () => {
      const res = await fetch(`http://localhost:${port}/health/ready`);
      assert(res.ok, `trả ${res.status} — service chưa chạy, hoặc NATS/Mongo chưa lên`);
    });
  }

  await check('gateway báo NATS đã kết nối', async () => {
    const r = await api('/health/ready');
    const checks = r.body?.checks as Record<string, boolean> | undefined;
    assert(checks?.nats, 'NATS chưa kết nối');
  });

  // ── 2. Đăng ký ──────────────────────────────────────────────
  console.log('\n2. Đăng ký');

  let firstCookie = '';

  await check('tạo tài khoản mới', async () => {
    const r = await api('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password: PASSWORD, displayName: 'Smoke Test' }),
    });
    assert(ok2xx(r), `mong đợi 2xx, nhận ${r.status}: ${errorCode(r)}`);

    const d = data<{ accessToken: string; user: { email: string } }>(r);
    assert(d.user.email === email, `email trả về sai: ${d.user.email}`);
    assert(typeof d.accessToken === 'string' && d.accessToken.length > 0, 'thiếu accessToken');

    firstCookie = refreshCookie(r.cookies);
  });

  await check('refresh token CHỈ nằm trong cookie httpOnly, không vào body', async () => {
    const r = await api('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: `cookie-${Date.now()}@nekoflix.local`,
        password: PASSWORD,
        displayName: 'Cookie Test',
      }),
    });
    const raw = r.cookies.find((c) => c.startsWith('nf_rt='))!;
    assert(/HttpOnly/i.test(raw), 'cookie thiếu HttpOnly — JavaScript đọc được token');
    assert(/SameSite=Lax/i.test(raw), 'cookie thiếu SameSite=Lax');

    const token = raw.split(';')[0]!.slice('nf_rt='.length);
    assert(
      !JSON.stringify(r.body).includes(token),
      'refresh token lọt vào body JSON — httpOnly mất hết ý nghĩa',
    );
  });

  await check('mật khẩu yếu bị từ chối (VALIDATION_FAILED)', async () => {
    const r = await api('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'yeu@nekoflix.local', password: '123', displayName: 'Yeu' }),
    });
    assert(r.status === 400, `mong đợi 400, nhận ${r.status}`);
    assert(errorCode(r) === 'VALIDATION_FAILED', `mã sai: ${errorCode(r)}`);
  });

  await check('email trùng -> EMAIL_TAKEN', async () => {
    const r = await api('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password: PASSWORD, displayName: 'Trung' }),
    });
    assert(errorCode(r) === 'EMAIL_TAKEN', `mã sai: ${errorCode(r)}`);
  });

  // ── 3. Event xuyên service ──────────────────────────────────
  console.log('\n3. identity -> outbox -> JetStream -> notification -> SMTP');

  let verifyToken = '';

  await check('email xác thực tới được Mailpit', async () => {
    const msg = await waitFor(`email gửi tới ${email}`, async () =>
      (await inbox(email)).find((m) => m.Subject.includes('Xác thực email')),
    );

    // Lấy token TỪ TRONG EMAIL, không lấy từ DB: đây là thứ người dùng
    // thật sự nhận được. Token đúng trong DB mà link trong mail hỏng thì
    // tính năng vẫn hỏng.
    const text = await mailText(msg.ID);
    const match = /\/verify\?token=([\w%.-]+)/.exec(text);
    assert(match, 'không tìm thấy link xác thực trong nội dung email');
    verifyToken = decodeURIComponent(match[1]!);
  });

  await check('token trong email dùng được để xác thực', async () => {
    const r = await api('/v1/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token: verifyToken }),
    });
    assert(ok2xx(r), `xác thực thất bại: ${errorCode(r)}`);
    assert(
      data<{ user: { emailVerified: boolean } }>(r).user.emailVerified,
      'xác thực xong nhưng emailVerified vẫn false',
    );
  });

  await check('token xác thực dùng lại lần hai -> TOKEN_CONSUMED', async () => {
    const r = await api('/v1/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token: verifyToken }),
    });
    assert(errorCode(r) === 'TOKEN_CONSUMED', `mã sai: ${errorCode(r)}`);
  });

  await check('xác thực xong lại sinh ra email thứ hai (event vòng hai)', async () => {
    await waitFor('email "Email đã được xác thực"', async () =>
      (await inbox(email)).find((m) => m.Subject.includes('đã được xác thực')),
    );
  });

  // ── 4. Rotation + phát hiện dùng lại token ──────────────────
  console.log('\n4. Refresh rotation và phát hiện token bị đánh cắp');

  let secondCookie = '';

  await check('refresh hợp lệ -> cấp token mới (rotation)', async () => {
    const r = await api('/v1/auth/refresh', { method: 'POST' }, firstCookie);
    assert(ok2xx(r), `refresh thất bại: ${errorCode(r)}`);
    secondCookie = refreshCookie(r.cookies);
    assert(secondCookie !== firstCookie, 'cookie không đổi — rotation không chạy');
  });

  await check('token cũ dùng lại NGAY -> vẫn chấp nhận (grace period)', async () => {
    // Nhiều tab cùng refresh một lúc là chuyện bình thường, không phải
    // tấn công. Không có grace period thì người dùng bị đăng xuất oan.
    const r = await api('/v1/auth/refresh', { method: 'POST' }, firstCookie);
    assert(ok2xx(r), `bị từ chối oan trong grace period: ${errorCode(r)}`);
  });

  await check(
    `token cũ dùng lại sau grace period -> TOKEN_REUSE_DETECTED (chờ ${GRACE_WAIT_MS / 1000}s)`,
    async () => {
      await new Promise((r) => setTimeout(r, GRACE_WAIT_MS));
      const r = await api('/v1/auth/refresh', { method: 'POST' }, firstCookie);
      assert(errorCode(r) === 'TOKEN_REUSE_DETECTED', `mã sai: ${errorCode(r)}`);
    },
  );

  await check('token MỚI cũng chết theo — cả token family bị thu hồi', async () => {
    // Đây mới là điểm quan trọng. Kẻ trộm dùng token cũ -> không chỉ nó bị
    // chặn, mà cả phiên nó đang giữ cũng mất. Nếu token mới vẫn sống thì
    // phát hiện trộm chẳng để làm gì.
    const r = await api('/v1/auth/refresh', { method: 'POST' }, secondCookie);
    assert(errorCode(r) === 'TOKEN_REUSE_DETECTED', `mã sai: ${errorCode(r)}`);
  });

  await check('người dùng được cảnh báo qua email', async () => {
    await waitFor('email cảnh báo bảo mật', async () =>
      (await inbox(email)).find((m) => m.Subject.includes('Cảnh báo bảo mật')),
    );
  });

  // ── 5. Hồ sơ xem ────────────────────────────────────────────
  console.log('\n5. Hồ sơ xem');

  // Mọi phiên đã bị thu hồi ở bước trên -> phải đăng nhập lại
  const login = await api('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  assert(ok2xx(login), `không đăng nhập lại được: ${errorCode(login)}`);
  const auth = { Authorization: `Bearer ${data<{ accessToken: string }>(login).accessToken}` };

  let profileId = '';

  await check('đăng ký đã tạo sẵn một hồ sơ mặc định', async () => {
    const r = await api('/v1/profiles', { headers: auth });
    assert(ok2xx(r), `lấy danh sách thất bại: ${errorCode(r)}`);

    const d = data<{ items: { id: string; name: string }[]; remaining: number }>(r);
    assert(d.items.length === 1, `mong đợi 1 hồ sơ, có ${d.items.length}`);
    assert(d.remaining === 4, `remaining phải là 4, nhận ${d.remaining}`);
    profileId = d.items[0]!.id;
  });

  await check('chọn hồ sơ -> access token mới mang claim pid', async () => {
    const r = await api(
      `/v1/profiles/${profileId}/select`,
      { method: 'POST', body: JSON.stringify({}), headers: auth },
      undefined,
    );
    assert(ok2xx(r), `chọn hồ sơ thất bại: ${errorCode(r)}`);

    const token = data<{ accessToken: string }>(r).accessToken;
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as {
      pid?: string;
    };

    assert(claims.pid === profileId, `pid trong token sai: ${String(claims.pid)}`);
  });

  await check('không có access token -> 401', async () => {
    const r = await api('/v1/profiles');
    assert(r.status === 401, `mong đợi 401, nhận ${r.status}`);
  });

  await check('token rác -> 401 (guard đóng mặc định)', async () => {
    const r = await api('/v1/profiles', { headers: { Authorization: 'Bearer khong-phai-jwt' } });
    assert(r.status === 401, `mong đợi 401, nhận ${r.status}`);
  });

  // ── 6. Chống dò danh sách người dùng ────────────────────────
  console.log('\n6. Chống dò danh sách người dùng');

  await check('quên mật khẩu: email thật và email bịa trả về GIỐNG HỆT', async () => {
    const [real, fake] = await Promise.all([
      api('/v1/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
      api('/v1/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: `khong-ton-tai-${Date.now()}@nekoflix.local` }),
      }),
    ]);

    assert(real.status === fake.status, `status khác nhau: ${real.status} vs ${fake.status}`);
    assert(
      JSON.stringify(real.body) === JSON.stringify(fake.body),
      'nội dung phản hồi khác nhau -> lộ email nào có thật trong hệ thống',
    );
  });

  await check('đăng nhập: sai mật khẩu và email lạ cùng một mã lỗi', async () => {
    const [wrong, unknownUser] = await Promise.all([
      api('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'SaiMatKhau123' }),
      }),
      api('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'khong-co-ai@nekoflix.local', password: 'SaiMatKhau123' }),
      }),
    ]);

    assert(errorCode(wrong) === 'INVALID_CREDENTIALS', `mã sai: ${errorCode(wrong)}`);
    assert(errorCode(unknownUser) === 'INVALID_CREDENTIALS', `mã sai: ${errorCode(unknownUser)}`);
  });

  await check('email đặt lại mật khẩu thật sự được gửi', async () => {
    await waitFor('email "Đặt lại mật khẩu"', async () =>
      (await inbox(email)).find((m) => m.Subject.includes('Đặt lại mật khẩu')),
    );
  });

  // ── 7. Chịu lỗi ─────────────────────────────────────────────
  console.log('\n7. Chịu lỗi');

  await check('nhiều lần sai mật khẩu KHÔNG mở circuit breaker', async () => {
    for (let i = 0; i < 8; i++) {
      await api('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'SaiMatKhau123' }),
      });
    }

    // Sai mật khẩu là lỗi NGHIỆP VỤ, không phải identity-service hỏng.
    // Đếm nhầm vào breaker thì vài lần gõ sai sẽ làm đăng nhập của MỌI
    // NGƯỜI chết trong 10 giây.
    const r = await api('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    assert(ok2xx(r), `đăng nhập ĐÚNG bị chặn sau khi sai nhiều lần: ${errorCode(r)}`);
  });

  // ── 8. Trang Tài khoản ──────────────────────────────────────
  // Để CUỐI CÙNG vì nó đổi mật khẩu rồi thu hồi mọi phiên — chạy sớm hơn
  // sẽ làm hỏng các mục phía trên.
  console.log('\n8. Đổi mật khẩu và quản lý thiết bị');

  const NEW_PASSWORD = 'MatkhauMoi456';

  // Phiên thứ hai, giả làm một thiết bị khác
  const other = await api('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD }),
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0' },
  });
  const otherAuth = { Authorization: `Bearer ${data<{ accessToken: string }>(other).accessToken}` };

  await check('tài khoản tạo bằng email -> hasPassword = true', async () => {
    // Giao diện dựa vào cờ này để chọn giữa "đổi mật khẩu" và "đặt mật
    // khẩu". Trả sai thì tài khoản OAuth bị hỏi mật khẩu cũ mà họ không có.
    const r = await api('/v1/auth/oauth', { headers: otherAuth });
    const d = data<{ items: unknown[]; hasPassword: boolean; canUnlink: boolean }>(r);

    assert(d.hasPassword === true, 'hasPassword phải là true');
    assert(d.items.length === 0, 'chưa liên kết provider nào');
  });

  await check('đổi mật khẩu với mật khẩu cũ SAI -> INVALID_CREDENTIALS', async () => {
    // Đã đăng nhập vẫn phải xác nhận mật khẩu cũ: thiếu bước này, ai mượn
    // được máy lúc đang mở là chiếm luôn tài khoản.
    const r = await api('/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'HoanToanSai123', newPassword: NEW_PASSWORD }),
      headers: otherAuth,
    });
    assert(errorCode(r) === 'INVALID_CREDENTIALS', `mã sai: ${errorCode(r)}`);
  });

  await check('đổi mật khẩu -> thu hồi thiết bị KHÁC, giữ thiết bị hiện tại', async () => {
    const r = await api('/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
      headers: otherAuth,
    });
    assert(ok2xx(r), `đổi mật khẩu thất bại: ${errorCode(r)}`);
    assert(
      data<{ revokedSessions: number }>(r).revokedSessions > 0,
      'không thu hồi phiên nào — thiết bị cũ vẫn vào được bằng mật khẩu đã lộ',
    );

    // Người chủ động đổi mật khẩu không nên bị đá ra khỏi chính máy họ đang dùng
    const still = await api('/v1/auth/sessions', { headers: otherAuth });
    assert(ok2xx(still), `phiên hiện tại bị thu hồi oan: ${errorCode(still)}`);
    assert(
      data<{ items: unknown[] }>(still).items.length === 1,
      'phải chỉ còn đúng một phiên — chính thiết bị này',
    );
  });

  await check('mật khẩu CŨ không dùng được nữa', async () => {
    const r = await api('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    assert(errorCode(r) === 'INVALID_CREDENTIALS', `mã sai: ${errorCode(r)}`);
  });

  await check('người dùng được báo qua email', async () => {
    await waitFor('email "Mật khẩu của bạn đã được thay đổi"', async () =>
      (await inbox(email)).find((m) => m.Subject.includes('Mật khẩu của bạn')),
    );
  });

  await check('logout-all thu hồi MỌI phiên, kể cả phiên gọi lệnh', async () => {
    const fresh = await api('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: NEW_PASSWORD }),
    });
    assert(ok2xx(fresh), `đăng nhập bằng mật khẩu mới thất bại: ${errorCode(fresh)}`);
    const freshCookie = refreshCookie(fresh.cookies);
    const freshAuth = {
      Authorization: `Bearer ${data<{ accessToken: string }>(fresh).accessToken}`,
    };

    const r = await api('/v1/auth/logout-all', { method: 'POST' }, undefined);
    assert(r.status === 401, 'logout-all phải yêu cầu access token, không chỉ cookie');

    const done = await api('/v1/auth/logout-all', { method: 'POST', headers: freshAuth });
    assert(ok2xx(done), `logout-all thất bại: ${errorCode(done)}`);

    // Refresh token của chính phiên vừa gọi cũng phải chết — nếu không,
    // "đăng xuất mọi thiết bị" chừa lại đúng thiết bị đang bị chiếm.
    const after = await api('/v1/auth/refresh', { method: 'POST' }, freshCookie);
    assert(after.status === 401, `refresh vẫn sống sau logout-all: ${after.status}`);
  });

  // ── 9. Ranh giới database (chạy tay) ────────────────────────
  // Kiểm chứng ADR-012 ở tầng hạ tầng, không phải trên giấy. Cần docker
  // exec nên không gộp vào đây được:
  //
  //   docker exec nekoflix-mongo mongosh --quiet \
  //     -u identity_svc -p devpassword --authenticationDatabase admin \
  //     --eval 'db.getSiblingDB("nekoflix_notification").emailoutboxes.countDocuments()'
  //
  // PHẢI trả "Unauthorized". Đọc được nghĩa là MongoDB đang chạy thiếu
  // --auth và toàn bộ DB user chỉ là trang trí.

  // ── Kết quả ─────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(56)}`);
  console.log(`  ${passed} đạt, ${failed} thất bại`);

  if (failed === 0) {
    console.log(`
  ĐẠT. Đường dây đã thông:
    HTTP -> gateway -> NATS -> identity -> DB+outbox (1 transaction)
         -> JetStream -> notification -> email outbox -> SMTP

  Còn một việc PHẢI tự nhìn bằng mắt:
    Mở http://localhost:16686 (Jaeger), chọn service "gateway", xem trace
    gần nhất. Phải là MỘT chuỗi liền mạch gateway -> identity-service
    (và nhánh event sang notification-service). Thấy nhiều trace rời rạc
    nghĩa là trace context đang bị đứt.
`);
  } else {
    console.log('\n  CHƯA ĐẠT.\n');
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSmoke test không chạy được:', err instanceof Error ? err.message : err);
  console.error('Đã chạy `pnpm infra:up` và `pnpm dev:auth` chưa?\n');
  process.exit(1);
});
