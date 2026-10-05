# 04 — API Specification

Base URL: `https://api.nekoflix.local/v1` (local: `http://localhost:4000/v1`)
OpenAPI tự sinh tại `/docs` bằng `@nestjs/swagger`.

## Quy ước chung

### Headers

| Header                                | Bắt buộc                     | Ghi chú                                          |
| ------------------------------------- | ---------------------------- | ------------------------------------------------ |
| `Authorization: Bearer <accessToken>` | Endpoint cần auth            |                                                  |
| `X-Profile-Id: <profileId>`           | Endpoint cá nhân hóa         | Server vẫn verify profile thuộc user trong token |
| `X-Device-Id: <uuid>`                 | Endpoint playback            | Client sinh và lưu `localStorage`                |
| `Idempotency-Key: <uuid>`             | POST có side-effect tiền bạc |                                                  |

### Response thành công

```json
{ "data": {}, "meta": {} }
```

Danh sách có phân trang **cursor-based** (không dùng offset — tránh lệch khi dữ liệu đổi):

```json
{
  "data": [],
  "meta": { "nextCursor": "eyJpZCI6Ii4uLiJ9", "hasMore": true, "limit": 20 }
}
```

### Response lỗi

```json
{
  "error": {
    "code": "PROFILE_LIMIT_REACHED",
    "message": "Tài khoản đã đạt tối đa 5 profile.",
    "details": [{ "field": "name", "issue": "too_long" }],
    "requestId": "01HQ8X..."
  }
}
```

`code` là string ổn định, client switch theo nó. `message` dành cho người đọc, có thể đổi.

### Mã lỗi chính

| HTTP | code                             | Khi nào                                             |
| ---- | -------------------------------- | --------------------------------------------------- |
| 400  | `VALIDATION_FAILED`              | Zod validate fail                                   |
| 401  | `TOKEN_EXPIRED`                  | Access token hết hạn → client gọi refresh           |
| 401  | `TOKEN_INVALID`                  | Chữ ký sai / malformed → logout                     |
| 401  | `INVALID_CREDENTIALS`            | Sai email hoặc password (không nói rõ cái nào)      |
| 403  | `EMAIL_NOT_VERIFIED`             | Chưa verify mà muốn xem video                       |
| 403  | `INSUFFICIENT_ROLE`              | Không đủ quyền                                      |
| 403  | `MATURITY_BLOCKED`               | Profile kids xem nội dung quá tuổi                  |
| 403  | `PROFILE_PIN_REQUIRED`           | Profile có PIN, chưa nhập                           |
| 404  | `NOT_FOUND`                      |                                                     |
| 409  | `EMAIL_TAKEN` / `ALREADY_EXISTS` |                                                     |
| 409  | `STREAM_LIMIT_EXCEEDED`          | Vượt số luồng đồng thời, `details` liệt kê thiết bị |
| 410  | `TOKEN_CONSUMED`                 | Token dùng 1 lần đã dùng rồi                        |
| 422  | `UNPROCESSABLE`                  | Hợp lệ về mặt format nhưng sai nghiệp vụ            |
| 429  | `RATE_LIMITED`                   | Có header `Retry-After`                             |
| 500  | `INTERNAL_ERROR`                 |                                                     |
| 503  | `TRANSCODE_UNAVAILABLE`          | Worker chết / queue đầy                             |

---

## 1. Auth — `/auth`

