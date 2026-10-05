# 14 — Inter-service Communication

Đây là tài liệu quan trọng nhất của kiến trúc microservices. Phần lớn bug trong hệ phân tán không nằm trong service nào cả — nó nằm **giữa** chúng.

---

## 1. Hai kiểu giao tiếp

### 1.1 Request/Reply (sync)

```ts
// Gọi
const sub = await this.nats.request<SubscriptionDto>(
  'identity.user.subscription',
  { userId },
  { timeout: 2_000 },
);

// Phục vụ
@MessagePattern('identity.user.subscription')
async getSubscription(@Payload() { userId }: { userId: string }) {
  return this.users.getSubscription(userId);
}
```

Dùng khi user đang đứng chờ câu trả lời. Mỗi lời gọi là một **liên kết cứng** — phải trả lời được: service kia chết thì sao, chậm thì sao.

### 1.2 Event (async)

```ts
// Phát — qua outbox, không publish trực tiếp (xem mục 3)
await this.outbox.publish('billing.subscription.activated', {
  userId, plan: 'standard', periodEnd,
});

// Nghe
@EventPattern('nekoflix.events.billing.subscription.activated')
async onActivated(@Payload() event: SubscriptionActivatedEvent, @Ctx() ctx: NatsContext) {
  await this.handler.handle(event);
  ctx.message.ack();             // ack THỦ CÔNG, sau khi xử lý xong
}
```

Dùng cho mọi thứ còn lại. Người phát không biết ai nghe và không quan tâm.

### 1.3 Chọn kiểu nào

| Câu hỏi                                  | Sync | Event |
| ---------------------------------------- | ---- | ----- |
| User có đang chờ không?                  | ✅   | ❌    |
| Cần kết quả để quyết định tiếp?          | ✅   | ❌    |
| Chịu được trễ vài trăm ms?               | ❌   | ✅    |
| Nhiều bên cùng quan tâm?                 | ❌   | ✅    |
| Service kia chết thì mình vẫn phải chạy? | ❌   | ✅    |

**Mặc định chọn event.** Phải biện minh khi chọn sync, không phải ngược lại.

---

## 2. Quy ước event

### 2.1 Tên subject

```
nekoflix.events.<service>.<aggregate>.<event-quá-khứ>
```

```
nekoflix.events.billing.subscription.activated       ✅
nekoflix.events.catalog.episode.published            ✅
nekoflix.events.identity.user.registered             ✅

nekoflix.events.billing.activate_subscription        ❌ mệnh lệnh, không phải sự kiện
nekoflix.events.update_user                          ❌ thiếu service + aggregate
```

Event là **chuyện đã xảy ra**, luôn ở thì quá khứ. `user.registered`, không phải `register_user`. Khác biệt này không phải vấn đề thẩm mỹ: tên mệnh lệnh ngầm giả định có người phải làm theo — đó là RPC đội lốt event, và nó tạo ra liên kết cứng mà event lẽ ra phải tránh.

### 2.2 Envelope

Mọi event có cùng khung:

```ts
interface EventEnvelope<T> {
  id: string; // UUID — khóa idempotency cho consumer
  type: string; // 'billing.subscription.activated'
  version: number; // schema version, bắt đầu từ 1
  occurredAt: string; // ISO 8601 — thời điểm sự kiện XẢY RA
  producer: string; // 'billing-service@1.4.0'
  traceId: string; // nối vào distributed trace
  correlationId: string; // request gốc của user
  causationId: string | null; // id của event đã gây ra event này
  data: T;
}
```

Ba field hay bị bỏ qua nhưng cực kỳ đáng giá khi debug:

- **`traceId`** — nếu không truyền qua, trace đứt ngay tại ranh giới event và bạn mất khả năng lần vết toàn trình
- **`causationId`** — dựng lại được chuỗi nhân quả: event nào đã sinh ra event nào. Vô giá khi gỡ vòng lặp event
- **`occurredAt`** — thời điểm _xảy ra_, không phải thời điểm _nhận được_. Hai cái này lệch nhau khi có retry, và consumer cần cái trước để phát hiện event cũ

### 2.3 Event phải tự chứa đủ dữ liệu

