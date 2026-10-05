# 01 — Product Requirements

Ký hiệu độ ưu tiên: **P0** = bắt buộc có (MVP) · **P1** = nên có · **P2** = nice to have.

---

## A. Authentication & Account

### A1. Đăng ký bằng email/password — P0

- Email phải unique, validate format, lowercase trước khi lưu
- Password tối thiểu 8 ký tự, phải có chữ + số; hash bằng **argon2id** (không dùng bcrypt — xem [ADR-002](adr/002-password-hashing.md))
- Sau khi đăng ký, gửi email xác thực chứa token TTL 24h
- Tài khoản chưa verify vẫn đăng nhập được nhưng **không xem được video** (chỉ browse)

**Acceptance criteria**

- Đăng ký trùng email → `409 EMAIL_TAKEN`, message không tiết lộ email đó đã tồn tại ở flow login
- Click link verify 2 lần → lần 2 trả `410 TOKEN_CONSUMED`, không crash

### A2. Đăng nhập & phiên làm việc — P0

- Trả về `accessToken` (JWT, TTL **15 phút**, trả trong body) + `refreshToken` (opaque, TTL **30 ngày**, trong **httpOnly + Secure + SameSite=Lax cookie**)
- **Refresh token rotation**: mỗi lần refresh sinh token mới, token cũ bị vô hiệu
- **Reuse detection**: nếu một refresh token đã dùng rồi lại được dùng tiếp → coi là bị đánh cắp → **thu hồi toàn bộ session của user đó** và gửi email cảnh báo
- Rate limit: 5 lần login sai / 15 phút / IP+email → khóa tạm 15 phút

### A3. OAuth2 — P0

Provider: **Google**, **GitHub**. Flow: Authorization Code + **PKCE**.

- Nếu email từ provider trùng với tài khoản local đã verify → **link** vào tài khoản đó
- Nếu trùng với tài khoản chưa verify → chặn, yêu cầu verify email trước (chống account takeover)
- Một user có thể link nhiều provider; không được unlink provider cuối cùng nếu chưa đặt password

### A4. Quên mật khẩu — P0

Token TTL 1h, dùng 1 lần. Đổi password → thu hồi mọi refresh token đang hoạt động.

### A5. Two-Factor Authentication (TOTP) — P1

RFC 6238, 6 số, window ±1. Sinh 10 recovery code dùng 1 lần, hiển thị **đúng một lần** khi bật.

### A6. Quản lý session — P1

User xem được danh sách thiết bị đang đăng nhập (device, IP, vị trí ước lượng, lần hoạt động cuối) và đăng xuất từ xa từng phiên hoặc tất cả.

---

## B. Profile (hồ sơ xem)

### B1. Multi-profile — P0

- Tối đa **5 profile** / tài khoản, mỗi profile có tên + avatar (chọn từ bộ có sẵn)
- Mọi dữ liệu cá nhân hóa (watchlist, progress, history, rating) gắn với **profile**, không phải account
- Chọn profile sau khi login → lưu `activeProfileId` vào access token claim

### B2. Kids profile — P1

- Bật cờ `isKid` → chỉ thấy title có `maturityRating` <= PG
- UI đơn giản hóa, tắt Watch Party với người lạ

### B3. Profile PIN — P1

PIN 4 số, hash riêng. Profile có PIN phải nhập PIN mới chuyển vào được.

---

## C. Catalog & Discovery

### C1. Trang chủ — P0

Các hàng (row) theo thứ tự:

1. **Hero banner** — 1 title được feature, có trailer autoplay (muted)
2. **Continue Watching** — progress > 2% và < 95%, sort theo `updatedAt` desc
3. **Trending Now** — tính theo lượt view 7 ngày gần nhất
4. **New Releases** — `releaseDate` trong 90 ngày
5. **Top 10 in Vietnam** — có badge số thứ tự
6. Các row theo genre user hay xem nhất (tối đa 5 row)

Mỗi row lazy-load, infinite horizontal scroll.

### C2. Chi tiết title — P0

- Movie: mô tả, năm, thời lượng, genre, cast, director, maturity rating, trailer, nút Play / + My List / Like-Dislike
- Series: thêm season selector + episode list (thumbnail, tên, mô tả, thời lượng, progress bar)
- "More Like This" — 12 title liên quan

### C3. Search — P0