| Method | Path                             | Auth   | Mô tả                                                |
| ------ | -------------------------------- | ------ | ---------------------------------------------------- |
| POST   | `/auth/register`                 | —      | Đăng ký                                              |
| POST   | `/auth/login`                    | —      | Đăng nhập                                            |
| POST   | `/auth/refresh`                  | Cookie | Rotate refresh token                                 |
| POST   | `/auth/logout`                   | Bearer | Thu hồi session hiện tại                             |
| POST   | `/auth/logout-all`               | Bearer | Thu hồi mọi session                                  |
| POST   | `/auth/verify-email`             | —      | `{ token }`                                          |
| POST   | `/auth/resend-verification`      | Bearer | Rate limit 1 lần / 60s                               |
| POST   | `/auth/forgot-password`          | —      | Luôn trả 200, kể cả email không tồn tại              |
| POST   | `/auth/reset-password`           | —      | `{ token, newPassword }`                             |
| POST   | `/auth/change-password`          | Bearer | `{ currentPassword, newPassword }`                   |
| GET    | `/auth/me`                       | Bearer | User + danh sách profile                             |
| GET    | `/auth/sessions`                 | Bearer | Thiết bị đang đăng nhập                              |
| DELETE | `/auth/sessions/:id`             | Bearer | Đăng xuất từ xa                                      |
| GET    | `/auth/oauth/:provider`          | —      | Redirect tới provider                                |
| GET    | `/auth/oauth/:provider/callback` | —      | Callback, redirect về web kèm code                   |
| POST   | `/auth/oauth/exchange`           | —      | Đổi one-time code lấy token (chống token lộ qua URL) |
| POST   | `/auth/2fa/setup`                | Bearer | Trả secret + QR data URL                             |
| POST   | `/auth/2fa/enable`               | Bearer | `{ code }` → trả recovery codes                      |
| POST   | `/auth/2fa/disable`              | Bearer | `{ password, code }`                                 |
| POST   | `/auth/2fa/verify`               | —      | `{ mfaToken, code }` trong luồng login               |

### POST `/auth/register`

```jsonc
// Request
{ "email": "an@example.com", "password": "Matkhau123", "displayName": "An" }

// 201
{ "data": {
    "user": { "id": "...", "email": "an@example.com", "displayName": "An",
              "emailVerified": false, "role": "user" },
    "accessToken": "eyJ...", "expiresIn": 900 } }
// Set-Cookie: nf_rt=<opaque>; HttpOnly; Secure; SameSite=Lax; Path=/v1/auth; Max-Age=2592000
```

### POST `/auth/login`

```jsonc
// Request
{ "email": "an@example.com", "password": "Matkhau123" }

// 200 — không bật 2FA
{ "data": { "accessToken": "eyJ...", "expiresIn": 900,
            "user": { }, "profiles": [ ] } }

// 200 — có bật 2FA
{ "data": { "mfaRequired": true, "mfaToken": "eyJ...", "expiresIn": 300 } }
```

### POST `/auth/refresh`

Không nhận body — đọc refresh token từ cookie. Trả access token mới + set cookie mới.

```jsonc
// 200
{ "data": { "accessToken": "eyJ...", "expiresIn": 900 } }

// 401 — phát hiện reuse
{ "error": { "code": "TOKEN_REUSE_DETECTED",
             "message": "Phiên đăng nhập đã bị thu hồi vì lý do bảo mật. Vui lòng đăng nhập lại." } }
```

---

## 2. Profiles — `/profiles`

| Method | Path                       | Mô tả                                                |
| ------ | -------------------------- | ---------------------------------------------------- |
| GET    | `/profiles`                | Danh sách profile của user                           |
| POST   | `/profiles`                | Tạo (max 5)                                          |
| GET    | `/profiles/:id`            | Chi tiết                                             |
| PATCH  | `/profiles/:id`            | Cập nhật tên, avatar, prefs                          |
| DELETE | `/profiles/:id`            | Xóa mềm (không xóa được profile cuối)                |
| POST   | `/profiles/:id/select`     | Chọn profile → access token mới có claim `profileId` |
| POST   | `/profiles/:id/verify-pin` | `{ pin }`                                            |
| PUT    | `/profiles/:id/pin`        | Đặt/đổi PIN                                          |
| DELETE | `/profiles/:id/pin`        | Gỡ PIN (cần password tài khoản)                      |

```jsonc
// POST /profiles
{ "name": "Bé Na", "avatarKey": "avatar-03", "isKid": true, "language": "vi" }

// 201
{ "data": { "id": "...", "name": "Bé Na", "avatarKey": "avatar-03",
            "isKid": true, "maturityLimit": "PG", "hasPin": false } }

// 409
{ "error": { "code": "PROFILE_LIMIT_REACHED", "message": "Tối đa 5 profile." } }
```

---

## 3. Catalog — `/catalog`