```ts
// ❌ Chỉ có id — consumer buộc phải gọi ngược lại, tạo liên kết cứng
{ type: 'catalog.episode.published', data: { episodeId: '665f...' } }

// ✅ Đủ để consumer làm việc của mình
{
  type: 'catalog.episode.published',
  data: {
    episodeId: '665f...', titleId: '664a...',
    titleName: 'Sintel', seasonNumber: 1, episodeNumber: 3,
    episodeName: 'Khởi đầu', stillUrl: 'https://...',
    publishedAt: '2026-10-05T04:00:00Z',
  },
}
```

`notification-service` cần tên phim để soạn email. Nếu event chỉ có `episodeId`, nó phải gọi ngược về `catalog-service` — và nếu `catalog-service` đang chết thì email không gửi được, dù event đã nhận thành công. Event tự chứa đủ dữ liệu phá vỡ sự phụ thuộc đó.

Đổi lại: payload lớn hơn, và dữ liệu trong event là **ảnh chụp tại thời điểm xảy ra**, không tự cập nhật. Đó là đúng — event mô tả quá khứ, quá khứ không đổi.

### 2.4 Versioning

Thay đổi tương thích ngược (thêm field optional) → giữ `version`.
Thay đổi phá vỡ (xóa field, đổi ý nghĩa) → **phát song song cả hai version** một thời gian:

```
nekoflix.events.catalog.title.published        (v1, giữ 1 tháng)
nekoflix.events.catalog.title.published.v2
```

Consumer chuyển dần sang v2, rồi mới ngừng phát v1. Không bao giờ đổi nghĩa của một field đang tồn tại — đó là cách nhanh nhất để làm hỏng consumer một cách âm thầm.

---

## 3. Transactional Outbox

### Vấn đề

```ts
// ❌ SAI — nhìn có vẻ đúng
await this.subscriptions.save(sub); // ghi DB
await this.nats.publish('billing.subscription.activated'); // phát event
```

Giữa hai dòng này, process có thể chết. Kết quả: DB đã cập nhật nhưng event không bao giờ được phát. `identity-service` không biết user đã nâng gói — user trả tiền rồi mà vẫn bị giới hạn 720p, **vĩnh viễn**, cho tới khi có người phát hiện thủ công.

Đảo thứ tự cũng không cứu được: phát event rồi chết trước khi ghi DB → consumer xử lý một sự kiện chưa từng xảy ra.

Đây là bài toán **dual write**, và nó không có lời giải nếu không có một transaction bao cả hai. NATS không tham gia được vào transaction của MongoDB.

### Lời giải

Ghi event vào **cùng database, cùng transaction** với dữ liệu nghiệp vụ. Một tiến trình riêng đọc bảng đó và publish.

```ts
// ✅ ĐÚNG
await session.withTransaction(async () => {
  await this.subscriptions.save(sub, { session });
  await this.outbox.insert(
    {
      // CÙNG transaction
      id: randomUUID(),
      type: 'billing.subscription.activated',
      version: 1,
      occurredAt: new Date(),
      traceId: ctx.traceId,
      correlationId: ctx.correlationId,
      data: { userId, plan, periodEnd },
      status: 'pending',
      attempts: 0,
    },
    { session },
  );
});
```

### Collection `outbox`

Mỗi service có một collection này trong database của mình.

```ts
{
  _id: ObjectId,
  id: string,              // UUID, unique — thành envelope.id
  type: string,
  version: number,
  occurredAt: Date,
  traceId: string,
  correlationId: string,
  causationId: string | null,
  data: object,
  status: 'pending' | 'published' | 'failed',
  attempts: number,
  lastError: string | null,
  publishedAt: Date | null,
  createdAt: Date,
}
```

**Index**

```js
{ status: 1, createdAt: 1 }                      // relay quét theo đây
{ id: 1 }                                         // unique
{ publishedAt: 1 }, { expireAfterSeconds: 604800 }  // TTL 7 ngày sau khi publish
```

### Outbox relay

Hai cách:

**A. Polling** — đơn giản, dùng cho mọi service

