# 12 — Testing Strategy

## 1. Nguyên tắc

> Viết test cho **hành vi**, không cho **cách cài đặt**. Nếu refactor nội bộ mà test đỏ, test đó sai.

Hình tháp cho kiến trúc microservices:

```
          ╱ E2E ╲             ~15 kịch bản  — Playwright, cả hệ thống chạy thật
        ╱──────────╲
      ╱  Contract   ╲         ~60 test      — ⭐ TẦNG MỚI, thay phần lớn integration xuyên service
    ╱────────────────╲
  ╱   Integration     ╲       ~90 test      — trong MỘT service: API + DB + NATS thật
╱──────────────────────╲
╱         Unit          ╲     ~280 test     — domain logic thuần, không I/O
```

**Tầng contract là thay đổi lớn nhất so với kiến trúc monolith.**

Với monolith, muốn test "login xong có gửi email không" thì gọi service và assert. Với 9 service, làm vậy nghĩa là phải chạy cả `identity-service` lẫn `notification-service` lẫn NATS trong một bài test — chậm, giòn, và khi đỏ thì không biết bên nào sai.

Contract test tách đôi: producer tự chứng minh "tôi phát event đúng hình dạng này", consumer tự chứng minh "tôi xử lý được event hình dạng này". Hai bên không bao giờ chạy cùng nhau, nhưng cùng bị ràng buộc bởi một Zod schema trong `packages/contracts`.

### Mục tiêu coverage

| Phạm vi                             | Mục tiêu                  | Ép ở CI                           |
| ----------------------------------- | ------------------------- | --------------------------------- |
| `domain/` của mọi service           | **85%**                   | ✅ fail nếu dưới                  |
| `identity-service` tổng thể         | 90%                       | ✅                                |
| `media-service`, `activity-service` | 85%                       | ✅                                |
| Service khác, tổng thể              | 70%                       | ✅                                |
| `packages/service-kit`              | **90%**                   | ✅ — lỗi ở đây lan ra mọi service |
| `transcode-worker`                  | 60%                       | ⚠️ cảnh báo                       |
| `apps/web`                          | 50%                       | ⚠️ cảnh báo                       |
| **Mọi event trong catalog**         | **100% có contract test** | ✅ — đếm, không phải %dòng        |

Hai dòng in đậm quan trọng nhất. `service-kit` chứa outbox và idempotency — bug ở đó âm thầm làm hỏng dữ liệu ở cả 9 service. Và một event không có contract test là một quả mìn hẹn giờ.

Coverage là **sàn**, không phải mục tiêu. 100% coverage với assert vô nghĩa còn tệ hơn 60% với test tốt.

---

## 2. Unit test

**Phạm vi**: hàm thuần, logic nghiệp vụ không chạm I/O.

Những chỗ đáng viết unit test nhất:

| Đối tượng                                | Vì sao                                                        |
| ---------------------------------------- | ------------------------------------------------------------- |
| `hls-builder.ts` — dựng command FFmpeg   | Nhiều nhánh (nguồn 720p vs 1080p), dễ sai, chạy thật thì chậm |
| Tính toán drift của Watch Party          | Toán thuần, nhiều edge case                                   |
| So sánh maturity rating                  | Sai một dấu `>` là trẻ em xem được phim R                     |
| Chuẩn hóa tiếng Việt không dấu           | Nhiều ký tự đặc biệt                                          |
| Tính `percent`, `completed` của progress | Chia cho 0, duration null                                     |
| Map `error.code` → thông báo             |                                                               |

```ts
// apps/worker/src/ffmpeg/__tests__/hls-builder.spec.ts
describe('buildRenditionLadder', () => {
  it('không tạo rendition vượt độ phân giải nguồn', () => {
    const r = buildRenditionLadder({ width: 1280, height: 720 });
    expect(r.map((x) => x.name)).toEqual(['360p', '480p', '720p']);
  });

  it('bỏ qua rendition khi nguồn thấp hơn mọi bậc', () => {
    const r = buildRenditionLadder({ width: 320, height: 240 });
    expect(r.map((x) => x.name)).toEqual(['360p']); // luôn có ít nhất 1 bậc
  });

  it('đặt keyframe interval theo frame rate để segment thẳng hàng', () => {
    expect(gopSize(24)).toBe(48);
    expect(gopSize(30)).toBe(60);
    expect(gopSize(25)).toBe(50);
  });
});
```