| Method | Path                           | Auth     | Mô tả                            |
| ------ | ------------------------------ | -------- | -------------------------------- |
| GET    | `/catalog/home`                | Optional | Toàn bộ row trang chủ            |
| GET    | `/catalog/titles`              | Optional | List + filter + cursor           |
| GET    | `/catalog/titles/:idOrSlug`    | Optional | Chi tiết                         |
| GET    | `/catalog/titles/:id/similar`  | Optional | More Like This                   |
| GET    | `/catalog/titles/:id/episodes` | Optional | `?season=1`                      |
| GET    | `/catalog/genres`              | —        |                                  |
| GET    | `/catalog/search`              | Optional | `?q=&genre=&year=&type=&rating=` |
| GET    | `/catalog/search/suggest`      | Optional | Autocomplete, trả tối đa 8       |

### GET `/catalog/home`

```jsonc
// 200
{
  "data": {
    "hero": {
      "id": "...",
      "title": "Tears of Steel",
      "tagline": "...",
      "backdropUrl": "...",
      "logoUrl": "...",
      "trailer": { "provider": "local", "key": "..." },
      "inWatchlist": false,
    },
    "rows": [
      {
        "key": "continue",
        "title": "Xem tiếp",
        "layout": "progress",
        "items": [
          {
            "titleId": "...",
            "episodeId": null,
            "title": "Sintel",
            "backdropUrl": "...",
            "percent": 34.2,
            "positionSec": 180,
            "durationSec": 526,
          },
        ],
      },
      {
        "key": "trending",
        "title": "Thịnh hành",
        "layout": "poster",
        "items": [
          { "id": "...", "title": "...", "posterUrl": "...", "maturityRating": "PG", "year": 2012 },
        ],
      },
      { "key": "top10_vn", "title": "Top 10 tại Việt Nam", "layout": "ranked", "items": [] },
    ],
  },
}
```

> `continue` row chỉ xuất hiện khi có `X-Profile-Id`. Guest nhận phiên bản rút gọn.

### GET `/catalog/titles`

Query: `genre` (slug, lặp lại được) · `type=movie|series` · `yearFrom` · `yearTo` · `rating` · `sort=popularity|newest|rating|title` · `cursor` · `limit` (max 50)

### GET `/catalog/titles/:idOrSlug`

```jsonc
{
  "data": {
    "id": "...",
    "type": "series",
    "slug": "sintel-2010",
    "title": "Sintel",
    "description": "...",
    "releaseDate": "2010-09-27",
    "maturityRating": "PG",
    "genres": [{ "slug": "animation", "name": "Hoạt hình" }],
    "credits": {
      "cast": [{ "personId": "...", "name": "...", "character": "..." }],
      "crew": [{ "name": "...", "job": "director" }],
    },
    "images": { "posterUrl": "...", "backdropUrl": "...", "logoUrl": "..." },
    "seasons": [{ "seasonNumber": 1, "name": "Phần 1", "episodeCount": 8 }],
    "stats": { "avgRating": 8.1, "ratingCount": 342, "viewCount": 10482 },
    "userState": {
      "inWatchlist": true,
      "rating": "like",
      "progress": { "episodeId": "...", "positionSec": 420, "percent": 23.4 },
      "nextEpisode": { "id": "...", "seasonNumber": 1, "episodeNumber": 3 },
    },
  },
}
```

`userState` chỉ có khi gửi `X-Profile-Id`.

### GET `/catalog/search`

Query bắt buộc `q` (min 2 ký tự). Bỏ dấu tiếng Việt ở cả query lẫn index.

```jsonc
{
  "data": [
    {
      "id": "...",
      "type": "movie",
      "title": "Người Nhện",
      "posterUrl": "...",
      "year": 2021,
      "score": 12.4,
    },
  ],
  "meta": { "total": 3, "took": 24 },
}
```

---

## 4. Playback — `/playback` và `/media`

