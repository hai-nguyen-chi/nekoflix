# 00 — Tổng quan & Scope

## 1. Mục tiêu dự án

Xây dựng **Nekoflix** — một nền tảng streaming video self-hosted có đầy đủ các khối chức năng của một sản phẩm thật:

- Authentication nhiều lớp (email/password, OAuth2, refresh token rotation, multi-profile)
- Video pipeline thật: upload → transcode đa bitrate → HLS → adaptive streaming
- Realtime: Watch Party, presence, notification, sync tiến độ xem
- Catalog: search, filter, recommendation cơ bản, continue watching

**Mục tiêu thực sự là học + portfolio.** Vì vậy ưu tiên:

1. Code đọc được, có kiến trúc rõ ràng — hơn là tối ưu hiệu năng cực hạn
2. Mỗi tính năng "khó" (transcode, WebSocket, OAuth, token rotation) phải làm **thật**, không mock
3. Mỗi quyết định kiến trúc có ADR giải thích tại sao — đây mới là thứ nhà tuyển dụng đọc

## 2. Non-goals — những thứ KHÔNG làm

Ghi rõ ở đây để tránh scope creep. Nếu sau này muốn thêm, phải viết ADR mới.

| Không làm                                           | Lý do                                                                                                                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DRM thương mại (Widevine / FairPlay / PlayReady)    | Cần license từ Google/Apple, chi phí và thủ tục không phù hợp dự án học tập. Thay bằng **signed URL + AES-128 HLS encryption**                                                                  |
| Tích hợp payment gateway thật (Stripe, VNPay, MoMo) | Đều cần đăng ký tài khoản/pháp nhân. Thay bằng **mock payment provider tự viết** — vẫn học đủ webhook, idempotency, subscription state machine. Xem [ADR-009](adr/009-mock-payment-provider.md) |
| **Bất kỳ dịch vụ nào phải trả tiền**                | Ràng buộc cứng của dự án: tổng chi phí vận hành = **0đ**. Xem [ADR-008](adr/008-zero-cost-infrastructure.md)                                                                                    |
| Nội dung có bản quyền                               | Chỉ dùng video public domain / Creative Commons / tự quay. Xem mục 5                                                                                                                            |
| Microservices                                       | Monolith modular (NestJS modules) + 1 worker tách riêng. Microservices ở quy mô này chỉ tạo overhead                                                                                            |
| Native mobile app                                   | Web responsive + PWA                                                                                                                                                                            |
| Live streaming (RTMP)                               | Chỉ VOD. Live là một bài toán khác hoàn toàn                                                                                                                                                    |
| Recommendation bằng ML                              | Dùng rule-based + collaborative filtering đơn giản. Xem [ADR-005](adr/005-recommendation-approach.md)                                                                                           |
| Multi-region / CDN thật                             | Chạy single region. MinIO đóng vai origin, có thể gắn Cloudflare phía trước nếu deploy                                                                                                          |

## 3. Đối tượng người dùng

| Role          | Mô tả            | Quyền chính                                                            |
| ------------- | ---------------- | ---------------------------------------------------------------------- |
| **Guest**     | Chưa đăng nhập   | Xem trang chủ, trailer, search catalog                                 |
| **User**      | Đã đăng ký       | Tạo tối đa 5 profile, xem phim, watchlist, Watch Party                 |
| **Moderator** | Quản lý nội dung | CRUD catalog, upload video, duyệt review                               |
| **Admin**     | Toàn quyền       | Mọi thứ của Moderator + quản lý user, xem analytics, cấu hình hệ thống |

## 4. Ràng buộc kỹ thuật

- **Ngôn ngữ**: TypeScript toàn bộ (strict mode, `noUncheckedIndexedAccess`)
- **Node**: >= 22 LTS
- **Package manager**: pnpm (workspaces)
- **Môi trường phát triển**: chạy được hoàn toàn local bằng `docker compose up`
- **Chi phí = 0đ**, không ngoại lệ. Mọi dịch vụ bên ngoài phải: miễn phí vĩnh viễn (không phải trial), **không yêu cầu thẻ tín dụng**, và có đường thay thế self-hosted nếu họ đổi chính sách. Dịch vụ nào không thỏa → tự host hoặc tự viết mock
- **Browser target**: Chrome/Edge/Firefox 2 version gần nhất, Safari 17+
- **Dung lượng**: giả định thư viện demo ~50 phim, ~200GB sau transcode

## 5. Pháp lý & nội dung

Dự án **không** phân phối nội dung có bản quyền. Nguồn video dùng để demo:

- Blender Open Movies (Big Buck Bunny, Sintel, Tears of Steel — CC-BY)
- Internet Archive public domain films
- Video tự quay / tự tạo

Metadata (poster, mô tả, cast) có thể lấy từ TMDB API cho mục đích demo, tuân thủ [TMDB terms of use](https://www.themoviedb.org/api-terms-of-use) — bắt buộc hiển thị attribution.

## 6. Định nghĩa thành công

Dự án coi là thành công khi:

- [ ] Upload 1 file MP4 → tự động ra 4 bitrate HLS → phát được, tự đổi chất lượng khi bóp băng thông
- [ ] Đăng nhập bằng Google, access token hết hạn sau 15 phút và tự refresh không làm gián đoạn việc xem
- [ ] 2 tab browser khác nhau xem cùng 1 phim trong Watch Party, play/pause/seek đồng bộ dưới 500ms
- [ ] Xem dở phim ở máy A, mở máy B thấy "Continue watching" đúng vị trí
- [ ] `pnpm test` xanh, coverage backend >= 70%
- [ ] README đủ để một người lạ clone về chạy được trong 10 phút

## 7. Thuật ngữ

| Thuật ngữ     | Nghĩa trong dự án                                                  |
| ------------- | ------------------------------------------------------------------ |
| **Title**     | Một tác phẩm — có thể là Movie hoặc Series                         |
| **Episode**   | Một tập, chỉ thuộc về Series                                       |
| **Playable**  | Đơn vị có thể phát được: một Movie hoặc một Episode                |
| **Asset**     | File video gốc + các bản transcode của một Playable                |
| **Rendition** | Một bản transcode ở một bitrate/resolution cụ thể (vd 1080p@5Mbps) |
| **Profile**   | Hồ sơ xem trong một tài khoản (giống Netflix profile)              |
| **Progress**  | Vị trí đang xem của một Profile trên một Playable                  |

---

**Tiếp theo**: [01 — Product Requirements](01-product-requirements.md)