```ts
// Watch party drift
describe('computeSyncAction', () => {
  const base = { positionSec: 100, isPlaying: true, serverTime: 1_000_000 };

  it('bỏ qua khi lệch dưới 300ms', () => {
    expect(
      computeSyncAction(base, { localTime: 1_000_000, currentTime: 100.2, offset: 0 }),
    ).toEqual({ type: 'none' });
  });

  it('chỉnh playbackRate khi lệch vừa', () => {
    const a = computeSyncAction(base, { localTime: 1_000_000, currentTime: 99, offset: 0 });
    expect(a).toMatchObject({ type: 'rate', rate: 1.05 });
  });

  it('seek thẳng khi lệch quá 2 giây', () => {
    const a = computeSyncAction(base, { localTime: 1_000_000, currentTime: 90, offset: 0 });
    expect(a).toMatchObject({ type: 'seek', to: 100 });
  });

  it('bù trừ độ trễ mạng khi đang phát', () => {
    // Thông điệp gửi lúc serverTime, client nhận sau 500ms → vị trí đúng là 100.5
    const a = computeSyncAction(base, { localTime: 1_000_500, currentTime: 100.5, offset: 0 });
    expect(a).toEqual({ type: 'none' });
  });
});
```

---

## 3. Integration test

**Phạm vi**: controller → service → repository → **MongoDB và Redis thật**.

Dùng **Testcontainers** thay vì `mongodb-memory-server`: cần replica set để test transaction, và container cho môi trường giống production hơn.

```ts
// test/setup/containers.ts
let mongo: StartedTestContainer;
let redis: StartedTestContainer;

beforeAll(async () => {
  mongo = await new GenericContainer('mongo:7')
    .withCommand(['--replSet', 'rs0', '--bind_ip_all'])
    .withExposedPorts(27017)
    .start();
  await exec(mongo, ['mongosh', '--eval', 'rs.initiate()']);

  redis = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();

  process.env.MONGO_URI = `mongodb://${mongo.getHost()}:${mongo.getMappedPort(27017)}/test?replicaSet=rs0&directConnection=true`;
  process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
  await redis?.stop();
});

// Dọn giữa các test — xóa collection nhanh hơn drop database
afterEach(async () => {
  const cols = await connection.db.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
  await redisClient.flushdb();
});
```

### Ví dụ — reuse detection

Đây là test quan trọng nhất của toàn dự án.

```ts
describe('POST /auth/refresh — reuse detection', () => {
  it('thu hồi toàn bộ family khi token đã rotate bị dùng lại', async () => {
    const { refreshCookie: rt1 } = await registerAndLogin(app);

    // Lần refresh hợp lệ
    const ok = await request(app).post('/v1/auth/refresh').set('Cookie', rt1).expect(200);
    const rt2 = extractCookie(ok);

    // Chờ qua grace period 10s (fake timer)
    await vi.advanceTimersByTimeAsync(11_000);

    // Dùng lại token cũ → coi là bị đánh cắp
    await request(app)
      .post('/v1/auth/refresh')
      .set('Cookie', rt1)
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe('TOKEN_REUSE_DETECTED'));

    // Token mới (hợp lệ trước đó) cũng phải bị vô hiệu
    await request(app).post('/v1/auth/refresh').set('Cookie', rt2).expect(401);

    const sessions = await Sessions.find({ userId });
    expect(sessions.every((s) => s.status === 'revoked')).toBe(true);
    expect(mailer.sent).toContainEqual(expect.objectContaining({ template: 'security-alert' }));
  });

  it('cho phép dùng lại trong grace period, trả đúng token đã sinh (idempotent)', async () => {
    const { refreshCookie: rt1 } = await registerAndLogin(app);
    const a = await request(app).post('/v1/auth/refresh').set('Cookie', rt1).expect(200);
    const b = await request(app).post('/v1/auth/refresh').set('Cookie', rt1).expect(200);

    expect(extractCookie(b)).toBe(extractCookie(a));
    const sessions = await Sessions.find({ userId, status: 'revoked' });
    expect(sessions).toHaveLength(0); // KHÔNG được revoke
  });

  it('chịu được 5 request refresh song song', async () => {
    const { refreshCookie } = await registerAndLogin(app);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post('/v1/auth/refresh').set('Cookie', refreshCookie),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
  });
});
```

### Các integration test bắt buộc khác

**Auth**

- Login sai password 6 lần → lần 6 trả 429
- Thời gian phản hồi khi email không tồn tại ≈ khi password sai (chống enumeration)
- OAuth: email trùng tài khoản **chưa verify** → bị từ chối
- OAuth: email trùng tài khoản **đã verify** → link thành công
- Đổi password → mọi session khác bị revoke
- Verify token dùng 2 lần → lần 2 trả 410

**Profile**

- Tạo profile thứ 6 → 409
- Tạo 5 profile song song khi đang có 4 → chỉ 1 thành công (test transaction)
- `X-Profile-Id` của user khác → 403

**Catalog**

- Profile kids không thấy title R trong list, search, và home rows
- Search "nguoi nhen" khớp "Người Nhện"
- Title `draft` không xuất hiện với user thường, admin vẫn thấy

**Playback**

- Gói Basic → master playlist chỉ có 360p/480p/720p
- Playback token của asset A không mở được asset B
- Vượt stream limit → 409 kèm danh sách thiết bị
- Heartbeat hết hạn 60s → slot được giải phóng
- Progress upsert đồng thời từ 2 "thiết bị" → không mất dữ liệu, giá trị cuối hợp lệ

**Media**

- Upload file `.exe` đổi tên thành `.mp4` → ffprobe từ chối, asset `failed`
- Key endpoint không có token → 401

---

## 3b. Test riêng cho kiến trúc phân tán

Những bài test này không tồn tại trong kiến trúc monolith. Chúng bắt đúng loại bug mà microservices sinh ra.

### 3b.1 Outbox — không được mất event

```ts
it('ghi dữ liệu và outbox trong cùng transaction', async () => {
  await billing.activate({ userId, plan: 'standard' });

  const sub = await Subscriptions.findOne({ userId });
  const evt = await Outbox.findOne({ type: 'billing.subscription.activated' });

  expect(sub.plan).toBe('standard');
  expect(evt).toBeTruthy();
  expect(evt.data.userId).toBe(userId);
});