| Method | Path                                             | Mô tả                                     |
| ------ | ------------------------------------------------ | ----------------------------------------- |
| POST   | `/media/:playableId/playback`                    | Xin quyền phát → trả manifest URL + token |
| GET    | `/media/manifest/:assetId/master.m3u8`           | Master playlist (proxy, verify token)     |
| GET    | `/media/manifest/:assetId/:rendition/index.m3u8` | Variant playlist                          |
| GET    | `/media/key/:keyId`                              | Trả AES-128 key (16 byte binary)          |
| GET    | `/media/subtitles/:assetId/:lang.vtt`            | WebVTT                                    |
| POST   | `/playback/progress`                             | Cập nhật tiến độ                          |
| POST   | `/playback/heartbeat`                            | Giữ slot stream, mỗi 30s                  |
| POST   | `/playback/end`                                  | Giải phóng slot                           |
| GET    | `/playback/continue`                             | Continue Watching                         |
| DELETE | `/playback/continue/:titleId`                    | Xóa khỏi Continue Watching                |

### POST `/media/:playableId/playback`

```jsonc
// Request
{ "kind": "episode", "deviceType": "desktop" }

// 200
{ "data": {
  "assetId": "...",
  "manifestUrl": "https://api.../v1/media/manifest/<assetId>/master.m3u8",
  "playbackToken": "eyJ...",        // JWT TTL 6h, scope chỉ asset này
  "streamSessionId": "...",          // dùng cho heartbeat và end
  "maxQuality": "1080p",
  "startPositionSec": 420,
  "markers": { "introStart": 0, "introEnd": 62, "creditsStart": 1340 },
  "subtitles": [ { "language": "vi", "label": "Tiếng Việt",
                   "url": "...", "isDefault": true } ],
  "nextEpisode": { "id": "...", "name": "...", "stillUrl": "..." } } }

// 409
{ "error": { "code": "STREAM_LIMIT_EXCEEDED",
             "message": "Gói Standard cho phép 2 luồng cùng lúc.",
             "details": [ { "deviceLabel": "Chrome trên Windows",
                            "startedAt": "2026-10-05T03:10:00Z" } ] } }
```

> `playbackToken` đi trong query string của manifest/segment vì `hls.js` không cho set header cho mọi request segment. Token có TTL ngắn và bind với `assetId` + `deviceId` để giảm rủi ro.

### POST `/playback/progress`

```jsonc
// Request — chịu được gửi trùng, upsert theo (profileId, titleId, episodeId)
{ "titleId": "...", "episodeId": "...", "positionSec": 435, "durationSec": 1820 }

// 204 No Content
```

Gọi mỗi 10s. Server bỏ qua nếu `positionSec` lùi quá 1s so với lần trước **trừ khi** có cờ `"seeked": true`.

---

## 5. Watchlist & Ratings

| Method | Path                  | Mô tả                                      |
| ------ | --------------------- | ------------------------------------------ |
| GET    | `/watchlist`          | `?sort=added\|title`                       |
| POST   | `/watchlist`          | `{ titleId }` → 201 hoặc 204 nếu đã có     |
| DELETE | `/watchlist/:titleId` |                                            |
| PUT    | `/ratings/:titleId`   | `{ value: "like" \| "dislike" \| "love" }` |
| DELETE | `/ratings/:titleId`   |                                            |

---

## 6. Recommendation — `/recommendations`

| Method | Path                                            | Mô tả                    |
| ------ | ----------------------------------------------- | ------------------------ |
| GET    | `/recommendations/for-you`                      | Dựa trên lịch sử profile |
| GET    | `/recommendations/because-you-watched/:titleId` |                          |
| GET    | `/recommendations/trending`                     | Không cần profile        |

---

## 7. Watch Party — `/parties`

REST chỉ lo tạo/join/lấy state; mọi thứ realtime đi qua WebSocket ([06](06-realtime-websocket.md)).

| Method | Path                  | Mô tả                                                |
| ------ | --------------------- | ---------------------------------------------------- |
| POST   | `/parties`            | `{ titleId, episodeId? }` → trả `code` + `inviteUrl` |
| GET    | `/parties/:code`      | Thông tin room trước khi join                        |
| POST   | `/parties/:code/join` | Trả `wsToken` để kết nối gateway                     |
| DELETE | `/parties/:code`      | Host kết thúc                                        |

---

