# 13 — Service Catalog

Mỗi service được mô tả theo một khuôn cố định: **trách nhiệm · dữ liệu sở hữu · API · event phát ra · event tiêu thụ · phụ thuộc đồng bộ**.

Hai mục cuối quan trọng nhất. Nếu một service có quá nhiều phụ thuộc đồng bộ, ranh giới của nó đang sai.

| Service                                              | Port | DB                      | Phase |
| ---------------------------------------------------- | ---- | ----------------------- | ----- |
| [api-gateway](#1-api-gateway)                        | 4000 | —                       | 1     |
| [identity-service](#2-identity-service)              | 4001 | `nekoflix_identity`     | 1     |
| [catalog-service](#3-catalog-service)                | 4002 | `nekoflix_catalog`      | 2     |
| [media-service](#4-media-service)                    | 4003 | `nekoflix_media`        | 3     |
| [transcode-worker](#5-transcode-worker)              | —    | (dùng của media)        | 3     |
| [activity-service](#6-activity-service)              | 4004 | `nekoflix_activity`     | 3     |
| [realtime-service](#7-realtime-service)              | 4005 | `nekoflix_realtime`     | 4     |
| [billing-service](#8-billing-service)                | 4006 | `nekoflix_billing`      | 5     |
| [notification-service](#9-notification-service)      | 4007 | `nekoflix_notification` | 5     |
| [recommendation-service](#10-recommendation-service) | 4008 | `nekoflix_reco`         | 5     |

Port chỉ dùng cho `/health` và `/metrics`. Giao tiếp nghiệp vụ đi qua NATS, không qua HTTP.

---

## 1. api-gateway

### Trách nhiệm

- Điểm vào duy nhất cho client (HTTP + WebSocket upgrade)
- Verify access token, trích claim, gắn vào NATS header
- Rate limiting, CORS, Helmet, request ID, correlation ID
- **API composition** — ghép response từ nhiều service
- Circuit breaker + fallback cho mọi lời gọi xuống dưới
- Phục vụ OpenAPI gộp tại `/docs`

### Không chịu trách nhiệm

Business logic, truy cập database. Gateway **không có database**.

> Ranh giới này dễ bị phá nhất. Mỗi khi định viết `if` nghiệp vụ trong gateway, hãy hỏi: logic này thuộc về service nào? Gateway chỉ được biết "trang chủ gồm những row nào", không được biết "row trending tính thế nào".

### Composition chính

| Endpoint                    | Gọi tới                 | Thiết yếu                |
| --------------------------- | ----------------------- | ------------------------ |
| `GET /catalog/home`         | catalog, activity, reco | catalog ✅ · còn lại ❌  |
| `GET /catalog/titles/:slug` | catalog, activity       | catalog ✅ · activity ❌ |
| `POST /media/:id/playback`  | media                   | ✅                       |
| `GET /auth/me`              | identity, billing       | identity ✅ · billing ❌ |

### Phụ thuộc đồng bộ

Tất cả service — đó là bản chất của gateway.

---

## 2. identity-service

### Trách nhiệm

Danh tính và quyền: đăng ký, đăng nhập, refresh token rotation, OAuth2, 2FA, quản lý session, multi-profile, PIN, kids mode.

### Dữ liệu sở hữu — `nekoflix_identity`

`users` · `profiles` · `sessions` · `verificationTokens` · `outbox`

### API (NATS subject)

| Subject                            | Kiểu    | Mô tả                                        |
| ---------------------------------- | ------- | -------------------------------------------- |
| `identity.auth.register`           | req/rep |                                              |
| `identity.auth.login`              | req/rep |                                              |
| `identity.auth.refresh`            | req/rep | Rotation + reuse detection                   |
| `identity.auth.logout`             | req/rep |                                              |
| `identity.auth.verifyEmail`        | req/rep |                                              |
| `identity.oauth.callback`          | req/rep |                                              |
| `identity.2fa.*`                   | req/rep | setup, enable, verify, disable               |
| `identity.user.get`                | req/rep |                                              |
| `identity.user.subscription`       | req/rep | **Được gọi nhiều nhất** — media hỏi liên tục |
| `identity.profile.list`            | req/rep |                                              |
| `identity.profile.create`          | req/rep |                                              |
| `identity.profile.verifyOwnership` | req/rep | profileId có thuộc userId không              |

### Event phát ra

| Subject                    | Khi nào                       | Payload chính              |
| -------------------------- | ----------------------------- | -------------------------- |
| `identity.user.registered` | Đăng ký xong                  | userId, email, displayName |
| `identity.user.verified`   | Verify email                  | userId                     |
| `identity.user.logged_in`  | Đăng nhập thiết bị mới        | userId, deviceLabel, ip    |
| `identity.user.deleted`    | Xóa tài khoản                 | userId, profileIds[]       |
| `identity.user.suspended`  | Admin khóa                    | userId, reason             |
| `identity.profile.created` |                               | profileId, userId, isKid   |
| `identity.profile.deleted` |                               | profileId, userId          |
| `identity.security.alert`  | Reuse detection, đổi password | userId, type               |

### Event tiêu thụ

| Subject                          | Làm gì                                      |
| -------------------------------- | ------------------------------------------- |
| `billing.subscription.activated` | Cập nhật `users.subscription` (denormalize) |
| `billing.subscription.changed`   | Nt                                          |
| `billing.subscription.canceled`  | Hạ về gói free                              |

### Phụ thuộc đồng bộ

**Không có.** Đây là service độc lập nhất, và nên giữ như vậy — mọi thứ khác phụ thuộc nó.

---

## 3. catalog-service

### Trách nhiệm

Nội dung: CRUD title/episode/genre/person, search, các row trang chủ, import TMDB.

### Dữ liệu sở hữu — `nekoflix_catalog`

`titles` · `episodes` · `genres` · `people` · `outbox`

### API

| Subject                  | Mô tả                                       |
| ------------------------ | ------------------------------------------- |
| `catalog.titles.list`    | Filter + cursor                             |
| `catalog.titles.get`     | Theo id hoặc slug                           |
| `catalog.titles.byIds`   | **Batch** — dùng cho composition, tránh N+1 |
| `catalog.titles.similar` | More Like This                              |
| `catalog.episodes.list`  | Theo titleId + season                       |
| `catalog.episodes.get`   |                                             |
| `catalog.search`         | Text index + bỏ dấu tiếng Việt              |
| `catalog.rows.get`       | Trending, new, top10, theo genre            |
| `catalog.genres.list`    |                                             |
| `catalog.admin.*`        | CRUD, publish, import TMDB                  |

> `catalog.titles.byIds` là bắt buộc. Thiếu nó, gateway sẽ gọi `titles.get` trong vòng lặp — N+1 qua mạng, tệ hơn N+1 qua database rất nhiều.

### Event phát ra

| Subject                     | Khi nào                                                 |
| --------------------------- | ------------------------------------------------------- |
| `catalog.title.published`   | Title lên sóng                                          |
| `catalog.title.updated`     | Sửa metadata (để invalidate cache, cập nhật read model) |
| `catalog.title.unpublished` |                                                         |
| `catalog.episode.published` | **notification nghe để báo người theo dõi**             |
| `catalog.title.deleted`     | media nghe để dọn asset                                 |

### Event tiêu thụ

| Subject                    | Làm gì                                                   |
| -------------------------- | -------------------------------------------------------- |
| `media.asset.ready`        | Đánh dấu title/episode đã phát được                      |
| `media.asset.failed`       | Đánh dấu lỗi, hiện cảnh báo ở admin                      |
| `activity.title.completed` | Tăng `stats.viewCount` (gộp theo lô, không ghi từng cái) |

### Phụ thuộc đồng bộ

Không có.

---

## 4. media-service

### Trách nhiệm

Tài sản số: presigned upload, ffprobe, tạo job transcode, cấp playback token, sinh HLS manifest động, phục vụ key AES-128, kiểm tra quyền phát.

### Dữ liệu sở hữu — `nekoflix_media`

`assets` · `mediaKeys` · `outbox`

### API

| Subject                    | Mô tả                                             |
| -------------------------- | ------------------------------------------------- |
| `media.upload.presign`     | Multipart upload URL                              |
| `media.upload.complete`    | ffprobe + enqueue                                 |
| `media.playback.authorize` | **Endpoint nóng nhất** — trả manifest URL + token |
| `media.manifest.master`    | Sinh động theo `maxQuality`                       |
| `media.manifest.variant`   |                                                   |
| `media.key.get`            | Trả 16 byte AES                                   |
| `media.asset.get`          | Trạng thái asset                                  |
| `media.asset.retry`        | Chạy lại job fail                                 |
| `media.asset.delete`       |                                                   |

### Event phát ra

| Subject                    | Khi nào                                      |
| -------------------------- | -------------------------------------------- |
| `media.asset.ready`        | Transcode xong — catalog + notification nghe |
| `media.asset.failed`       |                                              |
| `media.transcode.progress` | realtime nghe để đẩy xuống admin UI          |

### Event tiêu thụ

| Subject                        | Làm gì                             |
| ------------------------------ | ---------------------------------- |
| `billing.subscription.changed` | Xóa cache subscription của user đó |
| `catalog.title.deleted`        | Dọn asset + object trên MinIO      |

### Phụ thuộc đồng bộ

| Gọi tới                      | Vì sao                          | Khi nó chết                                      |
| ---------------------------- | ------------------------------- | ------------------------------------------------ |
| `identity.user.subscription` | Biết `maxQuality`, `maxStreams` | Dùng cache Redis 60s; hết cache thì từ chối phát |
| `activity.progress.get`      | Trả `startPositionSec`          | Bỏ qua, phát từ đầu (không thiết yếu)            |

> Hai lời gọi này là lý do `media-service` cache subscription. Không cache thì mỗi lần bấm Play là một hop sync bắt buộc.

---

## 5. transcode-worker

Không phải service. Worker trong bounded context của media.

### Trách nhiệm

Tải file gốc, validate magic bytes + ffprobe, chạy FFmpeg ra HLS đa bitrate, sinh sprite + poster, trích phụ đề, upload MinIO, báo progress.

### Dữ liệu

Dùng `nekoflix_media` (cùng credential với media-service). Đây là ngoại lệ **có chủ đích và duy nhất** của quy tắc "một DB một service" — worker là cùng một bounded context, chỉ khác process.

### Vào / ra

- **Vào**: BullMQ queue `transcode` (Redis)
- **Ra**: Redis pub/sub cho progress; ghi `assets`; ghi `outbox` để phát `media.asset.ready`

Chi tiết: [07 — Video Pipeline](07-video-pipeline.md).

---

## 6. activity-service

### Trách nhiệm

Quan hệ người dùng ↔ nội dung: tiến độ xem, lịch sử, watchlist, rating, giới hạn luồng đồng thời.

### Dữ liệu sở hữu — `nekoflix_activity`

`progress` · `watchHistory` · `watchlist` · `ratings` · `titleProjections` (read model) · `outbox`

### API

| Subject                      | Mô tả                                                |
| ---------------------------- | ---------------------------------------------------- |
| `activity.progress.update`   | Upsert, gọi mỗi 10s — **tần suất cao nhất hệ thống** |
| `activity.progress.get`      | Một playable                                         |
| `activity.progress.continue` | Continue Watching                                    |
| `activity.watchlist.list`    |                                                      |
| `activity.watchlist.ids`     | Chỉ trả id — dùng cho composition                    |
| `activity.watchlist.toggle`  |                                                      |
| `activity.rating.set`        |                                                      |
| `activity.stream.acquire`    | Chiếm slot, kiểm tra giới hạn                        |
| `activity.stream.heartbeat`  | Mỗi 30s                                              |
| `activity.stream.release`    |                                                      |

### Event phát ra

| Subject                                 | Khi nào                                            |
| --------------------------------------- | -------------------------------------------------- |
| `activity.progress.updated`             | Gộp theo lô, phát mỗi 60s — **không phát mỗi 10s** |
| `activity.title.completed`              | Xem >= 95%                                         |
| `activity.watchlist.added` / `.removed` |                                                    |
| `activity.rating.changed`               |                                                    |

> `progress.update` chạy mỗi 10 giây cho mỗi người đang xem. Phát event cho từng lần sẽ làm ngập NATS mà không ai cần độ chi tiết đó. Gom lại và phát mỗi 60 giây.

### Event tiêu thụ

| Subject                    | Làm gì                                             |
| -------------------------- | -------------------------------------------------- |
| `catalog.title.published`  | Tạo/cập nhật `titleProjections`                    |
| `catalog.title.updated`    | Cập nhật projection                                |
| `catalog.title.deleted`    | Xóa projection + dọn watchlist/progress trỏ tới nó |
| `identity.profile.deleted` | Xóa toàn bộ dữ liệu của profile đó                 |

### Read model `titleProjections`

```ts
{
  (titleId, title, posterUrl, runtimeSec, maturityRating, type, updatedAt, version);
}
```

Chỉ các field cần để **hiển thị và sắp xếp** watchlist/continue-watching mà không phải gọi catalog. Không chép description, cast, credits.

Cần job đối soát hàng tuần: so `titleProjections` với `catalog.titles.byIds` để phát hiện event bị mất.

### Phụ thuộc đồng bộ

Không có — nhờ có `titleProjections`. Đây là ví dụ cho thấy read model mua được sự độc lập.

---

## 7. realtime-service

### Trách nhiệm

Socket.IO gateway, Watch Party (sync playback, chat, reaction, chuyển host), presence, đẩy notification realtime, đẩy transcode progress.

### Dữ liệu sở hữu — `nekoflix_realtime`

`watchParties` (snapshot). Trạng thái nóng ở Redis: `rt:party:*`, `rt:presence:*`.

### Đặc thù

Service **stateful** duy nhất. Client kết nối trực tiếp WebSocket tới đây (qua gateway chỉ để upgrade), không đi qua NATS cho từng message — độ trễ không cho phép.

Scale ngang cần Redis adapter cho Socket.IO. Chi tiết: [06 — Realtime](06-realtime-websocket.md).

### API

| Subject                 | Mô tả                                  |
| ----------------------- | -------------------------------------- |
| `realtime.party.create` |                                        |
| `realtime.party.get`    |                                        |
| `realtime.notify.push`  | Service khác nhờ đẩy xuống một profile |

### Event tiêu thụ

| Subject                         | Làm gì                      |
| ------------------------------- | --------------------------- |
| `media.transcode.progress`      | Đẩy xuống admin đang xem    |
| `media.asset.ready` / `.failed` | Nt                          |
| `notification.created`          | Đẩy xuống profile liên quan |
| `identity.security.alert`       | Đẩy cảnh báo bảo mật        |

### Phụ thuộc đồng bộ

| Gọi tới                            | Vì sao                                          |
| ---------------------------------- | ----------------------------------------------- |
| `identity.profile.verifyOwnership` | Xác thực lúc handshake                          |
| `media.playback.authorize`         | Kiểm tra thành viên party có quyền xem title đó |

---

## 8. billing-service

### Trách nhiệm

Gói thuê bao, mock payment provider, webhook handler, vòng đời subscription.

### Dữ liệu sở hữu — `nekoflix_billing`

`subscriptions` · `payments` · `paymentEvents` · `checkoutSessions` · `outbox`

### API

| Subject                       | Mô tả |
| ----------------------------- | ----- |
| `billing.plans.list`          |       |
| `billing.subscription.get`    |       |
| `billing.checkout.create`     |       |
| `billing.subscription.cancel` |       |
| `billing.invoices.list`       |       |

Webhook `/webhooks/payments` là HTTP, **không** qua gateway — mock provider gọi thẳng vào service. Chi tiết: [ADR-009](adr/009-mock-payment-provider.md).

### Event phát ra

| Subject                          | Ai nghe                                                 |
| -------------------------------- | ------------------------------------------------------- |
| `billing.subscription.activated` | identity (denormalize), media (xóa cache), notification |
| `billing.subscription.changed`   | Nt                                                      |
| `billing.subscription.canceled`  | Nt                                                      |
| `billing.payment.failed`         | notification (gửi mail)                                 |

### Phụ thuộc đồng bộ

Không có.

---

## 9. notification-service

### Trách nhiệm

Thông báo in-app, gửi email, quản lý tùy chọn nhận thông báo.

### Dữ liệu sở hữu — `nekoflix_notification`

`notifications` · `emailOutbox` · `subscriberIndex` (ai theo dõi series nào) · `outbox`

### Đặc thù

Service **thuần consumer** — gần như chỉ nghe event, hiếm khi được gọi.

### Event tiêu thụ

| Subject                     | Hành động                                     |
| --------------------------- | --------------------------------------------- |
| `identity.user.registered`  | Email chào mừng + link verify                 |
| `identity.user.logged_in`   | Email "đăng nhập thiết bị mới"                |
| `identity.security.alert`   | Email cảnh báo bảo mật                        |
| `catalog.episode.published` | Thông báo cho người có series trong watchlist |
| `media.asset.ready`         | Báo admin                                     |
| `billing.payment.failed`    | Email nhắc thanh toán                         |
| `activity.watchlist.added`  | Cập nhật `subscriberIndex`                    |

### Event phát ra

`notification.created` — realtime nghe để đẩy xuống client.

### Phụ thuộc đồng bộ

Không có. Khi cần thông tin bổ sung (tên phim, email user), lấy từ chính payload của event — **đây là lý do event phải chứa đủ dữ liệu**, không chỉ chứa id.

---

## 10. recommendation-service

### Trách nhiệm

Content-based similarity, item-item collaborative filtering, vector sở thích, phục vụ row gợi ý.

### Dữ liệu sở hữu — `nekoflix_reco`

`titleSimilarity` · `tasteVectors` · `titleFeatures` · `outbox`

### API

| Subject                  | Mô tả          |
| ------------------------ | -------------- |
| `reco.forYou`            | Theo profile   |
| `reco.becauseYouWatched` |                |
| `reco.similar`           | More Like This |

### Event tiêu thụ

| Subject                    | Làm gì                |
| -------------------------- | --------------------- |
| `activity.title.completed` | Cập nhật taste vector |
| `activity.rating.changed`  | Nt                    |
| `activity.watchlist.added` | Nt                    |
| `catalog.title.published`  | Tính `titleFeatures`  |
| `catalog.title.updated`    | Tính lại              |

### Job định kỳ

Cron hàng đêm tính lại ma trận item-item. Chi tiết: [ADR-005](adr/005-recommendation-approach.md).

### Phụ thuộc đồng bộ

Không có. Tất cả dữ liệu cần đã được tích lũy qua event.

---

## Ma trận phụ thuộc

Hàng gọi cột (**S** = sync, **E** = event):

| ↓gọi →bị gọi     | identity | catalog | media | activity | realtime | billing | notif | reco |
| ---------------- | -------- | ------- | ----- | -------- | -------- | ------- | ----- | ---- |
| **gateway**      | S        | S       | S     | S        | S        | S       | S     | S    |
| **identity**     | —        |         |       |          |          | E       |       |      |
| **catalog**      |          | —       | E     | E        |          |         |       |      |
| **media**        | **S**    | E       | —     | **S**    |          | E       |       |      |
| **activity**     | E        | E       |       | —        |          |         |       |      |
| **realtime**     | **S**    |         | **S** |          | —        |         | E     |      |
| **billing**      |          |         |       |          |          | —       |       |      |
| **notification** | E        | E       | E     | E        |          | E       | —     |      |
| **reco**         |          | E       |       | E        |          |         |       | —    |

**Chỉ có 5 lời gọi sync giữa các service** (in đậm). Đây là con số cần theo dõi — mỗi lần thêm một mũi tên sync, hệ thống cứng thêm một chút.

Nếu bảng này dần đầy chữ **S**, kiến trúc đang trượt về distributed monolith.

### Dấu hiệu ranh giới sai

Kiểm tra định kỳ, phát hiện sớm thì sửa rẻ:

- Sửa một tính năng phải deploy > 2 service
- Một request đi qua > 2 hop sync
- Hai service luôn deploy cùng nhau
- Một service chỉ toàn CRUD, không có logic riêng
- Read model phình to gần bằng bản gốc

---

**Tiếp theo**: [14 — Inter-service Communication](14-inter-service-communication.md)