it('rollback cả hai khi nghiệp vụ lỗi', async () => {
  vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('boom'));

  await expect(billing.activate({ userId, plan: 'standard' })).rejects.toThrow();

  expect(await Subscriptions.findOne({ userId })).toBeNull();
  expect(await Outbox.countDocuments()).toBe(0); // KHÔNG được còn event mồ côi
});

it('relay không publish hai lần cùng một event', async () => {
  await Outbox.create(makeOutboxDoc());
  await Promise.all([relay.relay(), relay.relay()]); // 2 instance chạy song song

  expect(natsSpy.publish).toHaveBeenCalledTimes(1);
});

it('event ở lại pending khi NATS chết, publish lại khi NATS sống', async () => {
  natsSpy.publish.mockRejectedValueOnce(new Error('connection refused'));
  await Outbox.create(makeOutboxDoc());

  await relay.relay();
  expect((await Outbox.findOne()).status).toBe('pending'); // không mất

  natsSpy.publish.mockResolvedValueOnce(undefined);
  await relay.relay();
  expect((await Outbox.findOne()).status).toBe('published');
});
```

### 3b.2 Idempotency — event đến hai lần

```ts
it('xử lý event hai lần chỉ cập nhật một lần', async () => {
  const event = makeEnvelope('billing.subscription.activated', { userId, plan: 'standard' });

  await handler.handle(event);
  await handler.handle(event); // CÙNG event.id

  expect(await ProcessedEvents.countDocuments({ eventId: event.id })).toBe(1);
  expect(mailerSpy.send).toHaveBeenCalledTimes(1); // không gửi mail 2 lần
});

it('chịu được hai bản sao chạy song song', async () => {
  const event = makeEnvelope('identity.user.registered', { userId, email });

  await Promise.all([handler.handle(event), handler.handle(event)]);

  expect(mailerSpy.send).toHaveBeenCalledTimes(1);
});
```

Bài test song song là bài quan trọng nhất ở đây — nó bắt được lỗi `findOne` rồi mới `insert`, thứ mà test tuần tự luôn bỏ lọt.

### 3b.3 Out-of-order

```ts
it('bỏ qua event cũ hơn dữ liệu hiện có', async () => {
  const newer = makeEnvelope(
    'catalog.title.updated',
    { titleId, title: 'Tên mới' },
    { occurredAt: '2026-10-05T10:00:00Z' },
  );
  const older = makeEnvelope(
    'catalog.title.updated',
    { titleId, title: 'Tên cũ' },
    { occurredAt: '2026-10-05T09:00:00Z' },
  );

  await handler.handle(newer);
  await handler.handle(older); // đến sau nhưng cũ hơn

  expect((await TitleProjections.findOne({ titleId })).title).toBe('Tên mới');
});
```

### 3b.4 Saga — khôi phục sau khi chết giữa chừng

```ts
it('tiếp tục saga dở dang sau khi service restart', async () => {
  // Giả lập: saga đã xong bước 1–3 rồi process chết
  await Sagas.create({
    type: 'delete-account',
    status: 'running',
    currentStep: 4,
    payload: { userId, profileIds },
    completedSteps: [s1, s2, s3],
  });

  await sagaRecovery.onApplicationBootstrap(); // mô phỏng khởi động lại

  const saga = await Sagas.findOne({ payload: { userId } });
  expect(saga.status).toBe('completed');
  expect(saga.completedSteps).toHaveLength(7);
  expect(await Users.findById(userId)).toBeNull();
});