## 8. Notifications — `/notifications`

| Method | Path                          | Mô tả                      |
| ------ | ----------------------------- | -------------------------- |
| GET    | `/notifications`              | `?unreadOnly=true&cursor=` |
| GET    | `/notifications/unread-count` |                            |
| POST   | `/notifications/:id/read`     |                            |
| POST   | `/notifications/read-all`     |                            |

---

## 9. Billing — `/billing` (mock provider)

Không dùng payment gateway thật — xem [ADR-009](adr/009-mock-payment-provider.md).

| Method | Path                    | Mô tả                                    |
| ------ | ----------------------- | ---------------------------------------- |
| GET    | `/billing/plans`        | Danh sách gói                            |
| GET    | `/billing/subscription` | Gói hiện tại                             |
| GET    | `/billing/invoices`     | Lịch sử hóa đơn, cursor                  |
| POST   | `/billing/checkout`     | `{ plan }` → URL trang checkout mô phỏng |
| POST   | `/billing/cancel`       | Hủy vào cuối chu kỳ                      |
| POST   | `/billing/resume`       | Bỏ hủy khi chưa hết chu kỳ               |
| POST   | `/webhooks/payments`    | **Ngoài `/v1`**, verify HMAC, raw body   |

### Mock provider — endpoint riêng

Nằm dưới `/mock-pay`, **chỉ bật khi `BILLING_PROVIDER=mock`**. Guard chặn hoàn toàn nếu `NODE_ENV=production` mà biến này không được set rõ ràng.

| Method | Path                            | Mô tả                          |
| ------ | ------------------------------- | ------------------------------ |
| GET    | `/mock-pay/:sessionId`          | Trang checkout mô phỏng (HTML) |
| POST   | `/mock-pay/:sessionId/complete` | `{ choice }` → phát webhook    |

### POST `/billing/checkout`

```jsonc
// Request
{ "plan": "standard" }

// 201
{ "data": {
  "sessionId": "cs_mock_7f3a...",
  "checkoutUrl": "http://localhost:5173/mock-pay/cs_mock_7f3a...",
  "amount": 180000,
  "currency": "VND",
  "expiresAt": "2026-10-05T04:30:00Z" } }
```

### POST `/mock-pay/:sessionId/complete`

```jsonc
// Request — user bấm một trong các nút trên trang mô phỏng
{ "choice": "success" }
// choice: 'success' | 'card_declined' | 'insufficient_funds' | 'expired' | 'canceled'

// 200 — provider sẽ gửi webhook bất đồng bộ, KHÔNG cập nhật subscription ở đây
{ "data": { "redirectUrl": "http://localhost:5173/account/billing?status=processing" } }
```

> Cố ý **không** cập nhật subscription ngay trong request này. Trạng thái chỉ đổi khi webhook về — đúng như gateway thật. Nếu làm tắt ở đây thì mất sạch giá trị học tập, và FE sẽ không được viết để xử lý trạng thái `processing`.

### POST `/webhooks/payments`

```
Headers:
  X-Payment-Signature: t=1759636800,v1=5257a869e7ec...
  X-Payment-Event-Id:  evt_mock_9b2c...
Content-Type: application/json
```

```jsonc
// Body — raw, KHÔNG được parse trước khi verify chữ ký
{
  "id": "evt_mock_9b2c...",
  "type": "checkout.completed",
  "createdAt": "2026-10-05T04:00:12Z",
  "data": {
    "sessionId": "cs_mock_7f3a...",
    "userId": "665f1a...",
    "plan": "standard",
    "invoiceId": "in_mock_4d8e...",
    "amount": 180000,
    "periodStart": "2026-10-05T04:00:12Z",
    "periodEnd": "2026-11-05T04:00:12Z",
  },
}
```

**Các loại event**: `checkout.completed` · `checkout.failed` · `checkout.expired` · `invoice.paid` · `invoice.payment_failed` · `subscription.canceled`

**Quy tắc trả về** (provider dựa vào đây để quyết định retry):

