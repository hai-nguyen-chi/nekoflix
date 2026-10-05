# 02 — System Architecture

Kiến trúc **microservices, event-driven**. Lý do và các phương án đã loại: [ADR-010](adr/010-microservices.md).

Tài liệu này là bản đồ tổng thể. Chi tiết từng service ở [13 — Service Catalog](13-service-catalog.md); chi tiết giao tiếp ở [14 — Inter-service Communication](14-inter-service-communication.md).

---

## 1. Toàn cảnh

```
                            ┌──────────────────────────────┐
                            │  Browser (React 19 SPA)      │
                            │  hls.js player               │
                            └───┬──────────┬──────────┬────┘
                      HTTPS     │    WSS   │   HTTPS  │ (HLS segment)
                                ▼          ▼          │
                     ┌──────────────────────────┐     │
                     │      api-gateway          │     │
                     │  routing · authN · rate   │     │
                     │  limit · composition      │     │
                     └──┬───┬───┬───┬───┬───┬────┘     │
                        │   │   │   │   │   │          │
     ┌──────────────────┘   │   │   │   │   └──────────┼──────────┐
     │          ┌───────────┘   │   │   └──────┐       │          │
     ▼          ▼               ▼   ▼          ▼       │          ▼
┌─────────┐ ┌─────────┐ ┌──────────┐ ┌────────────┐   │   ┌─────────────┐
│identity │ │ catalog │ │  media   │ │  activity  │   │   │  realtime   │
│ service │ │ service │ │ service  │ │  service   │   │   │  service    │
└────┬────┘ └────┬────┘ └────┬─────┘ └─────┬──────┘   │   └──────┬──────┘
     │           │           │             │           │          │
┌────┴────┐ ┌────┴────┐ ┌────┴─────┐ ┌─────┴──────┐   │   ┌──────┴──────┐
│ billing │ │  reco   │ │transcode │ │notification│   │   │   (Redis    │
│ service │ │ service │ │  worker  │ │  service   │   │   │  presence/  │
└────┬────┘ └────┬────┘ └────┬─────┘ └─────┬──────┘   │   │   party)    │
     │           │           │             │           │   └─────────────┘
     └───────────┴─────┬─────┴─────────────┘           │
                       │                                │
              ┌────────▼──────────┐                     │
              │  NATS JetStream   │  event bus          │
              └───────────────────┘                     │
                                                        │
     ┌──────────────┬──────────────┬────────────┐      │
     ▼              ▼              ▼            ▼      ▼
┌─────────┐  ┌───────────┐  ┌──────────┐  ┌──────────────┐
│MongoDB  │  │  Redis 7  │  │  MinIO   │  │   Jaeger     │
│replica  │  │cache/queue│  │ (S3) ────┼──┼─> HLS segment│
│8 DB độc │  │ /presence │  │          │  │  (signed URL)│
│  lập    │  └───────────┘  └──────────┘  └──────────────┘
└─────────┘
```

Client **chỉ** biết `api-gateway`. Không service nội bộ nào lộ ra Internet.

---

## 2. Các thành phần

### 2.1 `api-gateway` — biên hệ thống

Chịu trách nhiệm:

- Định tuyến HTTP/WS tới service phía sau qua NATS request/reply
- **Xác thực** access token một lần ở biên — service bên trong tin claim đã verify
- Rate limiting, CORS, Helmet, request ID
- **API composition** — ghép dữ liệu từ nhiều service thành một response cho client
- Fallback khi service phía sau chết

**Không** chịu trách nhiệm: business logic, truy cập database. Gateway không có database.

> Gateway là nơi duy nhất biết "trang chủ gồm những gì". Mỗi service chỉ biết phần của mình.

### 2.2 Các service nghiệp vụ

