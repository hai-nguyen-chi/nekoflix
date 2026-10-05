# 03 — Database Schema (MongoDB)

## Sở hữu dữ liệu

Kiến trúc microservices: **mỗi database thuộc về đúng một service**, mỗi service có DB user riêng chỉ truy cập được database của mình. Lý do và cách enforce: [ADR-012](adr/012-database-per-service.md).

| Database                | Service         | Collections                                                        |
| ----------------------- | --------------- | ------------------------------------------------------------------ |
| `nekoflix_identity`     | identity        | `users` `profiles` `sessions` `verificationTokens` `sagas`         |
| `nekoflix_catalog`      | catalog         | `titles` `episodes` `genres` `people`                              |
| `nekoflix_media`        | media (+worker) | `assets` `mediaKeys`                                               |
| `nekoflix_activity`     | activity        | `progress` `watchHistory` `watchlist` `ratings` `titleProjections` |
| `nekoflix_realtime`     | realtime        | `watchParties`                                                     |
| `nekoflix_billing`      | billing         | `subscriptions` `payments` `paymentEvents` `checkoutSessions`      |
| `nekoflix_notification` | notification    | `notifications` `emailOutbox` `subscriberIndex`                    |
| `nekoflix_reco`         | recommendation  | `titleSimilarity` `tasteVectors` `titleFeatures`                   |