- Full-text trên `title`, `originalTitle`, `cast.name`, `description`
- Debounce 300ms, kết quả trả về trong < 300ms (p95)
- Hỗ trợ tìm **không dấu** tiếng Việt (`"nguoi nhen"` → `"Người Nhện"`)
- Filter: genre, năm, maturity rating, loại (movie/series)
- Lưu 10 từ khóa gần nhất / profile

### C4. My List (watchlist) — P0

Thêm/xóa title, sort theo thời điểm thêm hoặc theo tên.

### C5. Recommendation — P1

Xem [ADR-005](adr/005-recommendation-approach.md). Hai tầng:

1. **Content-based**: cosine similarity trên vector genre + cast + keyword
2. **Collaborative**: item-item, tính offline bằng cron job hàng đêm

Cold start (profile mới) → fallback về Trending.

---

## D. Playback

### D1. Player — P0

- HLS adaptive bitrate qua `hls.js` (Safari dùng native HLS)
- Controls: play/pause, seek, volume, fullscreen, PiP, tốc độ phát (0.5x–2x)
- Chọn chất lượng thủ công (Auto / 1080p / 720p / 480p / 360p)
- Phụ đề WebVTT, chọn ngôn ngữ, tùy chỉnh cỡ chữ/màu/nền
- Nhiều audio track (nếu có)
- Phím tắt: `Space` play/pause, `←/→` ±10s, `↑/↓` volume, `F` fullscreen, `M` mute, `C` subtitle

### D2. Lưu tiến độ xem — P0

- Gửi progress mỗi **10 giây** và tại các sự kiện `pause`, `seeked`, `ended`, `beforeunload`
- Dùng `navigator.sendBeacon` cho `beforeunload`
- Server lưu `positionSec`, `durationSec`, `completed` (>= 95%)
- Mở lại trên thiết bị khác → resume đúng vị trí (sai số <= 10s)

### D3. Skip intro / Next episode — P1

- Metadata `introStart`/`introEnd` (nhập tay ở admin) → hiện nút "Skip Intro"
- Còn 15s cuối episode → hiện overlay "Next Episode" đếm ngược, tự chuyển

### D4. Giới hạn số luồng đồng thời — P1

Theo gói đăng ký (Basic 1 / Standard 2 / Premium 4). Vượt quá → luồng mới bị chặn với thông báo rõ thiết bị nào đang chiếm. Dùng Redis để đếm active stream, TTL heartbeat 30s.

---

## E. Realtime (WebSocket)

### E1. Watch Party — P0

- Host tạo room → nhận link mời (`/watch/:titleId?party=:code`)
- Tối đa **10 người** / room
- Host điều khiển play/pause/seek, mọi người sync (độ lệch < 500ms)
- Chat trong room, emoji reaction bay lên màn hình
- Thành viên join giữa chừng → tự seek tới vị trí hiện tại của host
- Host rời → chuyển quyền cho người vào sớm nhất, hoặc đóng room nếu không còn ai

### E2. Presence — P1

Hiện bạn bè đang online và đang xem gì (có thể tắt trong settings).

### E3. Notification realtime — P1

Đẩy khi: có episode mới của series trong My List, lời mời Watch Party, cảnh báo đăng nhập lạ.

### E4. Transcode progress — P0 (admin)

Admin upload video → thấy progress bar realtime theo từng rendition.

---

## F. Social

### F1. Rating — P1

Like / Dislike / Love (giống Netflix). Ảnh hưởng tới recommendation.

### F2. Review & comment — P2

Review có text + điểm 1–10. Comment lồng 1 cấp. Moderator duyệt report.

### F3. Friend — P2

Gửi/chấp nhận lời mời kết bạn, cần thiết cho presence và Watch Party riêng tư.

---

## G. Subscription & Billing (mô phỏng) — P1

**Không tích hợp payment gateway thật.** Dự án tự viết một **mock payment provider** chạy trong chính codebase — xem [ADR-009](adr/009-mock-payment-provider.md). Mục tiêu là học đúng những bài học của billing (webhook, idempotency, state machine, reconciliation), không phải để nhận tiền.

| Gói      | Giá hiển thị   | Chất lượng tối đa | Luồng đồng thời |
| -------- | -------------- | ----------------- | --------------- |
| Free     | 0đ             | 480p              | 1               |
| Basic    | 70.000đ/tháng  | 720p              | 1               |
| Standard | 180.000đ/tháng | 1080p             | 2               |
| Premium  | 260.000đ/tháng | 1080p             | 4               |

Giá chỉ là con số hiển thị. Không có giao dịch thật, không có thẻ thật.