```ts
@Injectable()
export class OutboxRelay {
  @Interval(1_000)
  async relay() {
    // findOneAndUpdate để nhiều instance không giành nhau cùng một bản ghi
    while (true) {
      const doc = await this.model.findOneAndUpdate(
        { status: 'pending', attempts: { $lt: 10 } },
        { $set: { status: 'publishing' }, $inc: { attempts: 1 } },
        { sort: { createdAt: 1 }, returnDocument: 'after' },
      );
      if (!doc) break;

      try {
        await this.nats.publish(`nekoflix.events.${doc.type}`, toEnvelope(doc));
        await this.model.updateOne(
          { _id: doc._id },
          { $set: { status: 'published', publishedAt: new Date() } },
        );
      } catch (err) {
        await this.model.updateOne(
          { _id: doc._id },
          { $set: { status: 'pending', lastError: String(err) } },
        );
        break; // NATS đang có vấn đề, dừng vòng này
      }
    }
  }
}
```

**B. Change Stream** — độ trễ thấp hơn, cần replica set (đã có sẵn)

```ts
this.model
  .watch([{ $match: { operationType: 'insert' } }], { fullDocument: 'updateLookup' })
  .on('change', (change) => this.publishOne(change.fullDocument));
```

Bắt đầu bằng A. Chuyển sang B nếu độ trễ 1 giây là vấn đề. Dù chọn B vẫn **phải giữ A** chạy nền với chu kỳ dài hơn — change stream có thể đứt và bỏ sót.

### Metric bắt buộc

```
outbox_pending_count{service}
```

Số này tăng dần = relay đang chết = event không được phát = **hệ thống đang lệch dần mà không ném một lỗi nào**. Đây là kiểu hỏng nguy hiểm nhất của kiến trúc này: im lặng.

Đặt cảnh báo khi `pending > 100` hoặc event cũ nhất > 5 phút.

---

## 4. Idempotency ở consumer

JetStream giao **at-least-once**. Nghĩa là mỗi event **sẽ** có lúc được giao hai lần — khi consumer xử lý xong nhưng chết trước khi ack, khi `ack_wait` hết hạn, khi relay publish lại.

Mọi consumer phải xử lý được điều đó.

### Cách 1 — Bảng đã-xử-lý (mặc định)

```ts
async function handle(event: EventEnvelope<T>) {
  const session = await this.conn.startSession();
  try {
    await session.withTransaction(async () => {
      // Insert TRƯỚC, xử lý SAU. Trùng khóa = đã xử lý rồi.
      await this.processedEvents.create(
        [
          {
            eventId: event.id,
            consumer: 'notification-service',
            processedAt: new Date(),
          },
        ],
        { session },
      );

      await this.doWork(event, session);
    });
  } catch (err) {
    if (err.code === 11000) return; // duplicate key → đã xử lý, bỏ qua im lặng
    throw err;
  }
}
```

```js
// processedEvents
{ eventId: 1, consumer: 1 }   // unique
{ processedAt: 1 }, { expireAfterSeconds: 2592000 }   // TTL 30 ngày
```

**Insert trước, xử lý sau, trong cùng transaction.** Không được `findOne` rồi mới `insert` — hai bản sao chạy song song sẽ lọt cả hai qua khe hở giữa hai lệnh.

### Cách 2 — Thao tác tự nhiên idempotent

Tốt hơn khi làm được, vì không cần bảng phụ:

```ts
// ✅ Chạy bao nhiêu lần cũng ra cùng kết quả
await this.progress.updateOne({ profileId, titleId }, { $set: { positionSec } }, { upsert: true });
await this.users.updateOne({ _id }, { $set: { 'subscription.plan': 'standard' } });

// ❌ Chạy 2 lần ra kết quả khác
await this.titles.updateOne({ _id }, { $inc: { viewCount: 1 } });
await this.mailer.send(email);
```

### Cách 3 — Khóa phiên bản (chống out-of-order)

Event có thể đến **sai thứ tự** — subject khác nhau không đảm bảo thứ tự, và retry làm event cũ đến sau event mới.

```ts
// Chỉ ghi nếu event mới hơn dữ liệu hiện có
const res = await this.titleProjections.updateOne(
  { titleId: event.data.titleId, updatedAt: { $lt: event.occurredAt } },
  { $set: { ...projection, updatedAt: event.occurredAt } },
  { upsert: true },
);
// Không khớp điều kiện = đã có dữ liệu mới hơn = bỏ qua, đúng ý
```

### Bảng áp dụng