it('chạy bù trừ theo thứ tự ngược khi một bước lỗi', async () => {
  billingClient.cancel.mockRejectedValueOnce(new Error('billing down'));

  await expect(saga.run({ userId })).rejects.toThrow();

  const s = await Sagas.findOne({ payload: { userId } });
  expect(s.status).toBe('failed');
  expect((await Users.findById(userId)).status).toBe('active'); // đã bù trừ bước 1
});
```

### 3b.5 Chịu lỗi — service phụ thuộc chết

```ts
it('trang chủ vẫn hiện khi activity-service chết', async () => {
  activityClient.request.mockRejectedValue(new Error('ECONNREFUSED'));

  const home = await composer.composeHome(ctx);

  expect(home.rows.find((r) => r.key === 'trending')).toBeTruthy();
  expect(home.rows.find((r) => r.key === 'continue')).toBeUndefined(); // mất đúng row này
});

it('circuit breaker mở sau nhiều lỗi liên tiếp, không gọi nữa', async () => {
  catalogClient.request.mockRejectedValue(new Error('timeout'));

  for (let i = 0; i < 10; i++) await composer.composeHome(ctx).catch(() => {});
  const callsBefore = catalogClient.request.mock.calls.length;

  await composer.composeHome(ctx).catch(() => {});
  expect(catalogClient.request.mock.calls.length).toBe(callsBefore); // breaker chặn
});

it('media dùng cache subscription khi identity chết', async () => {
  await redis.set(`cache:media:sub:${userId}`, JSON.stringify({ maxQuality: '1080p' }));
  identityClient.request.mockRejectedValue(new Error('down'));

  const res = await media.authorizePlayback({ userId, assetId });
  expect(res.maxQuality).toBe('1080p');
});
```

---

## 4. WebSocket test

```ts
describe('Watch Party gateway', () => {
  it('từ chối lệnh seek từ người không phải host', async () => {
    const host = await connectSocket(hostToken, hostProfileId);
    const guest = await connectSocket(guestToken, guestProfileId);

    const { code } = await createParty(host, titleId);
    await guest.emitWithAck('party:join', { code });

    const res = await guest.emitWithAck('party:seek', { code, positionSec: 300 });
    expect(res).toMatchObject({ error: 'NOT_HOST' });

    const state = await host.emitWithAck('party:sync-request', { code });
    expect(state.positionSec).toBe(0); // không bị đổi
  });

  it('chuyển host cho người vào sớm nhất sau khi host disconnect 10s', async () => {
    const host = await connectSocket(/* ... */);
    const a = await connectSocket(/* ... */);
    const b = await connectSocket(/* ... */);
    const { code } = await createParty(host, titleId);
    await a.emitWithAck('party:join', { code });
    await sleep(50);
    await b.emitWithAck('party:join', { code });

    const changed = waitForEvent(a, 'party:host-changed');
    host.disconnect();
    await vi.advanceTimersByTimeAsync(10_500);

    expect((await changed).newHostProfileId).toBe(aProfileId);
  });

  it('broadcast tới được client ở instance API khác (Redis adapter)', async () => {
    const app1 = await createTestApp(),
      app2 = await createTestApp();
    const s1 = await connectTo(app1),
      s2 = await connectTo(app2);
    const { code } = await createParty(s1, titleId);
    await s2.emitWithAck('party:join', { code });

    const received = waitForEvent(s2, 'party:playback');
    await s1.emitWithAck('party:play', { code, positionSec: 42 });

    expect(await received).toMatchObject({ positionSec: 42, isPlaying: true });
  });
});
```

---

## 5. Test cho transcode worker

Chạy FFmpeg thật, nhưng trên video **5 giây** sinh tại chỗ — không commit file nhị phân vào repo.

```ts
beforeAll(async () => {
  // testsrc: pattern kiểm thử có sẵn của FFmpeg
  await execa('ffmpeg', [
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=5:size=1920x1080:rate=24',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=5',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    '-y',
    FIXTURE,
  ]);
});