| Service                  | Sở hữu                                      | Profile tài nguyên                    |
| ------------------------ | ------------------------------------------- | ------------------------------------- |
| `identity-service`       | users, profiles, sessions, OAuth, 2FA       | CPU spike khi argon2 hash             |
| `catalog-service`        | titles, episodes, genres, people, search    | Đọc nhiều, cache tốt                  |
| `media-service`          | assets, mediaKeys, playback token, manifest | I/O nhiều, phục vụ manifest           |
| `activity-service`       | progress, history, watchlist, ratings       | **Ghi nhiều nhất** (progress mỗi 10s) |
| `realtime-service`       | watch party, presence                       | **Stateful**, kết nối dài             |
| `billing-service`        | subscriptions, payments, mock provider      | Ít tải, nhạy cảm                      |
| `notification-service`   | notifications, email outbox                 | Thuần consumer event                  |
| `recommendation-service` | titleSimilarity, tasteVector                | Batch nặng ban đêm                    |

Cột cuối là lý do vật lý để tách — không phải tách cho đủ số ([ADR-010](adr/010-microservices.md#những-chỗ-cố-ý-không-tách)).

### 2.3 `transcode-worker`

Không phải service — là **worker** trong bounded context của media. Không có API, không sở hữu database riêng. Tách process vì FFmpeg ăn 100% CPU hàng chục phút; chung process với `media-service` sẽ chặn event loop.

Nhận job qua BullMQ (Redis), không qua NATS — xem [ADR-011](adr/011-nats-message-broker.md#vì-sao-vẫn-giữ-bullmq-cho-transcode).

### 2.4 Hạ tầng dùng chung

| Thành phần         | Vai trò                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| **NATS JetStream** | Event bus + request/reply giữa service                                                                  |
| **MongoDB**        | 1 replica set, 8 database độc lập, mỗi service một DB user ([ADR-012](adr/012-database-per-service.md)) |
| **Redis**          | Cache, BullMQ, presence, rate limit, stream counter                                                     |
| **MinIO**          | Video, HLS output, ảnh                                                                                  |
| **Jaeger**         | Distributed tracing — **bắt buộc**, không phải tùy chọn                                                 |

---

## 3. Giao tiếp

### 3.1 Ba kiểu, dùng đúng chỗ

| Kiểu                   | Khi nào                                             | Công cụ                |
| ---------------------- | --------------------------------------------------- | ---------------------- |
| **Sync request/reply** | Cần câu trả lời ngay để phục vụ request của user    | NATS request/reply     |
| **Async event**        | Thông báo "chuyện này đã xảy ra", không cần trả lời | NATS JetStream pub/sub |
| **Internal queue**     | Job dài, có trạng thái, trong cùng một service      | BullMQ                 |

**Quy tắc mặc định: dùng event.** Mỗi lời gọi sync tạo một liên kết cứng — service kia chết thì mình chết theo, service kia chậm thì mình chậm theo. Chỉ dùng sync khi user đang đứng chờ câu trả lời.

### 3.2 Giới hạn độ sâu

```
Client → Gateway → Service          ✅ bình thường
Client → Gateway → Service → Service ⚠️  chấp nhận, nhưng phải có lý do
Client → Gateway → Service → Service → Service   ❌ cấm
```

Chuỗi sync 3 hop nhân độ trễ và nhân xác suất lỗi. Nếu thấy cần, đó là dấu hiệu ranh giới service sai, hoặc nên thay bằng event + read model.

### 3.3 Ví dụ: trang chủ

Trước (monolith): một aggregation pipeline.
Giờ: gateway ghép từ 3 service, **song song**.

```ts
// api-gateway/src/composition/home.composer.ts
async function composeHome(ctx: UserContext): Promise<HomeResponse> {
  const [rows, progress, watchlist] = await Promise.all([
    catalog.request('catalog.rows.get', { profileId: ctx.profileId, limit: 6 }),
    activity.request('activity.progress.continue', { profileId: ctx.profileId }).catch(() => []), // mất row "Xem tiếp", không sập trang
    activity.request('activity.watchlist.ids', { profileId: ctx.profileId }).catch(() => []),
  ]);

  const titleIds = progress.map((p) => p.titleId);
  const titles = titleIds.length
    ? await catalog.request('catalog.titles.byIds', { ids: titleIds })
    : [];

  return buildHome({ rows, progress, titles, watchlistIds: new Set(watchlist) });
}
```

Hai điểm bắt buộc:

- **`Promise.all`**, không gọi tuần tự. Gọi tuần tự biến 3 service thành 3 lần độ trễ cộng dồn
- **`.catch()` cho phần không thiết yếu**. `activity-service` chết thì mất row "Xem tiếp", không được làm trắng cả trang chủ

---

## 4. Luồng dữ liệu chính

### 4.1 Đăng nhập

```
Browser          Gateway        identity-svc      MongoDB        NATS
   │                │                │               │             │
   ├─POST /auth/login──────────────> │               │             │
   │                ├─NATS req ─────>│               │             │
   │                │                ├─find user────>│             │
   │                │                ├─argon2.verify │             │
   │                │                ├─tạo session──>│             │
   │                │                ├─outbox insert─┤ (cùng txn)  │
   │                │<─{tokens}──────┤               │             │
   │<─200 + Set-Cookie──────────────┤               │             │
   │                                 │                             │
   │                 [outbox relay] ─┼─identity.user.logged_in────>│
   │                                 │                             │
   │                 notification-svc <───────────────────────────┤
   │                 (email "đăng nhập thiết bị mới")              │
```

Điểm then chốt: session được ghi **và** event được ghi vào `outbox` trong **cùng một transaction**. Một tiến trình riêng đọc outbox và publish lên NATS. Chi tiết: [14 — Transactional Outbox](14-inter-service-communication.md#3-transactional-outbox).

### 4.2 Phát video

```
Browser        Gateway       media-svc      identity-svc    activity-svc    Redis
   │              │              │               │               │            │
   ├─POST /media/:id/playback──> │               │               │            │
   │              ├─NATS req ───>│               │               │            │
   │              │              ├─req: lấy subscription ───────>│            │
   │              │              │<─{plan, maxQuality, maxStreams}            │
   │              │              ├─req: vị trí đang xem ────────────────────>│
   │              │              │<─{positionSec: 420}                        │
   │              │              ├─check stream limit ──────────────────────>│
   │              │              ├─ký playback token                          │
   │              │<─{manifestUrl, token, startPositionSec}                   │
   │<─200 ────────┤              │               │               │            │
   │                                                                          │
   ├─GET master.m3u8?token= ──> Gateway ─> media-svc (sinh playlist động)     │
   ├─GET seg_0001.m4s ────────> Gateway ─> media-svc ─> 302 presigned MinIO   │
   │
   ├─(mỗi 10s) POST /playback/progress ─> Gateway ─> activity-svc ─> Mongo
```

Đây là chỗ sync 2 hop có lý do: user đang đứng chờ, và cả ba mẩu dữ liệu đều bắt buộc để quyết định cho phép phát hay không.

Tối ưu: `media-service` cache `subscription` theo `userId` trong Redis 60 giây, nghe `billing.subscription.changed` để xóa cache. Giảm một hop ở phần lớn request.

### 4.3 Upload & transcode

```
Admin        Gateway     media-svc    MinIO    BullMQ    worker    NATS    realtime
  │             │            │          │        │         │        │         │
  ├─upload-url─>├──────────> ├─presign─>│        │         │        │         │
  │<─{url, assetId}──────────┤          │        │         │        │         │
  ├─PUT file ─────────────────────────> │        │         │        │         │
  ├─complete ──>├──────────> ├─ffprobe  │        │         │        │         │
  │             │            ├─enqueue ──────────>         │        │         │
  │             │            │          │        ├─job────>│        │         │
  │             │            │          │        │         ├─FFmpeg │         │
  │             │            │          │        │         ├─progress────────>│
  │             │            │          │        │         │        ├────────>│
  │<────────────┼────────────┼──────────┼────────┼─────WS: transcode.progress─┤
  │             │            │          │        │         ├─upload HLS─>MinIO│
  │             │            │<─job done ────────┤         │        │         │
  │             │            ├─asset.status=ready          │        │         │
  │             │            ├─outbox: media.asset.ready──────────>│         │
  │             │            │                                      │         │
  │        catalog-svc <─────┴──(nghe asset.ready → đánh dấu title phát được)│
  │        notification-svc <────(nghe asset.ready → báo user có tập mới)     │
```

Một event, nhiều consumer độc lập. `media-service` không cần biết ai đang nghe — thêm consumer mới không phải sửa nó.

---

## 5. Xác thực xuyên service

Verify token **một lần ở gateway**, không lặp lại ở từng service.

```
Gateway:
  1. Verify JWT RS256 (chữ ký, exp, iss, aud)
  2. Trích claim → gắn vào NATS message header
  3. Forward xuống service

Service nội bộ:
  4. Đọc claim từ header, TIN nó (gateway là ranh giới tin cậy)
  5. Tự kiểm tra authorization nghiệp vụ của riêng mình
```

```ts
// Header gắn vào mọi NATS request từ gateway
{
  'x-user-id':    '665f1a...',
  'x-profile-id': '665f1c...',
  'x-role':       'user',
  'x-plan':       'standard',
  'x-request-id': '01HQ8X...',
  'x-trace-id':   '4bf92f3577b34da6...',
}
```

**Điều kiện để mô hình này an toàn**: service nội bộ **không được** truy cập từ ngoài. NATS nằm trong mạng Docker nội bộ, không publish port ra ngoài. Nếu điều đó bị phá vỡ, bất kỳ ai cũng giả được header và chiếm quyền.

Service **vẫn phải** tự check authorization nghiệp vụ: `activity-service` phải xác minh `profileId` trong header thuộc về `userId` trong header — gateway xác thực _danh tính_, service quyết định _quyền_.

---

## 6. Chiến lược dữ liệu

### 6.1 Sở hữu

Mỗi collection có **đúng một** service ghi. Chi tiết: [03 — Database Schema](03-database-schema.md), quy tắc: [ADR-012](adr/012-database-per-service.md).

### 6.2 Khi cần dữ liệu của service khác

| Cách                          | Khi nào                                                   | Ví dụ                                                      |
| ----------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| **API composition ở gateway** | Mặc định                                                  | Trang chủ ghép catalog + activity                          |
| **Sync request**              | Service cần để ra quyết định                              | media hỏi identity về subscription                         |
| **Read model qua event**      | Composition quá chậm, hoặc cần query/sort theo dữ liệu đó | activity giữ `titleProjections` để sort watchlist theo tên |
| **Denormalize lúc ghi**       | Dữ liệu bất biến theo thời điểm                           | `payments.amount` giữ giá lúc thanh toán                   |

Read model phải tuân thủ: chỉ chép field cần hiển thị, **không bao giờ** là nguồn sự thật, xóa đi dựng lại được từ event.

### 6.3 Cache

| Dữ liệu                | Ở đâu               | TTL     | Invalidation                        |
| ---------------------- | ------------------- | ------- | ----------------------------------- |
| Title detail           | Redis (catalog-svc) | 30 phút | Nghe `catalog.title.updated`        |
| Home rows              | Redis (catalog-svc) | 10 phút | TTL                                 |
| Subscription           | Redis (media-svc)   | 60 giây | Nghe `billing.subscription.changed` |
| Profile → user mapping | Redis (gateway)     | 5 phút  | Nghe `identity.profile.deleted`     |
| Continue watching      | Không cache         | —       | Đổi liên tục                        |
| HLS segment            | CDN + browser       | 1 năm   | Immutable                           |

Namespace Redis theo service: `cache:catalog:*`, `cache:media:*` — tránh hai service vô tình dùng chung key.

---

## 7. Xử lý lỗi & khả năng chịu lỗi

### 7.1 Phân loại dependency

Với mỗi lời gọi, phải trả lời trước: **service kia chết thì chuyện gì xảy ra?**

| Dependency                             | Thiết yếu? | Khi chết                               |
| -------------------------------------- | ---------- | -------------------------------------- |
| Gateway → identity (login)             | ✅         | Trả 503, không login được              |
| Gateway → catalog (browse)             | ✅         | Trả 503                                |
| Gateway → activity (continue watching) | ❌         | Bỏ row đó, trang vẫn hiện              |
| Gateway → reco (gợi ý)                 | ❌         | Fallback về Trending                   |
| media → identity (subscription)        | ✅         | Dùng cache; hết cache thì từ chối phát |
| Mọi thứ → notification                 | ❌         | Event nằm trong JetStream, xử lý sau   |

Phân loại này không phải chi tiết phụ — nó quyết định UI trông ra sao khi hệ thống hỏng một phần.

### 7.2 Circuit breaker

```ts
// Mọi lời gọi sync liên service đều bọc qua đây
const breaker = new CircuitBreaker(call, {
  timeout: 3_000,
  errorThresholdPercentage: 50,
  resetTimeout: 10_000, // 10s sau thử lại một request
  rollingCountTimeout: 10_000,
});

breaker.fallback(() => cached ?? DEGRADED_RESPONSE);
```

Không có circuit breaker: `catalog-service` chậm → request ở gateway dồn lại → gateway hết connection pool → **cả hệ thống chết vì một service chậm**. Đây là kiểu sập lan truyền kinh điển của microservices.

### 7.3 Timeout

| Hop                         | Timeout |
| --------------------------- | ------- |
| Client → Gateway            | 30s     |
| Gateway → Service (sync)    | 3s      |
| Service → Service (sync)    | 2s      |
| NATS request/reply mặc định | 2s      |

Timeout phải **giảm dần** khi đi sâu vào trong. Nếu hop trong lâu hơn hop ngoài, hop ngoài bỏ cuộc trước nhưng hop trong vẫn đang chạy — tốn tài nguyên cho một kết quả không ai nhận.

### 7.4 Retry

- **Chỉ retry thao tác idempotent** (đọc, hoặc ghi có idempotency key)
- Exponential backoff + jitter, tối đa 2 lần cho sync
- **Không** retry lỗi 4xx — request sai thì gửi lại vẫn sai
- Event consumer: JetStream tự gửi lại tới `max_deliver: 5`, rồi vào DLQ

---

## 8. Observability — bắt buộc, không phải tùy chọn

Với monolith, thiếu tracing chỉ gây bất tiện. Với 9 service, một request lỗi đi qua 4 hop — **không có trace thì gần như không lần ra được**. Đây là lý do OpenTelemetry chuyển từ P2 lên P0 so với bản tài liệu trước.

### 8.1 Tracing

```ts
// Mọi service khởi tạo giống nhau
const sdk = new NodeSDK({
  resource: new Resource({ [SEMRESATTRS_SERVICE_NAME]: 'catalog-service' }),
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_ENDPOINT }),
  instrumentations: [getNodeAutoInstrumentations()],
});
```

`traceId` phải truyền qua: HTTP header → NATS header → BullMQ job data → log. Đứt một mắt xích là mất khả năng lần vết.

### 8.2 Log

JSON có cấu trúc (pino), mọi dòng kèm `service`, `traceId`, `requestId`. Gom về một chỗ bằng Loki hoặc đơn giản là `docker compose logs`.

### 8.3 Metric

Mỗi service expose `/metrics`:

- `http_request_duration_seconds{service,route,status}`
- `nats_request_duration_seconds{service,subject}`
- `event_processing_duration_seconds{service,subject}`
- `event_processing_failures_total{service,subject}`
- **`outbox_pending_count{service}`** — quan trọng nhất. Tăng dần nghĩa là outbox relay chết, event không được phát, hệ thống đang lệch dần mà không báo lỗi gì
- `circuit_breaker_state{service,target}`

### 8.4 Health check

```
/health/live    — process còn sống
/health/ready   — kết nối được Mongo + NATS (+ Redis nếu dùng)
```

`ready` **không** kiểm tra service khác. Nếu `catalog` báo not-ready vì `identity` chết, hai service kéo nhau xuống và orchestrator restart vòng tròn.

---

## 9. Hướng scale

| Thành phần         | Cách scale                                  | Ghi chú                                    |
| ------------------ | ------------------------------------------- | ------------------------------------------ |
| Service stateless  | Thêm instance, NATS queue group tự chia tải | Không cần cấu hình gì                      |
| `transcode-worker` | Thêm instance                               | BullMQ tự phân phối                        |
| `realtime-service` | Thêm instance + Redis adapter cho Socket.IO | Stateful, cần cẩn thận                     |
| MongoDB            | Tách instance riêng cho service ghi nhiều   | [ADR-012](adr/012-database-per-service.md) |
| NATS               | Cluster 3 node                              | Chỉ cần khi broker thành nút thắt          |

Không làm bây giờ. Ghi ra để biết đường không bị chặn.

---

**Tiếp theo**: [13 — Service Catalog](13-service-catalog.md) · [14 — Inter-service Communication](14-inter-service-communication.md)