### G1. Luồng checkout mô phỏng — P1

1. User chọn gói → `POST /billing/checkout` → trả `checkoutUrl` trỏ tới trang `/mock-pay/:sessionId` **do chính app phục vụ**
2. Trang đó mô phỏng giao diện cổng thanh toán, có 4 nút: **Thành công**, **Thẻ bị từ chối**, **Hết hạn phiên**, **Hủy**
3. Chọn xong → provider gửi **webhook có chữ ký HMAC** về `/webhooks/payments`, y hệt cách Stripe làm
4. Webhook handler verify chữ ký, kiểm tra idempotency, cập nhật subscription

Có nút chọn kết quả là **cố ý** — để test được nhánh thất bại, thứ mà sandbox thật luôn làm khó.

### G2. Yêu cầu bắt buộc với webhook handler — P1

Đây là phần có giá trị học tập thật sự, phải làm đúng:

- **Verify chữ ký HMAC-SHA256** trên raw body, so sánh bằng `timingSafeEqual`
- **Chống replay**: từ chối webhook có timestamp lệch quá 5 phút
- **Idempotent**: lưu `eventId` unique, nhận lại cùng event → trả 200 và bỏ qua
- **Xử lý out-of-order**: event đến sai thứ tự phải không làm hỏng trạng thái (so sánh timestamp của event với `subscription.updatedAt`)
- **Retry**: provider thử lại tối đa 5 lần với exponential backoff nếu nhận mã khác 2xx
- Toàn bộ cập nhật nằm trong **một transaction**

### G3. Mô phỏng vòng đời subscription — P2

Cron job chạy mỗi phút (tua nhanh thời gian trong môi trường dev):

- Tới `currentPeriodEnd` → phát event `invoice.paid` → gia hạn
- Cấu hình được tỉ lệ thanh toán thất bại → `invoice.payment_failed` → `past_due` → sau 3 lần → `canceled`

Cho phép học đúng bài toán trạng thái của subscription mà không phải chờ 30 ngày.

---

## H. Admin

### H1. Quản lý catalog — P0

CRUD title/season/episode, upload poster + backdrop, gắn genre/cast.

### H2. Upload & transcode — P0

Upload multipart trực tiếp lên MinIO bằng presigned URL (không qua API server). Theo dõi job, retry job fail, xóa asset.

### H3. Analytics — P2

DAU/MAU, top title theo lượt xem, thời lượng xem trung bình, tỉ lệ hoàn thành, biểu đồ retention.

---

## I. Non-functional requirements

| Hạng mục            | Mục tiêu                                                |
| ------------------- | ------------------------------------------------------- |
| API latency         | p95 < 200ms (không tính endpoint search và transcode)   |
| Time to first frame | < 2s trên mạng 10Mbps                                   |
| Frontend LCP        | < 2.5s                                                  |
| Bundle JS ban đầu   | < 250KB gzip                                            |
| Uptime (khi deploy) | 99% — không cam kết cao hơn, đây là dự án học tập       |
| Accessibility       | WCAG 2.1 AA cho các flow chính: login, browse, playback |
| i18n                | vi + en, kiến trúc sẵn sàng cho ngôn ngữ thứ 3          |

---

## J. User stories chính

```
US-01  Là người dùng mới, tôi muốn đăng ký bằng Google chỉ 1 click
       để không phải nhớ thêm mật khẩu.

US-02  Là người dùng, tôi muốn mỗi thành viên trong nhà có profile riêng
       để gợi ý phim không bị lẫn lộn.

US-03  Là người dùng, tôi muốn xem tiếp đúng chỗ đã dừng trên bất kỳ thiết bị nào
       để không phải tua lại.

US-04  Là người dùng ở mạng yếu, tôi muốn video tự giảm chất lượng thay vì buffer
       để xem liền mạch.

US-05  Là người dùng, tôi muốn xem phim cùng bạn ở xa và trò chuyện trong lúc xem
       để có cảm giác xem chung.

US-06  Là phụ huynh, tôi muốn profile của con chỉ thấy nội dung phù hợp tuổi
       để yên tâm.

US-07  Là admin, tôi muốn upload một file MP4 và hệ thống tự lo phần còn lại
       để không cần biết gì về FFmpeg.

US-08  Là người dùng, tôi muốn thấy thiết bị nào đang đăng nhập và đăng xuất từ xa
       để bảo vệ tài khoản.
```

---

**Tiếp theo**: [02 — System Architecture](02-architecture.md)