Mỗi database còn có **`outbox`** và **`processedEvents`** — xem [mục 19](#19-collection-hạ-tầng-mọi-database).

> **Cấm tuyệt đối**: không service nào mở connection tới database của service khác, kể cả read-only. Quy tắc này được ép bằng phân quyền MongoDB, không phải bằng kỷ luật.

### Hệ quả: không còn `$lookup` xuyên service

`progress` (activity) và `titles` (catalog) giờ nằm ở hai database khác nhau. Mọi truy vấn tổng hợp phải dùng một trong ba cách ở [02 — Chiến lược dữ liệu](02-architecture.md#6-chiến-lược-dữ-liệu): API composition ở gateway, read model qua event, hoặc denormalize lúc ghi.

`ObjectId` tham chiếu xuyên service (vd `progress.titleId`) vẫn tồn tại — nhưng nó chỉ là **một chuỗi id**, không có ràng buộc, không join được. Không có gì đảm bảo title đó còn tồn tại. Phải xử lý trường hợp id trỏ vào hư không.

## Nguyên tắc thiết kế

1. **Embed khi đọc cùng nhau và bị giới hạn kích thước**; **reference khi quan hệ nhiều-nhiều hoặc có thể phình to**
2. Mọi document có `createdAt`, `updatedAt` (Mongoose `timestamps: true`)
3. Xóa mềm (`deletedAt`) cho dữ liệu nghiệp vụ; xóa cứng cho dữ liệu kỹ thuật (session, token)
4. `_id` dùng `ObjectId` mặc định; thêm `slug` cho URL thân thiện ở Title
5. **Không bao giờ** để document vượt 16MB — mọi mảng embed phải có trần rõ ràng
6. Transaction **chỉ trong một database**. Cần nguyên tử xuyên service → saga ([14](14-inter-service-communication.md#5-saga--transaction-phân-tán))

---

## 1. `users`

```ts
{
  _id: ObjectId,
  email: string,                 // unique, lowercase
  emailVerifiedAt: Date | null,
  passwordHash: string | null,   // null nếu chỉ dùng OAuth
  displayName: string,
  role: 'user' | 'moderator' | 'admin',
  status: 'active' | 'suspended' | 'deleted',

  oauthAccounts: [{              // trần: 5 provider
    provider: 'google' | 'github',
    providerUserId: string,
    email: string,
    linkedAt: Date,
  }],

  twoFactor: {
    enabled: boolean,
    secret: string | null,       // mã hóa AES-256-GCM bằng APP_ENCRYPTION_KEY
    recoveryCodes: [{ hash: string, usedAt: Date | null }],  // trần 10
  },

  subscription: {                // denormalize từ `subscriptions` để đọc nhanh
    plan: 'free' | 'basic' | 'standard' | 'premium',
    status: 'active' | 'past_due' | 'canceled',
    maxStreams: number,
    maxQuality: '480p' | '720p' | '1080p',
    currentPeriodEnd: Date | null,
  },

  preferences: {
    language: 'vi' | 'en',
    autoplayNext: boolean,
    autoplayPreview: boolean,
  },

  lastLoginAt: Date | null,
  createdAt, updatedAt, deletedAt
}
```

**Index**

```js
{ email: 1 }                                        // unique
{ 'oauthAccounts.provider': 1, 'oauthAccounts.providerUserId': 1 }  // unique, sparse
{ role: 1, status: 1 }
```

> `subscription` được denormalize có chủ đích: mọi request playback đều cần nó, không muốn join. Nguồn sự thật vẫn là collection `subscriptions`; đồng bộ qua webhook thanh toán trong một transaction.

---

## 2. `profiles`

```ts
{
  _id: ObjectId,
  userId: ObjectId,              // ref users
  name: string,                  // tối đa 20 ký tự
  avatarKey: string,             // vd 'avatar-07'
  isKid: boolean,
  maturityLimit: 'G' | 'PG' | 'PG-13' | 'R' | 'NC-17',
  pinHash: string | null,        // argon2id, 4 số
  language: 'vi' | 'en',
  subtitlePrefs: {
    enabled: boolean,
    language: string,
    fontSize: 'small' | 'medium' | 'large',
    background: 'none' | 'semi' | 'solid',
  },
  // Vector sở thích, cập nhật dần bởi recommendation module
  tasteVector: { [genreId: string]: number },   // trần ~30 key
  createdAt, updatedAt, deletedAt
}
```

**Index**: `{ userId: 1, deletedAt: 1 }`

Ràng buộc "tối đa 5 profile" enforce ở service layer trong transaction, **không** tin vào index.

---

## 3. `sessions` (refresh token)

```ts
{
  _id: ObjectId,
  userId: ObjectId,
  familyId: string,              // uuid — tất cả token sinh ra từ 1 lần login dùng chung
  tokenHash: string,             // SHA-256 của refresh token, KHÔNG lưu plaintext
  previousTokenHash: string | null,
  status: 'active' | 'rotated' | 'revoked',
  userAgent: string,
  ip: string,
  deviceLabel: string,           // "Chrome trên Windows"
  expiresAt: Date,
  lastUsedAt: Date,
  createdAt, updatedAt
}
```

**Index**

```js
{ tokenHash: 1 }                              // unique
{ userId: 1, status: 1 }
{ familyId: 1 }
{ expiresAt: 1 }, { expireAfterSeconds: 0 }   // TTL tự xóa
```

Cơ chế reuse detection dựa trên `familyId` — chi tiết ở [05](05-authentication.md).

---

## 4. `verificationTokens`

Dùng chung cho email verification, reset password, đổi email.

```ts
{
  _id: ObjectId,
  userId: ObjectId,
  type: 'email_verify' | 'password_reset' | 'email_change',
  tokenHash: string,             // SHA-256
  payload: object | null,        // vd { newEmail } cho email_change
  consumedAt: Date | null,
  expiresAt: Date,
  createdAt
}
```

**Index**: `{ tokenHash: 1 }` unique · `{ expiresAt: 1 }` TTL

---

## 5. `titles`

Document trung tâm. Một title là Movie hoặc Series.

```ts
{
  _id: ObjectId,
  type: 'movie' | 'series',
  slug: string,                  // unique, vd 'big-buck-bunny-2008'
  title: string,
  originalTitle: string,
  // Phục vụ search tiếng Việt không dấu
  searchText: string,            // lowercase, bỏ dấu, gộp title + originalTitle + cast
  description: string,
  tagline: string,

  releaseDate: Date,
  endDate: Date | null,          // series đã kết thúc
  country: string[],             // ISO 3166-1 alpha-2
  spokenLanguages: string[],     // ISO 639-1
  maturityRating: 'G' | 'PG' | 'PG-13' | 'R' | 'NC-17',

  genreIds: ObjectId[],          // ref genres, trần 8
  keywords: string[],            // trần 30

  credits: {                     // embed: luôn đọc cùng title detail, trần 30 mỗi loại
    cast: [{ personId: ObjectId, name: string, character: string, order: number }],
    crew: [{ personId: ObjectId, name: string, job: 'director' | 'writer' | 'producer' }],
  },

  images: {
    posterUrl: string,
    backdropUrl: string,
    logoUrl: string | null,
  },

  trailer: { provider: 'youtube' | 'local', key: string } | null,

  // Chỉ có khi type === 'movie'
  movie: {
    assetId: ObjectId | null,    // ref assets
    runtimeSec: number,
    introStart: number | null,
    introEnd: number | null,
    creditsStart: number | null,
  } | null,

  // Chỉ có khi type === 'series' — season embed vì ít và luôn đọc cùng
  seasons: [{                    // trần 50
    seasonNumber: number,
    name: string,
    description: string,
    posterUrl: string | null,
    airDate: Date | null,
    episodeCount: number,        // denormalize
  }] | null,

  // Số liệu tổng hợp, cập nhật bằng cron / event
  stats: {
    viewCount: number,
    viewCount7d: number,
    avgRating: number,           // 0–10
    ratingCount: number,
    likeCount: number,
    popularity: number,          // điểm tổng hợp để sort
  },

  status: 'draft' | 'published' | 'archived',
  publishedAt: Date | null,
  externalIds: { tmdbId: number | null, imdbId: string | null },
  createdAt, updatedAt, deletedAt
}
```

**Index**

```js
{ slug: 1 }                                       // unique
{ status: 1, publishedAt: -1 }
{ status: 1, 'stats.popularity': -1 }
{ genreIds: 1, status: 1, 'stats.popularity': -1 }
{ type: 1, status: 1, releaseDate: -1 }
{ searchText: 'text', description: 'text' }       // weight: searchText 10, description 1
{ 'externalIds.tmdbId': 1 }                       // sparse
```

> **Tại sao embed `seasons` nhưng tách `episodes`?** Một series hiếm khi quá 50 season (an toàn về kích thước), và UI luôn cần list season ngay khi mở trang. Ngược lại một series có thể có hàng trăm episode, mỗi episode có metadata nặng (thumbnail, mô tả, asset) và chỉ được tải khi user chọn season — tách ra là đúng.

---

## 6. `episodes`

```ts
{
  _id: ObjectId,
  titleId: ObjectId,             // ref titles
  seasonNumber: number,
  episodeNumber: number,
  name: string,
  description: string,
  stillUrl: string | null,       // thumbnail
  airDate: Date | null,
  runtimeSec: number,
  assetId: ObjectId | null,
  introStart: number | null,
  introEnd: number | null,
  creditsStart: number | null,
  status: 'draft' | 'published',
  createdAt, updatedAt, deletedAt
}
```

**Index**: `{ titleId: 1, seasonNumber: 1, episodeNumber: 1 }` unique

---

## 7. `assets` — file video và các bản transcode

```ts
{
  _id: ObjectId,
  // Playable sở hữu asset này
  owner: { kind: 'movie' | 'episode', titleId: ObjectId, episodeId: ObjectId | null },

  source: {
    bucket: string,
    key: string,                 // 'uploads/2026/03/<uuid>.mp4'
    sizeBytes: number,
    mimeType: string,
    checksum: string,            // sha256
  },

  probe: {                       // kết quả ffprobe
    durationSec: number,
    width: number,
    height: number,
    videoCodec: string,
    audioCodec: string,
    bitrate: number,
    frameRate: number,
  } | null,

  status: 'uploading' | 'uploaded' | 'probing' | 'queued'
        | 'transcoding' | 'ready' | 'failed',
  progress: number,              // 0–100
  error: { code: string, message: string, at: Date } | null,

  hls: {
    masterKey: string,           // 'media/<assetId>/master.m3u8'
    encryptionKeyId: string,     // ref mediaKeys
    renditions: [{
      name: '360p' | '480p' | '720p' | '1080p',
      width: number, height: number,
      bitrateKbps: number,
      playlistKey: string,
      segmentCount: number,
      sizeBytes: number,
    }],
  } | null,

  subtitles: [{
    language: string,            // ISO 639-1
    label: string,               // 'Tiếng Việt'
    key: string,                 // WebVTT trên MinIO
    isDefault: boolean,
    isForced: boolean,
  }],

  audioTracks: [{ language: string, label: string, channels: number }],

  jobId: string | null,          // BullMQ job id
  transcodeStartedAt: Date | null,
  transcodeFinishedAt: Date | null,
  createdAt, updatedAt, deletedAt
}
```

**Index**

```js
{ 'owner.titleId': 1, 'owner.episodeId': 1 }
{ status: 1, createdAt: -1 }
{ jobId: 1 }    // sparse
```

---

## 8. `mediaKeys` — khóa AES-128 cho HLS

```ts
{
  _id: ObjectId,
  assetId: ObjectId,
  keyData: Buffer,               // 16 byte, mã hóa AES-256-GCM trước khi lưu
  iv: Buffer,
  rotatedAt: Date | null,
  createdAt
}
```

**Index**: `{ assetId: 1 }` unique

Không bao giờ expose collection này qua API. Endpoint `/media/key/:keyId` giải mã và trả raw 16 byte, **chỉ sau khi** verify playback token.

---

## 9. `progress` — tiến độ xem

Collection ghi nhiều nhất. Thiết kế để upsert nhanh.

```ts
{
  _id: ObjectId,
  profileId: ObjectId,
  titleId: ObjectId,
  episodeId: ObjectId | null,    // null nếu là movie
  positionSec: number,
  durationSec: number,
  percent: number,               // positionSec / durationSec * 100
  completed: boolean,            // percent >= 95
  lastDeviceId: string,
  watchedAt: Date,
  createdAt, updatedAt
}
```

**Index**

```js
{ profileId: 1, titleId: 1, episodeId: 1 }        // unique — key để upsert
{ profileId: 1, completed: 1, watchedAt: -1 }     // cho Continue Watching
{ titleId: 1, watchedAt: -1 }                     // cho analytics
```

> Ghi bằng `updateOne(filter, update, { upsert: true })`. Không đọc-rồi-ghi để tránh race giữa nhiều tab.

---

## 10. `watchHistory` — append-only, cho analytics

Tách khỏi `progress` vì mục đích khác nhau: `progress` là _trạng thái hiện tại_, `watchHistory` là _nhật ký sự kiện_.

```ts
{
  _id: ObjectId,
  profileId: ObjectId,
  titleId: ObjectId,
  episodeId: ObjectId | null,
  sessionId: string,             // một phiên xem liên tục
  startedAt: Date,
  endedAt: Date,
  watchedSec: number,            // thời gian thực sự xem, không tính tua
  maxPositionSec: number,
  quality: string,
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'tv',
  createdAt
}
```

**Index**: `{ profileId: 1, createdAt: -1 }` · `{ titleId: 1, createdAt: -1 }` · `{ createdAt: 1 }` TTL 180 ngày

---

## 11. `watchlist`

```ts
{
  _id: ObjectId,
  profileId: ObjectId,
  titleId: ObjectId,
  addedAt: Date,
}
```

**Index**: `{ profileId: 1, titleId: 1 }` unique · `{ profileId: 1, addedAt: -1 }`

---

## 12. `ratings`

```ts
{
  _id: ObjectId,
  profileId: ObjectId,
  titleId: ObjectId,
  value: 'like' | 'dislike' | 'love',
  createdAt, updatedAt
}
```

**Index**: `{ profileId: 1, titleId: 1 }` unique · `{ titleId: 1, value: 1 }`

---

## 13. `reviews` và `comments` (P2)

```ts
// reviews
{ _id, profileId, titleId, score: number /*1-10*/, text: string,
  spoiler: boolean, status: 'visible'|'hidden'|'reported',
  likeCount: number, createdAt, updatedAt }

// comments — lồng tối đa 1 cấp
{ _id, reviewId, parentId: ObjectId|null, profileId, text: string,
  status, createdAt, updatedAt }
```

**Index**: `{ titleId: 1, createdAt: -1 }` · `{ profileId: 1, titleId: 1 }` unique

---

## 14. `genres` và `people`

```ts
// genres
{ _id, slug: string, name: { vi: string, en: string }, order: number }

// people — diễn viên, đạo diễn
{ _id, name, slug, profileUrl: string|null, biography: string,
  birthday: Date|null, externalIds: { tmdbId }, createdAt, updatedAt }
```

---

## 15. `watchParties`

Trạng thái "nóng" nằm ở Redis; Mongo lưu bản ghi để lịch sử và khôi phục sau restart.

```ts
{
  _id: ObjectId,
  code: string,                  // 8 ký tự, dùng trong link mời
  hostProfileId: ObjectId,
  titleId: ObjectId,
  episodeId: ObjectId | null,
  status: 'waiting' | 'playing' | 'ended',
  members: [{                    // trần 10
    profileId: ObjectId,
    displayName: string,
    avatarKey: string,
    joinedAt: Date,
    leftAt: Date | null,
  }],
  playback: { positionSec: number, isPlaying: boolean, updatedAt: Date },
  maxMembers: number,
  endedAt: Date | null,
  createdAt, updatedAt
}
```

**Index**: `{ code: 1 }` unique · `{ status: 1, updatedAt: -1 }` · `{ createdAt: 1 }` TTL 7 ngày

---

## 16. `notifications`

```ts
{
  _id: ObjectId,
  profileId: ObjectId,
  type: 'new_episode' | 'party_invite' | 'security_alert' | 'system',
  title: string,
  body: string,
  data: object,                  // deep link payload
  readAt: Date | null,
  createdAt
}
```

**Index**: `{ profileId: 1, readAt: 1, createdAt: -1 }` · `{ createdAt: 1 }` TTL 90 ngày

---

## 17. `subscriptions`, `payments`, `paymentEvents`

Field đặt tên **trung lập với provider** (`providerCustomerId` chứ không phải `stripeCustomerId`). Hiện tại provider duy nhất là `mock` ([ADR-009](adr/009-mock-payment-provider.md)); nếu sau này gắn gateway thật thì chỉ thêm giá trị enum, không phải migrate schema.

```ts
// subscriptions — nguồn sự thật cho billing
{
  _id: ObjectId,
  userId: ObjectId,
  plan: 'free' | 'basic' | 'standard' | 'premium',
  status: 'active' | 'past_due' | 'canceled' | 'incomplete',
  provider: 'mock',                      // chừa chỗ: 'stripe' | 'vnpay' | ...
  providerCustomerId: string,
  providerSubscriptionId: string,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  cancelAtPeriodEnd: boolean,
  canceledAt: Date | null,
  failedPaymentCount: number,            // 3 lần liên tiếp → canceled
  createdAt, updatedAt
}

// payments — lịch sử hóa đơn
{
  _id: ObjectId,
  userId: ObjectId,
  subscriptionId: ObjectId,
  provider: 'mock',
  providerInvoiceId: string,
  amount: number,                        // đồng, số nguyên — KHÔNG dùng float cho tiền
  currency: 'VND',
  status: 'paid' | 'failed' | 'refunded',
  failureCode: string | null,            // 'card_declined' | 'insufficient_funds' | ...
  paidAt: Date | null,
  createdAt
}

// paymentEvents — bảo đảm idempotent cho webhook
{
  _id: ObjectId,
  provider: 'mock',
  providerEventId: string,               // unique cùng provider
  type: string,                          // 'checkout.completed' | 'invoice.paid' | ...
  eventCreatedAt: Date,                  // timestamp của provider — dùng để phát hiện out-of-order
  receivedAt: Date,
  processedAt: Date | null,
  attempts: number,
  payload: object
}

// checkoutSessions — phiên checkout của mock provider
{
  _id: ObjectId,
  sessionId: string,                     // unique, dùng trong URL
  userId: ObjectId,
  plan: string,
  amount: number,
  status: 'open' | 'completed' | 'expired' | 'canceled',
  resultChoice: string | null,           // nút user bấm ở trang mock
  expiresAt: Date,
  createdAt, updatedAt
}
```

**Index**

```js
// subscriptions
{ userId: 1 }                                        // unique
{ status: 1, currentPeriodEnd: 1 }                   // cho cron gia hạn

// payments
{ userId: 1, createdAt: -1 }
{ providerInvoiceId: 1 }                             // unique

// paymentEvents
{ provider: 1, providerEventId: 1 }                  // unique — KHÓA CHỐNG TRÙNG
{ processedAt: 1 }                                   // tìm event chưa xử lý xong

// checkoutSessions
{ sessionId: 1 }                                     // unique
{ expiresAt: 1 }, { expireAfterSeconds: 0 }          // TTL
```

> `{ provider, providerEventId }` unique là **cơ chế idempotency chính**. Insert trước, xử lý sau: nếu insert ném `E11000 duplicate key` thì event đã nhận rồi → trả 200 ngay, không xử lý lại. Đừng kiểm tra bằng `findOne` rồi mới `insert` — hai webhook song song sẽ lọt cả hai qua khe hở giữa hai lệnh.

---

## 18. `auditLogs`

```ts
{ _id, actorUserId: ObjectId|null, action: string, // 'title.publish', 'user.suspend'
  targetType: string, targetId: ObjectId|null,
  ip: string, userAgent: string, metadata: object, createdAt }
```

**Index**: `{ actorUserId: 1, createdAt: -1 }` · `{ createdAt: 1 }` TTL 365 ngày

---

## Sơ đồ quan hệ

```
users ──1:N──> profiles ──1:N──> progress ──N:1──> titles
  │                │                                  │
  │                ├──1:N──> watchlist ───────────────┤
  │                ├──1:N──> ratings ─────────────────┤
  │                ├──1:N──> reviews ─────────────────┤
  │                ├──1:N──> notifications            │
  │                └──N:M──> watchParties ────────────┤
  │                                                   │
  ├──1:N──> sessions                           titles ├──1:N──> episodes
  ├──1:N──> verificationTokens                        │             │
  └──1:1──> subscriptions ──1:N──> payments           │             │
                                             assets <─┴─────────────┘
                                                │
                                                └──1:1──> mediaKeys

titles ──N:M──> genres
titles ──N:M──> people  (qua credits embed)
```

## 19. Collection hạ tầng (mọi database)

Ba collection này lặp lại ở mỗi service — do `packages/service-kit` cung cấp, không tự viết lại.

### `outbox` — Transactional Outbox

```ts
{
  _id: ObjectId,
  id: string,              // UUID, unique
  type: string,            // 'billing.subscription.activated'
  version: number,
  occurredAt: Date,
  traceId: string,
  correlationId: string,
  causationId: string | null,
  data: object,
  status: 'pending' | 'publishing' | 'published' | 'failed',
  attempts: number,
  lastError: string | null,
  publishedAt: Date | null,
  createdAt: Date,
}
```

**Index**

```js
{ status: 1, createdAt: 1 }                             // relay quét theo đây
{ id: 1 }                                                // unique
{ publishedAt: 1 }, { expireAfterSeconds: 604800 }       // TTL 7 ngày
```

Lý do tồn tại: ghi DB và phát event phải nguyên tử. Chi tiết: [14 — Transactional Outbox](14-inter-service-communication.md#3-transactional-outbox).

### `processedEvents` — idempotency ở consumer

```ts
{ _id: ObjectId, eventId: string, consumer: string, processedAt: Date }
```

**Index**

```js
{ eventId: 1, consumer: 1 }                              // unique — KHÓA CHỐNG TRÙNG
{ processedAt: 1 }, { expireAfterSeconds: 2592000 }      // TTL 30 ngày
```

JetStream giao at-least-once → mọi event **sẽ** có lúc đến hai lần.

### `sagas` — chỉ ở service điều phối saga

```ts
{
  _id: ObjectId,
  type: 'delete-account' | 'upgrade-subscription',
  status: 'running' | 'compensating' | 'completed' | 'failed',
  currentStep: number,
  payload: object,
  completedSteps: [{ step: number, at: Date, result: object }],
  lastError: string | null,
  createdAt, updatedAt
}
```

**Index**: `{ status: 1, updatedAt: 1 }` — lúc khởi động quét `running` để tiếp tục saga dở dang.

---

## Transaction — nơi bắt buộc dùng

MongoDB transaction chỉ hoạt động trên replica set, và **chỉ trong phạm vi một database**.

| #   | Chỗ                                                                      | Service  |
| --- | ------------------------------------------------------------------------ | -------- |
| 1   | Refresh token rotation — đánh dấu cũ `rotated` + tạo mới                 | identity |
| 2   | Reuse detection — revoke cả family                                       | identity |
| 3   | Tạo profile — đếm + chèn (chống race quá 5 profile)                      | identity |
| 4   | Webhook thanh toán — `paymentEvents` + `subscriptions` + `payments`      | billing  |
| 5   | Publish title — title + episode                                          | catalog  |
| 6   | **Mọi thao tác phát event** — dữ liệu nghiệp vụ + `outbox`               | tất cả   |
| 7   | **Mọi consumer dùng idempotency cách 1** — `processedEvents` + công việc | tất cả   |

Mục 6 và 7 là mới so với kiến trúc monolith, và áp dụng cho **mọi** service. Quên một trong hai là tạo ra lỗi âm thầm: event mất, hoặc event xử lý hai lần.

### Những chỗ KHÔNG dùng transaction được nữa

| Thao tác                              | Trước (monolith) | Giờ                           |
| ------------------------------------- | ---------------- | ----------------------------- |
| Đăng ký + tạo subscription free       | 1 transaction    | Choreography saga             |
| Xóa tài khoản                         | 1 transaction    | Orchestration saga, 7 bước    |
| Nâng gói + mở khóa 1080p              | 1 transaction    | Saga + eventual consistency   |
| Xóa title + dọn asset + dọn watchlist | 1 transaction    | Event `catalog.title.deleted` |

Chi tiết: [14 — Saga](14-inter-service-communication.md#5-saga--transaction-phân-tán).

## Migration

Dùng `migrate-mongo`. Mọi thay đổi schema phải có file migration trong `apps/api/migrations/`, đặt tên `YYYYMMDDHHmmss-mo-ta.ts`, có cả `up` và `down`.

---

**Tiếp theo**: [04 — API Specification](04-api-specification.md)