it('tạo HLS với keyframe thẳng hàng giữa các rendition', async () => {
  await processor({ data: { assetId, sourceKey: FIXTURE, renditions: ['360p', '720p', '1080p'] } });

  const asset = await Assets.findById(assetId);
  expect(asset.status).toBe('ready');
  expect(asset.hls.renditions).toHaveLength(3);

  // Mọi rendition phải có cùng số segment và cùng mốc thời gian
  const durations = await Promise.all(
    asset.hls.renditions.map((r) => readSegmentDurations(r.playlistKey)),
  );
  expect(durations[0]).toEqual(durations[1]);
  expect(durations[1]).toEqual(durations[2]);
});

it('xóa output cũ khi chạy lại job', async () => {
  await processor(job);
  const first = await listObjects(`media/${assetId}/`);
  await processor(job); // chạy lại
  const second = await listObjects(`media/${assetId}/`);
  expect(second).toHaveLength(first.length); // không nhân đôi
});

it('đánh dấu failed khi file không phải video', async () => {
  await writeFile(BAD, Buffer.from('không phải video'));
  await expect(processor({ data: { assetId, sourceKey: BAD } })).rejects.toThrow();
  expect((await Assets.findById(assetId)).status).toBe('failed');
});
```

Các test này chậm (~30 giây). Gắn tag `@slow`, chỉ chạy ở CI và khi gọi `pnpm test:slow` — không chạy ở `pnpm test` hàng ngày.

---

## 6. Frontend test

### Component (Vitest + Testing Library)

Test qua **hành vi người dùng**, không qua internal state.

```tsx
it('hiển thị lỗi khi password quá ngắn', async () => {
  const user = userEvent.setup();
  render(<LoginForm />, { wrapper: TestProviders });

  await user.type(screen.getByLabelText(/email/i), 'an@example.com');
  await user.type(screen.getByLabelText(/mật khẩu/i), '123');
  await user.click(screen.getByRole('button', { name: /đăng nhập/i }));

  expect(await screen.findByText(/ít nhất 8 ký tự/i)).toBeInTheDocument();
  expect(mockLogin).not.toHaveBeenCalled();
});
```

Mock network bằng **MSW** (Mock Service Worker) — chặn ở tầng HTTP, không mock module API. Nhờ đó component và api client đều được test thật.

```ts
// test/mocks/handlers.ts
export const handlers = [
  http.post('*/v1/auth/login', async ({ request }) => {
    const { email } = await request.json();
    if (email === 'locked@example.com')
      return HttpResponse.json({ error: { code: 'RATE_LIMITED' } }, { status: 429 });
    return HttpResponse.json({ data: { accessToken: 'fake', user: mockUser } });
  }),
];
```

### Hook

```tsx
it('useProgressSync gửi progress mỗi 10 giây khi đang phát', () => {
  vi.useFakeTimers();
  const video = createMockVideo({ currentTime: 0, duration: 600, paused: false });
  renderHook(() => useProgressSync(video, { titleId: 't1', episodeId: null }));

  video.currentTime = 15;
  vi.advanceTimersByTime(10_000);

  expect(mockApi.updateProgress).toHaveBeenCalledWith(expect.objectContaining({ positionSec: 15 }));
});