| Consumer                         | Cách | Vì sao                             |
| -------------------------------- | ---- | ---------------------------------- |
| notification (gửi mail)          | 1    | Gửi mail không idempotent tự nhiên |
| identity (cập nhật subscription) | 2    | `$set` idempotent sẵn              |
| activity (cập nhật projection)   | 3    | Cần chống out-of-order             |
| catalog (tăng view count)        | 1    | `$inc` không idempotent            |
| reco (cập nhật taste vector)     | 1    | Cộng dồn, không idempotent         |

---

## 5. Saga — transaction phân tán

Không có `ROLLBACK` xuyên service. Thay bằng chuỗi bước, mỗi bước có **thao tác bù trừ**.

### 5.1 Hai kiểu

**Choreography** — mỗi service nghe event và tự phản ứng. Không có người điều phối.
→ Dùng cho luồng đơn giản, ít bước, không cần rollback.

**Orchestration** — một orchestrator điều khiển từng bước và biết cách bù trừ.
→ Dùng khi cần rollback, hoặc > 3 bước.

### 5.2 Ví dụ choreography: đăng ký tài khoản

```
identity: tạo user + profile mặc định (1 transaction nội bộ)
          → phát identity.user.registered
                ├→ notification: gửi email verify
                ├→ billing: tạo subscription gói free
                └→ reco: khởi tạo taste vector rỗng
```

Không cần rollback: nếu `billing` lỗi, JetStream retry; nếu retry hết thì vào DLQ và xử lý tay. Người dùng vẫn đăng ký được, chỉ là chưa có bản ghi subscription — chấp nhận được, và tự chữa được.

### 5.3 Ví dụ orchestration: xóa tài khoản (GDPR)

Đây là luồng khó nhất của hệ thống. Chạm 6 service, **không được bỏ sót**, và có bước không bù trừ được.

```
┌─ identity-service (orchestrator) ─────────────────────────────┐
│                                                                │
│ 1. Đánh dấu user.status = 'deleting'   [bù: về 'active']      │
│    → user không đăng nhập được nữa, chặn thao tác mới         │
│                                                                │
│ 2. billing.subscription.cancel          [bù: khôi phục]        │
│    → phải làm TRƯỚC, tránh tiếp tục tính phí                  │
│                                                                │
│ 3. activity.profile.purgeAll            [KHÔNG BÙ ĐƯỢC]        │
│    → xóa progress, history, watchlist, ratings                │
│                                                                │
│ 4. realtime.party.kickUser              [KHÔNG BÙ ĐƯỢC]        │
│                                                                │
│ 5. notification.purgeUser               [KHÔNG BÙ ĐƯỢC]        │
│                                                                │
│ 6. reco.purgeProfiles                   [KHÔNG BÙ ĐƯỢC]        │
│                                                                │
│ 7. Xóa user + profiles + sessions                              │
│    → phát identity.user.deleted                                │
└────────────────────────────────────────────────────────────────┘
```

**Nguyên tắc sắp xếp bước**: đặt các bước **bù trừ được** lên trước, bước **không bù trừ được** về sau. Khi đó, lỗi ở giai đoạn đầu còn quay lui được; qua tới bước xóa dữ liệu thì chỉ còn đường tiến tới (retry cho đến khi xong).

Trạng thái saga phải được **lưu bền**, không giữ trong memory:

```ts
// nekoflix_identity.sagas
{
  _id: ObjectId,
  type: 'delete-account',
  status: 'running' | 'compensating' | 'completed' | 'failed',
  currentStep: number,
  payload: { userId, profileIds },
  completedSteps: [{ step: number, at: Date, result: object }],
  lastError: string | null,
  createdAt, updatedAt
}
```

Process chết giữa saga → lúc khởi động lại, quét `status: 'running'` và tiếp tục từ `currentStep`. Nếu không lưu bền, một lần restart là để lại tài khoản xóa dở — tệ hơn không xóa.

### 5.4 Ví dụ orchestration: nâng gói

```
1. billing: tạo checkout session          [bù: hủy session]
2. (chờ webhook — có thể không bao giờ đến)
3. billing: kích hoạt subscription        [bù: revert về gói cũ]
4. phát billing.subscription.activated
     ├→ identity: cập nhật users.subscription   (eventual)
     └→ media: xóa cache subscription           (eventual)
```

