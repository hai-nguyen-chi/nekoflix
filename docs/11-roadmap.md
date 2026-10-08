# 11 — Roadmap

Chia thành **9 phase**, mỗi phase là một mốc **người dùng làm được thêm việc gì**.
Trong mỗi phase, đơn vị công việc là **feature** — mỗi feature là **một nhánh, một PR**.

Ước lượng cho **một người part-time ~15h/tuần**. Full-time thì chia đôi.

> **Đổi so với bản trước**: phase từng được chia theo **service** ("Phase 3 —
> media-service + activity-service"). Cách đó khớp với kiến trúc nhưng không khớp
> với cách làm việc: một phase 4 tuần không tách thành nhánh được, và tên phase
> không cho biết người dùng được gì.
>
> Giờ phase đặt tên theo **việc người dùng làm được**, và bên trong là bảng feature
> đã chia sẵn thành nhánh. Tổng thời gian không đổi (~20 tuần).

---

## Cách đọc bảng feature

| Cột          | Nghĩa                                                             |
| ------------ | ----------------------------------------------------------------- |
| **#**        | Mã feature. Dùng trong commit message: `feat(catalog): ... (2.3)` |
| **Nhánh**    | Tên nhánh cắt từ `develop` — xem [17 §1](17-git-workflow.md)      |
| **Làm gì**   | Phạm vi. Ngoài phạm vi là PR khác                                 |
| **Xong khi** | Điều kiện kiểm chứng được, không phải cảm tính                    |

### Ba quy tắc

**1. Một feature ≤ 3 ngày.** Quá 3 ngày thì nhánh sống lâu, lệch xa `develop`, và PR
to tới mức không ai review nổi — kể cả chính mình một tháng sau. Lớn hơn thì chẻ đôi.

**2. Mỗi feature phải để `develop` ở trạng thái chạy được.** Merge xong,
`pnpm ci:local` phải xanh và `pnpm dev:auth` phải lên. Không merge nửa vời rồi "PR
sau sửa nốt".

**3. Ưu tiên lát cắt dọc.** Một feature đi từ contract → service → gateway → giao
diện thì demo được ngay. Cột **Loại** đánh dấu:

| Ký hiệu | Nghĩa                                            |
| ------- | ------------------------------------------------ |
| 🟩      | Lát cắt dọc — xong là nhìn thấy trên giao diện   |
| 🟦      | Hạ tầng — không nhìn thấy, nhưng feature sau cần |
| 🟨      | Chỉ frontend                                     |

---

## ✅ Phase 0 — Nền móng phân tán (3 tuần) — XONG

NATS JetStream, Transactional Outbox, idempotency, trace xuyên service, service-kit,
database per service.

Giàn giáo `ping-service`/`pong-service` đã bị xoá khi identity và notification thay
vào vai trò đó. Chi tiết: [PHASE-0.md](../PHASE-0.md).

---

## ✅ Phase 1 — Tài khoản (2.5 tuần) — XONG

Đăng ký, đăng nhập, refresh rotation + phát hiện token bị đánh cắp, multi-profile,
OAuth Google/GitHub, quên/đổi mật khẩu, email thật qua notification-service, giao
diện auth. Tag `v0.1.0`.

---

## Phase 2 — Duyệt phim (2.5 tuần)

**Mốc**: mở `/browse` thấy danh sách phim, bấm vào ra trang chi tiết, tìm kiếm được.

**Lần đầu**: gateway phải **ghép dữ liệu từ nhiều nguồn** và chịu được khi một nguồn
chết.

| #   | Nhánh                           | Loại | Làm gì                                                                        | Xong khi                                                   |
| --- | ------------------------------- | ---- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 2.1 | `feat/catalog-skeleton`         | 🟦   | `pnpm new:service catalog 4002`, schema `titles` `genres` `episodes` `people` | `/health/ready` trả 200, `pnpm ci:local` xanh              |
| 2.2 | `feat/catalog-contracts`        | 🟦   | RPC + event schema trong `packages/contracts`, kèm `EVENT_FIXTURES`           | contract test xanh, snapshot commit **trong cùng PR**      |
| 2.3 | `feat/catalog-read-api`         | 🟦   | `list`, `detail`, `byIds` (batch), `episodes`                                 | gọi qua NATS trả đúng dữ liệu                              |
| 2.4 | `feat/catalog-seed`             | 🟦   | `scripts/seed/seeds/catalog.seed.ts` — 20 title + episodes                    | `pnpm db:seed` ra kết quả **tất định** trên mọi máy        |
| 2.5 | `feat/catalog-search`           | 🟦   | Text index + bỏ dấu tiếng Việt                                                | tìm `bo gia` ra `Bố Già`                                   |
| 2.6 | `feat/catalog-cache`            | 🟦   | Cache Redis + invalidate qua event `catalog.title.updated`                    | sửa title → lần gọi kế tiếp thấy ngay, không chờ TTL       |
| 2.7 | `feat/gateway-home-composition` | 🟩   | `/v1/catalog/home` ghép nhiều nguồn + circuit breaker + fallback              | **tắt catalog → gateway trả 503 có thông báo, không treo** |
| 2.8 | `feat/web-browse`               | 🟩   | Trang Browse (rows) + TitleDetail                                             | `/browse` hiện đủ row, click ra trang chi tiết             |
| 2.9 | `feat/web-search`               | 🟨   | Ô tìm kiếm + trang kết quả + trạng thái rỗng                                  | gõ không dấu vẫn ra kết quả                                |
| 2.A | `feat/catalog-admin`            | 🟩   | Admin CRUD + import TMDB                                                      | thêm title ở admin → FE thấy sau khi cache bị invalidate   |

> **2.2 trước 2.3** là có chủ đích: viết hợp đồng trước, cài sau. Làm ngược lại thì
> schema bị uốn theo cách cài đặt tình cờ.

---

## Phase 3 — Xem được phim (3 tuần) ⚠️ Phase khó nhất

**Mốc**: upload một file 1080p, vài phút sau phát được trên trình duyệt, bóp băng
thông thì tự xuống 480p.

**Lần đầu**: có **sync call giữa service** (media hỏi identity về gói cước) và phải
sống được khi bên kia chết.

| #   | Nhánh                          | Loại | Làm gì                                                                | Xong khi                                                     |
| --- | ------------------------------ | ---- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| 3.1 | `feat/media-skeleton`          | 🟦   | Service + schema `assets` `mediaKeys`                                 | `/health/ready` 200                                          |
| 3.2 | `feat/media-upload`            | 🟦   | Presigned multipart lên SeaweedFS, resume được                        | ngắt mạng giữa chừng → nối lại, không phải upload từ đầu     |
| 3.3 | `feat/media-validate`          | 🟦   | `ffprobe` + magic bytes                                               | đổi đuôi `.exe` thành `.mp4` → bị từ chối                    |
| 3.4 | `feat/transcode-worker`        | 🟦   | BullMQ job + FFmpeg HLS **một rendition**, retry, idempotent, SIGTERM | upload → ra 1 playlist phát được bằng `ffplay`               |
| 3.5 | `feat/transcode-abr`           | 🟦   | Multi-bitrate, keyframe thẳng hàng giữa các rendition                 | chuyển rendition không giật, không nhảy hình                 |
| 3.6 | `feat/media-encryption`        | 🟦   | AES-128 + endpoint trả key có authz                                   | lấy key không kèm token hợp lệ → 403                         |
| 3.7 | `feat/media-artifacts`         | 🟦   | Sprite seek preview, poster, phụ đề                                   | file sprite sinh ra đúng số khung                            |
| 3.8 | `feat/media-playback-token`    | 🟦   | Playback token + master playlist động theo `maxQuality`               | tài khoản gói thấp không thấy rendition 1080p trong playlist |
| 3.9 | `feat/media-subscription-sync` | 🟦   | Sync call `identity.user.subscription` + cache Redis 60s + fallback   | **tắt identity → đang xem vẫn xem tiếp được**                |
| 3.A | `feat/web-player-core`         | 🟩   | hls.js + play/pause/seek/volume/fullscreen                            | phát được phim đã transcode                                  |
| 3.B | `feat/web-player-tracks`       | 🟨   | Chọn phụ đề, chọn chất lượng, PiP, phím tắt                           | bật phụ đề tiếng Việt hiển thị đúng                          |
| 3.C | `feat/web-player-preview`      | 🟨   | Seek preview dùng sprite ở 3.7                                        | rê chuột trên thanh seek thấy thumbnail                      |
| 3.D | `feat/web-admin-upload`        | 🟩   | Giao diện upload + theo dõi tiến độ transcode                         | upload từ trình duyệt tới lúc phát được, không cần `curl`    |

> **3.4 → 3.5 → 3.6 tách rời** vì đây là chỗ hay sa lầy nhất. Phát được **một**
> rendition trước đã; ABR và mã hoá là hai bài toán khác nhau, gộp vào một nhánh thì
> hỏng không biết hỏng ở đâu.

---

## Phase 4 — Nhớ chỗ đang xem (1.5 tuần)

**Mốc**: xem dở trên máy này, mở máy khác lên đúng chỗ đó. Watchlist, đánh giá.

**Lần đầu**: có **read model** — activity giữ bản sao dữ liệu catalog để không phụ
thuộc catalog lúc đọc.

| #   | Nhánh                        | Loại | Làm gì                                                                | Xong khi                                                 |
| --- | ---------------------------- | ---- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| 4.1 | `feat/activity-skeleton`     | 🟦   | Service + schema `progress` `watchHistory` `watchlist` `ratings`      | `/health/ready` 200                                      |
| 4.2 | `feat/activity-progress`     | 🟩   | Upsert tiến độ, Continue Watching, event `progress.updated` (gộp 60s) | xem dở → máy khác mở lên đúng giây đó                    |
| 4.3 | `feat/web-progress-sync`     | 🟨   | `useProgressSync` + `sendBeacon` lúc đóng tab                         | đóng tab đột ngột vẫn lưu được vị trí                    |
| 4.4 | `feat/activity-watchlist`    | 🟩   | Watchlist + ratings                                                   | thêm vào danh sách, hiện ở trang chủ                     |
| 4.5 | `feat/activity-projections`  | 🟦   | Read model `titleProjections`, consume `catalog.title.*`              | **tắt catalog → watchlist vẫn hiện tên phim**            |
| 4.6 | `feat/activity-reconcile`    | 🟦   | Job đối soát projection với catalog                                   | sửa lệch thủ công → job chạy → tự khớp lại               |
| 4.7 | `feat/activity-stream-limit` | 🟦   | Giới hạn số luồng đồng thời (Redis sorted set + heartbeat)            | mở quá số luồng cho phép → luồng mới bị từ chối có lý do |
| 4.8 | `feat/web-player-next`       | 🟨   | Skip Intro, Next Episode                                              | hết tập tự gợi ý tập sau                                 |

---

## Phase 5 — Xem chung (2.5 tuần)

**Mốc**: hai người ở hai máy xem cùng một phim, một người tua thì người kia tua theo.

| #   | Nhánh                              | Loại | Làm gì                                               | Xong khi                                                    |
| --- | ---------------------------------- | ---- | ---------------------------------------------------- | ----------------------------------------------------------- |
| 5.1 | `feat/realtime-skeleton`           | 🟦   | Socket.IO gateway + auth handshake + `auth:refresh`  | kết nối được kèm token, token hết hạn thì refresh tại chỗ   |
| 5.2 | `feat/realtime-redis-adapter`      | 🟦   | Redis adapter                                        | **chạy 2 instance, client ở hai bên vẫn nhận tin của nhau** |
| 5.3 | `feat/watch-party-room`            | 🟩   | Tạo/vào phòng, vai trò host                          | hai tab vào cùng phòng, thấy nhau                           |
| 5.4 | `feat/watch-party-sync`            | 🟩   | Đồng bộ play/pause/seek, clock offset, chống trôi    | host seek → tab kia theo trong **< 500ms**                  |
| 5.5 | `feat/realtime-chat`               | 🟩   | Chat, reaction, rate limit                           | spam bị chặn, không sập phòng                               |
| 5.6 | `feat/watch-party-resilience`      | 🟦   | Chuyển host, reconnect grace 30s, presence           | host thoát → người khác lên thay, phòng không chết          |
| 5.7 | `feat/realtime-transcode-progress` | 🟦   | Consume `media.transcode.progress` → đẩy xuống admin | admin thấy % transcode chạy thật, không phải polling        |
| 5.8 | `feat/web-watch-party`             | 🟨   | Panel, mời, chat, banner trạng thái kết nối          | mất mạng → banner hiện, nối lại thì tự vào lại phòng        |
| 5.9 | `test/e2e-watch-party`             | 🟦   | Playwright 2 browser context                         | test chạy trong CI, không phải bấm tay                      |

---

## Phase 6 — Gói cước, gợi ý, saga (3 tuần)

**Mốc**: những thứ **chỉ tồn tại trong hệ phân tán** — một thao tác phải đúng xuyên
qua 6 service, và phải đúng cả khi service chết giữa chừng.

| #   | Nhánh                      | Loại | Làm gì                                                            | Xong khi                                                         |
| --- | -------------------------- | ---- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| 6.1 | `feat/billing-skeleton`    | 🟦   | Service + schema + mock payment provider                          | tạo subscription giả lập được                                    |
| 6.2 | `feat/billing-webhook`     | 🟦   | Webhook HMAC + idempotency                                        | gửi lại cùng webhook 3 lần → chỉ ghi nhận 1                      |
| 6.3 | `feat/notification-inapp`  | 🟩   | Thông báo trong ứng dụng (email đã xong ở Phase 1)                | chuông hiện số, bấm vào đọc được                                 |
| 6.4 | `feat/reco-content-based`  | 🟦   | Gợi ý theo nội dung + taste vector                                | người mới đăng ký cũng có gợi ý                                  |
| 6.5 | `feat/reco-collaborative`  | 🟦   | Item-item CF + cron dựng lại                                      | xem nhiều phim → gợi ý đổi theo                                  |
| 6.6 | `feat/saga-engine`         | 🟦   | Hạ tầng saga: lưu trạng thái bền vững, bước bù trừ, tiếp tục được | unit test: kill giữa chừng → khởi động lại → chạy tiếp đúng bước |
| 6.7 | `feat/saga-delete-account` | 🟩   | Xoá tài khoản — 7 bước, 6 service                                 | **xoá xong dữ liệu biến mất khỏi cả 6 service**                  |
| 6.8 | `feat/saga-upgrade-plan`   | 🟩   | Nâng gói + eventual consistency tới media                         | nâng gói → **< 2 giây** chất lượng tối đa lên 1080p              |
| 6.9 | `feat/dlq-admin`           | 🟦   | Trang admin xem và replay DLQ                                     | gây lỗi cố ý → event vào DLQ → replay từ admin thành công        |
| 6.A | `feat/identity-2fa`        | 🟩   | 2FA TOTP                                                          | bật 2FA, đăng nhập phải nhập mã                                  |

> **6.6 tách riêng khỏi 6.7** vì saga engine là hạ tầng dùng lại được, còn "xoá tài
> khoản" là một ca cụ thể. Gộp vào một nhánh thì engine bị uốn cong theo đúng ca đó.

---

## Phase 7 — Hoàn thiện & vận hành (2.5 tuần)

**Mốc**: chạy trên domain công khai, có dashboard, có alert, chi phí vẫn 0đ.

| #   | Nhánh                           | Loại | Làm gì                                              | Xong khi                                                  |
| --- | ------------------------------- | ---- | --------------------------------------------------- | --------------------------------------------------------- |
| 7.1 | `feat/observability-dashboards` | 🟦   | Grafana + Prometheus, dashboard mỗi service         | nhìn một màn hình biết service nào đang ốm                |
| 7.2 | `feat/observability-alerts`     | 🟦   | Alert `outbox_pending_count` và DLQ                 | tắt relay → alert kêu trong vòng 2 phút                   |
| 7.3 | `test/chaos`                    | 🟦   | Tắt từng service, ghi lại hệ thống xuống cấp ra sao | có **tài liệu** mô tả từng trường hợp, không phải trí nhớ |
| 7.4 | `feat/i18n`                     | 🟨   | Tiếng Việt + tiếng Anh                              | đổi ngôn ngữ không phải tải lại trang                     |
| 7.5 | `feat/a11y`                     | 🟨   | Điều hướng bàn phím, ARIA, tương phản               | dùng được toàn bộ luồng chính chỉ bằng bàn phím           |
| 7.6 | `feat/perf-budget`              | 🟨   | Bundle < 250KB, LCP < 2.5s                          | Lighthouse **≥ 90**                                       |
| 7.7 | `feat/pwa`                      | 🟨   | Service worker, cài được lên màn hình chính         | cài vào điện thoại, mở offline thấy trang chờ tử tế       |
| 7.8 | `chore/deploy-cloudflare`       | 🟦   | Cloudflare Pages + Tunnel, domain `is-a.dev`        | người lạ mở được link, chi phí **0đ**                     |
| 7.9 | `docs/readme-demo`              | 🟦   | Sơ đồ kiến trúc, ảnh chụp, GIF demo                 | người chưa biết dự án đọc README hiểu nó làm gì           |

---

## Phase 8 — Mở rộng (tuỳ chọn)

Không có ước lượng — làm khi muốn học thêm.

| Nhánh                     | Làm gì                                           |
| ------------------------- | ------------------------------------------------ |
| `feat/k3s`                | k3s thay Docker Compose — service mesh, HPA      |
| `feat/kong-gateway`       | API Gateway thật thay gateway tự viết            |
| `feat/grpc-hot-path`      | gRPC cho đường sync nóng nhất, đo và so với NATS |
| `feat/event-sourcing`     | Event sourcing cho `activity-service`            |
| `feat/meilisearch`        | Meilisearch thay text index của MongoDB          |
| `feat/offline-download`   | Tải về xem offline                               |
| `feat/chromecast`         | Chromecast, giao diện TV                         |
| `feat/parallel-transcode` | Transcode song song theo chunk                   |

---

## Tổng kết

| Phase | Nội dung              | Feature | Tuần | Tích lũy |
| ----- | --------------------- | ------- | ---- | -------- |
| 0 ✅  | Nền móng phân tán     | —       | 3    | 3        |
| 1 ✅  | Tài khoản             | —       | 2.5  | 5.5      |
| 2     | Duyệt phim            | 10      | 2.5  | 8        |
| 3     | Xem được phim         | 13      | 3    | 11       |
| 4     | Nhớ chỗ đang xem      | 8       | 1.5  | 12.5     |
| 5     | Xem chung             | 9       | 2.5  | 15       |
| 6     | Gói cước, gợi ý, saga | 10      | 3    | 18       |
| 7     | Hoàn thiện & vận hành | 9       | 2.5  | **20.5** |

**59 feature còn lại**, trung bình **~1.7 ngày/feature** ở nhịp 15h/tuần.

Demo được cho người ngoài từ **cuối Phase 3** (tuần 11) — sớm hơn một tuần so với bản
cũ, vì phần "nhớ chỗ đang xem" được tách ra khỏi khối media 4 tuần.

### Vì sao chia nhỏ không làm chậm đi

Số tuần không đổi. Cái đổi là **kích thước một lần merge**:

|                        | Bản cũ               | Bản này            |
| ---------------------- | -------------------- | ------------------ |
| Đơn vị công việc       | 1 phase = 2.5–4 tuần | 1 feature ≤ 3 ngày |
| Một PR                 | hàng nghìn dòng      | vài trăm dòng      |
| Nhánh sống bao lâu     | hàng tuần            | vài ngày           |
| CI bắt lỗi sau bao lâu | cuối phase           | sau mỗi feature    |

Nhánh sống càng lâu càng lệch xa `develop`, và công sức xử lý xung đột lúc merge tăng
nhanh hơn nhiều so với độ dài nhánh.

---

## Rủi ro

| Rủi ro                                       | Mức         | Cách giảm                                                                                                                                                                    |
| -------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Distributed monolith** — cắt ranh giới sai | **Rất cao** | Kiểm tra [ma trận phụ thuộc](13-service-catalog.md#ma-trận-phụ-thuộc) cuối mỗi phase. Thấy số sync call tăng → dừng, gộp service. **Gộp sớm rẻ hơn nhiều so với sống chung** |
| Phase 3 kéo dài gấp đôi                      | Cao         | Thứ tự 3.4 → 3.5 → 3.6 là bắt buộc: phát được **một** rendition trước, rồi mới ABR, rồi mới mã hoá                                                                           |
| Feature phình to quá 3 ngày                  | Cao         | Thấy nhánh sang ngày thứ tư → dừng, tách phần chưa xong sang nhánh khác, merge phần đã chạy được                                                                             |
| Debug mò vì thiếu tracing                    | Cao         | Đã xử ở Phase 0. Mỗi service mới phải vào Jaeger kiểm trace liền mạch trước khi đóng feature skeleton                                                                        |
| Lỗi âm thầm: outbox relay chết               | Trung bình  | Metric `outbox_pending_count` + alert (7.2)                                                                                                                                  |
| Máy không đủ RAM                             | Trung bình  | [Compose profile](10-devops-setup.md#31-chạy-một-phần-hệ-thống), chỉ chạy service đang làm                                                                                   |
| Scope creep                                  | Cao         | [00 — Non-goals](00-overview.md#2-non-goals--những-thứ-không-làm). Muốn thêm gì phải viết ADR                                                                                |

### Dấu hiệu phải dừng lại và gộp service

Kiểm tra cuối mỗi phase. Dính từ 2 dấu hiệu trở lên thì **gộp trước khi đi tiếp**:

- Sửa một tính năng phải deploy > 2 service
- Một request đi qua > 2 hop sync
- Hai service luôn deploy cùng nhau
- Một service chỉ toàn CRUD, không có logic riêng
- Read model phình to gần bằng bản gốc
- Phải viết saga cho một thao tác chạy hàng ngày

---

**Tiếp theo**: [12 — Testing Strategy](12-testing-strategy.md) · [17 — Quy trình Git](17-git-workflow.md)