| HTTP | Nghĩa                                           | Provider làm gì                                          |
| ---- | ----------------------------------------------- | -------------------------------------------------------- |
| 200  | Đã xử lý, hoặc đã nhận rồi (duplicate)          | Dừng                                                     |
| 400  | Chữ ký sai / payload hỏng                       | Dừng, ghi log lỗi                                        |
| 409  | Event cũ hơn trạng thái hiện tại (out-of-order) | Dừng — bỏ qua có chủ đích                                |
| 500  | Lỗi tạm thời phía ta                            | Retry, tối đa 5 lần, backoff 1s → 5s → 25s → 125s → 625s |

Verify chữ ký:

```ts
const [t, v1] = parseSignatureHeader(req.headers['x-payment-signature']);
if (Math.abs(Date.now() / 1000 - Number(t)) > 300) throw new BadRequest('SIGNATURE_EXPIRED');

const expected = createHmac('sha256', WEBHOOK_SECRET)
  .update(`${t}.${req.rawBody}`) // rawBody, không phải JSON.stringify(req.body)
  .digest('hex');

if (!timingSafeEqual(Buffer.from(v1), Buffer.from(expected)))
  throw new BadRequest('SIGNATURE_INVALID');
```

> `rawBody` là bắt buộc. `JSON.stringify(req.body)` sẽ cho chuỗi khác (thứ tự key, khoảng trắng) → chữ ký không bao giờ khớp. Cấu hình `bodyParser` giữ raw buffer riêng cho route này.

---

## 10. Admin — `/admin`

Mọi endpoint cần role `moderator` trở lên (analytics cần `admin`).

### Catalog

| Method                | Path                                             |
| --------------------- | ------------------------------------------------ |
| POST / PATCH / DELETE | `/admin/titles`, `/admin/titles/:id`             |
| POST                  | `/admin/titles/:id/publish`                      |
| POST                  | `/admin/titles/import-tmdb` — `{ tmdbId, type }` |
| POST / PATCH / DELETE | `/admin/episodes`, `/admin/episodes/:id`         |

### Media

| Method | Path                              | Mô tả                                                                  |
| ------ | --------------------------------- | ---------------------------------------------------------------------- |
| POST   | `/admin/media/upload-url`         | `{ fileName, sizeBytes, mimeType, owner }` → presigned PUT + `assetId` |
| POST   | `/admin/media/:assetId/complete`  | Báo upload xong → ffprobe + enqueue                                    |
| GET    | `/admin/media/:assetId`           | Trạng thái asset                                                       |
| POST   | `/admin/media/:assetId/retry`     | Chạy lại job fail                                                      |
| DELETE | `/admin/media/:assetId`           | Xóa asset + object trên MinIO                                          |
| POST   | `/admin/media/:assetId/subtitles` | Upload WebVTT                                                          |
| GET    | `/admin/queue/stats`              | waiting / active / failed                                              |

### User & Analytics

| Method | Path                                                       |
| ------ | ---------------------------------------------------------- |
| GET    | `/admin/users` — `?q=&role=&status=&cursor=`               |
| PATCH  | `/admin/users/:id` — đổi role, suspend                     |
| GET    | `/admin/analytics/overview` — DAU/MAU, tổng giờ xem        |
| GET    | `/admin/analytics/titles` — top theo view, completion rate |
| GET    | `/admin/audit-logs`                                        |

---

## 11. Rate limit

| Nhóm                            | Giới hạn                       |
| ------------------------------- | ------------------------------ |
| `/auth/login`, `/auth/register` | 5 req / 15 phút / (IP + email) |
| `/auth/forgot-password`         | 3 req / giờ / email            |
| `/auth/refresh`                 | 30 req / giờ / session         |
| `/catalog/search`               | 60 req / phút / IP             |
| `/playback/progress`            | 20 req / phút / profile        |
| Mặc định                        | 300 req / phút / IP            |

Header trả về: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, và `Retry-After` khi bị chặn.

## 12. Versioning

URI versioning (`/v1`). Breaking change → `/v2`, giữ `/v1` chạy song song tối thiểu 3 tháng. Thêm field không phải breaking change; client phải bỏ qua field lạ.

---

**Tiếp theo**: [05 — Authentication & Authorization](05-authentication.md)