Bước 2 có **timeout**: session quá 30 phút không có webhook → đánh dấu `expired`, giải phóng.

Lưu ý bước 4: user thấy "đã nâng cấp" ngay (billing là nguồn sự thật), nhưng chất lượng video chỉ lên 1080p sau khi `identity` và `media` cập nhật — vài trăm ms. UI phải lường trước: hiện thông báo "Đang áp dụng gói mới..." thay vì để user bấm Play và thấy vẫn 720p rồi tưởng bị lừa.

### 5.5 Khi nào KHÔNG dùng saga

Saga đắt. Trước khi viết một cái, hỏi: **ranh giới service có đang sai không?**

Nếu một thao tác nghiệp vụ _luôn luôn_ phải chạm 3 service cùng lúc và cần tính nguyên tử, thì 3 service đó có lẽ nên là một. Đó là lý do `auth + users + profiles` được gộp thành `identity-service` ([ADR-010](adr/010-microservices.md#những-chỗ-cố-ý-không-tách)) — tách ra thì mỗi lần đăng ký là một saga, và đăng ký là thao tác chạy nhiều nhất hệ thống.

---

## 6. Dead Letter Queue

Event thất bại `max_deliver: 5` lần → chuyển sang `nekoflix.dlq.<subject gốc>`.

```ts
@EventPattern('nekoflix.dlq.>')
async onDeadLetter(@Payload() event: EventEnvelope<unknown>, @Ctx() ctx: NatsContext) {
  await this.dlq.save({
    subject: ctx.getSubject(),
    event,
    failedAt: new Date(),
    lastError: ctx.getHeaders()['x-last-error'],
  });
  this.metrics.dlqTotal.inc({ subject: ctx.getSubject() });
  ctx.message.ack();
}
```

Admin UI cần một trang xem DLQ với: nội dung event, lỗi cuối, số lần thử, và nút **replay**. Không có trang này thì DLQ chỉ là nơi event đi vào để không ai nhìn thấy nữa.

**Cảnh báo khi có bất kỳ message nào vào DLQ.** Khác với `outbox_pending`, DLQ không tự khỏi.

---

## 7. Catalog event đầy đủ

| Subject                          | Producer     | Consumers                                       |
| -------------------------------- | ------------ | ----------------------------------------------- |
| `identity.user.registered`       | identity     | notification, billing, reco                     |
| `identity.user.verified`         | identity     | notification                                    |
| `identity.user.logged_in`        | identity     | notification                                    |
| `identity.user.deleted`          | identity     | activity, billing, reco, notification, realtime |
| `identity.user.suspended`        | identity     | realtime (ngắt kết nối)                         |
| `identity.profile.created`       | identity     | reco                                            |
| `identity.profile.deleted`       | identity     | activity, reco                                  |
| `identity.security.alert`        | identity     | notification, realtime                          |
| `catalog.title.published`        | catalog      | activity (projection), reco                     |
| `catalog.title.updated`          | catalog      | activity (projection)                           |
| `catalog.title.unpublished`      | catalog      | activity                                        |
| `catalog.title.deleted`          | catalog      | activity, media                                 |
| `catalog.episode.published`      | catalog      | notification, activity                          |
| `media.asset.ready`              | media        | catalog, notification, realtime                 |
| `media.asset.failed`             | media        | catalog, realtime                               |
| `media.transcode.progress`       | worker       | realtime                                        |
| `activity.progress.updated`      | activity     | reco                                            |
| `activity.title.completed`       | activity     | catalog (view count), reco                      |
| `activity.watchlist.added`       | activity     | notification, reco                              |
| `activity.watchlist.removed`     | activity     | notification, reco                              |
| `activity.rating.changed`        | activity     | reco                                            |
| `billing.subscription.activated` | billing      | identity, media, notification                   |
| `billing.subscription.changed`   | billing      | identity, media, notification                   |
| `billing.subscription.canceled`  | billing      | identity, media, notification                   |
| `billing.payment.failed`         | billing      | notification                                    |
| `notification.created`           | notification | realtime                                        |

### Kiểm tra vòng lặp

Nguy hiểm nhất của event-driven: A phát → B nghe → B phát → A nghe → vô hạn.

Ví dụ suýt xảy ra trong catalog này:

```
activity.title.completed → catalog (tăng viewCount)
                         → catalog.title.updated
                         → activity (cập nhật projection)
                         → ...dừng, vì activity không phát gì từ đây ✅
```

Chuỗi này dừng đúng chỗ, nhưng rất gần ranh giới. Hai biện pháp:

- **`causationId`** cho phép dựng lại chuỗi và phát hiện vòng lặp khi debug
- Giới hạn độ sâu: nếu một chuỗi causation vượt 5 bước → log cảnh báo

Giải pháp tốt hơn cho chính ví dụ trên: `catalog` **không** phát `title.updated` khi chỉ đổi `stats` — tách thành `catalog.title.stats_updated` mà `activity` không nghe. Event riêng cho thay đổi riêng, đừng dồn mọi thay đổi vào một event.

---

## 8. Contract testing

Với 9 service, chạy cả hệ thống lên để test là chậm và giòn. Thay bằng **contract test**: mỗi bên tự test với một bản mô tả hợp đồng chung.

### 8.1 Hợp đồng ở đâu

`packages/contracts` giữ Zod schema cho **mọi** event và mọi NATS request/reply. Cả producer lẫn consumer đều import từ đó.

```ts
// packages/contracts/src/events/billing.ts
export const subscriptionActivatedV1 = z.object({
  userId: z.string(),
  plan: z.enum(['basic', 'standard', 'premium']),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  maxStreams: z.number().int().positive(),
  maxQuality: z.enum(['480p', '720p', '1080p']),
});
export type SubscriptionActivatedV1 = z.infer<typeof subscriptionActivatedV1>;
```

### 8.2 Producer test

```ts
it('event phát ra khớp hợp đồng', async () => {
  await billingService.activate({ userId, plan: 'standard' });

  const [outboxDoc] = await outbox.find({ type: 'billing.subscription.activated' });
  expect(() => subscriptionActivatedV1.parse(outboxDoc.data)).not.toThrow();
});
```

### 8.3 Consumer test

```ts
it('xử lý được event đúng hợp đồng, không cần billing-service chạy', async () => {
  const event = makeEnvelope(
    'billing.subscription.activated',
    subscriptionActivatedV1.parse(FIXTURE),
  );

  await identityHandler.handle(event);

  const user = await Users.findById(FIXTURE.userId);
  expect(user.subscription.plan).toBe('standard');
});
```

Hai bên không bao giờ chạy cùng nhau trong test, nhưng cả hai đều bị ràng buộc bởi cùng một schema. Đổi schema mà quên một bên → TypeScript báo lỗi lúc build.

### 8.4 Kiểm tra tương thích ngược ở CI

```ts
// Snapshot schema đã publish, so với schema hiện tại
it('schema không có thay đổi phá vỡ tương thích', () => {
  const published = loadSnapshot('billing.subscription.activated.v1.json');
  const current = zodToJsonSchema(subscriptionActivatedV1);

  // Thêm field optional: OK. Xóa field, đổi type, thêm required: FAIL
  expect(checkBackwardCompatible(published, current)).toEqual({ compatible: true });
});
```

Đây là lưới an toàn quan trọng nhất. Thiếu nó, một dòng sửa schema có thể làm chết consumer ở service khác mà không ai biết cho tới lúc chạy thật.

---

## 9. Checklist khi thêm một event mới

- [ ] Tên theo `<service>.<aggregate>.<quá-khứ>`
- [ ] Zod schema trong `packages/contracts`, có `version`
- [ ] Payload tự chứa đủ dữ liệu — consumer không phải gọi ngược
- [ ] Phát **qua outbox**, trong cùng transaction với dữ liệu nghiệp vụ
- [ ] Mỗi consumer có cơ chế idempotency rõ ràng (cách 1, 2 hay 3?)
- [ ] Consumer ack **thủ công**, sau khi xử lý xong
- [ ] Đã kiểm tra không tạo vòng lặp event
- [ ] Có contract test cho cả producer và consumer
- [ ] Ghi vào bảng ở [mục 7](#7-catalog-event-đầy-đủ) và [13 — Service Catalog](13-service-catalog.md)
- [ ] `traceId` được truyền qua

---

**Tiếp theo**: [03 — Database Schema](03-database-schema.md) · [09 — Project Structure](09-project-structure.md)