it('dùng sendBeacon khi unload', () => {
  const spy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);
  const video = createMockVideo({ currentTime: 42, duration: 600 });
  renderHook(() => useProgressSync(video, playable));

  window.dispatchEvent(new Event('beforeunload'));
  expect(spy).toHaveBeenCalled();
});
```

---

## 7. E2E (Playwright)

Chỉ ~15 kịch bản — những luồng mà hỏng là app vô dụng.

```
E2E-01  Đăng ký → nhận mail (đọc qua Mailpit API) → verify → vào được app
E2E-02  Đăng nhập → chọn profile → thấy trang Browse có dữ liệu
E2E-03  Đăng nhập Google (dùng mock OAuth provider)
E2E-04  Access token hết hạn giữa chừng → tự refresh, user không thấy gì bất thường
E2E-05  Tạo, đổi tên, xóa profile; thử tạo profile thứ 6 → báo lỗi
E2E-06  Search → click kết quả → trang chi tiết đúng
E2E-07  Thêm/xóa My List, reload vẫn đúng
E2E-08  Phát phim → video chạy → tua → tiến độ lưu
E2E-09  Thoát giữa chừng → vào lại → Continue Watching đúng vị trí
E2E-10  Bật/tắt phụ đề, đổi chất lượng thủ công
E2E-11  Watch Party: 2 context, host seek → guest sync; chat qua lại
E2E-12  Profile kids không thấy nội dung R (kiểm cả search)
E2E-13  Admin upload video → progress bar chạy → asset ready → phát được
E2E-14  Vượt stream limit → thông báo đúng
E2E-15  Keyboard-only: Tab tới mọi control chính, phát được phim không dùng chuột
```

### E2E-11 — Watch Party

```ts
test('watch party đồng bộ giữa host và guest', async ({ browser }) => {
  const hostCtx = await browser.newContext({ storageState: 'auth/host.json' });
  const guestCtx = await browser.newContext({ storageState: 'auth/guest.json' });
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await host.goto('/watch/sintel-ep1');
  await host.getByRole('button', { name: /xem cùng/i }).click();
  const invite = await host.getByTestId('invite-link').inputValue();

  await guest.goto(invite);
  await expect(guest.getByTestId('party-members')).toContainText('2');

  await host.getByTestId('seek-bar').click({ position: { x: 300, y: 5 } });

  await expect
    .poll(
      async () => {
        const h = await host.evaluate(() => document.querySelector('video').currentTime);
        const g = await guest.evaluate(() => document.querySelector('video').currentTime);
        return Math.abs(h - g);
      },
      { timeout: 5_000 },
    )
    .toBeLessThan(1);

  await guest.getByTestId('chat-input').fill('phim hay quá');
  await guest.keyboard.press('Enter');
  await expect(host.getByTestId('chat-messages')).toContainText('phim hay quá');
});
```

### Video trong E2E

Dùng một clip **5 giây** làm fixture, không dùng phim thật. Playwright chạy headless Chromium có codec H.264 — nếu chạy Firefox headless thì phải dùng bản có codec đầy đủ.

Khi cần kiểm tra "video thực sự phát", dùng:

```ts
await expect
  .poll(() => page.evaluate(() => document.querySelector('video').currentTime))
  .toBeGreaterThan(0.5);
```

Đừng assert pixel — chậm và dễ flaky.

---

## 8. Chống flaky test

| Nguồn flaky                   | Cách tránh                                             |
| ----------------------------- | ------------------------------------------------------ |
| `waitForTimeout` cố định      | Luôn dùng `expect.poll` hoặc web-first assertion       |
| Thứ tự test phụ thuộc nhau    | Dọn DB ở `afterEach`, mỗi test tự tạo dữ liệu của mình |
| Port trùng khi chạy song song | Testcontainers tự cấp port ngẫu nhiên                  |
| Thời gian thật                | `vi.useFakeTimers()` cho mọi logic liên quan TTL       |
| Race của animation            | `prefers-reduced-motion` bật trong Playwright config   |
| Lấy element theo CSS class    | Dùng `getByRole` / `getByLabelText` / `data-testid`    |

CI retry E2E tối đa 2 lần. Test nào flaky quá 3 lần trong tuần → đưa vào `test.fixme()` và tạo issue, **không** để đỏ triền miên rồi quen mắt.

---

## 9. Chạy test

```bash
pnpm test                      # unit + integration, toàn bộ workspace
pnpm test --filter api         # chỉ API
pnpm test:watch                # chế độ watch
pnpm test:slow                 # có cả test transcode FFmpeg
pnpm test:e2e                  # Playwright
pnpm test:e2e --ui             # Playwright UI mode, debug trực quan
pnpm test -- --coverage        # kèm coverage
```

---

## 10. Test gì khi không chắc

Câu hỏi để tự kiểm tra một test có đáng viết không:

1. **Nếu hàm này hỏng âm thầm thì hậu quả gì?** Trẻ em xem phim R, người dùng mất quyền truy cập, video hỏng → test ngay.
2. **Logic này có bao nhiêu nhánh?** Nhiều `if` → test.
3. **Mình có gõ sai được không mà vẫn chạy?** `>` thay `>=` → test.
4. **Code này sẽ bị refactor không?** Có → test qua hành vi, không qua cài đặt.

Không đáng test: getter/setter thuần, mapping 1-1 không có logic, cấu hình tĩnh, kiểu dữ liệu (TypeScript đã lo).

---

**Quay lại**: [README](../README.md) · [ADR](adr/)
