# 11 — Roadmap

Chia thành 7 phase. Mỗi phase có **definition of done** rõ ràng — không sang phase sau khi chưa xong phase trước.

Ước lượng cho **một người part-time ~15h/tuần**. Full-time thì chia đôi.

> **Thay đổi so với bản trước**: kiến trúc chuyển sang microservices ([ADR-010](adr/010-microservices.md)), tổng thời gian từ ~12 tuần lên **~19 tuần**. Phần tăng nằm ở Phase 0 (hạ tầng giao tiếp) và ở chi phí cố định mỗi tính năng xuyên service.

---

## Phase 0 — Nền móng phân tán (3 tuần) ⚠️ Phase quyết định

**Mục tiêu**: hai service nói chuyện được với nhau qua NATS, có outbox, có trace xuyên service.

Đây là phase đắt nhất và dễ nản nhất — ba tuần mà chưa ra tính năng nào cho người dùng. Nhưng làm ẩu ở đây thì 16 tuần sau trả giá gấp nhiều lần.

- [ ] Monorepo pnpm + Turborepo, cấu trúc `apps/*` + `packages/*`
- [ ] `docker-compose.yml`: Mongo (replica set), Redis, **NATS JetStream**, MinIO, Jaeger
- [ ] `init-users.js` tạo 8 DB user phân quyền riêng
- [ ] **`packages/service-kit`** — phần quan trọng nhất của phase này:
  - [ ] `createService()` bootstrap: NATS transport, graceful shutdown
  - [ ] OutboxModule + OutboxService + OutboxRelay (polling)
  - [ ] ProcessedEvents + decorator `@Idempotent`
  - [ ] NATS client typed, có timeout + circuit breaker
  - [ ] pino + OpenTelemetry + prom-client cấu hình sẵn
  - [ ] `/health/live`, `/health/ready`
- [ ] `packages/contracts` — Zod schema cho event envelope + vài event đầu
- [ ] **`gateway` + một cặp service giả (`ping-service`/`pong-service`)** chạy thông suốt
- [ ] Trace một request đi từ browser → gateway → ping-service → event → consumer, **nhìn thấy đủ trên Jaeger**
- [ ] `scripts/new-service.ts` — scaffold service mới
- [ ] CI: lint, typecheck, test xanh

**Done khi**:

- `curl /v1/ping` → gateway → NATS → ping-service → trả lời
- Ping-service ghi DB + outbox trong một transaction → relay publish → consumer nhận → thấy trong `processedEvents`
- **Jaeger hiện một trace liền mạch qua cả 3 chặng** (HTTP → NATS request → NATS event)
- Kill consumer giữa chừng, bật lại → event được giao lại, không xử lý hai lần

> Nếu cuối tuần 3 mà trace chưa liền mạch, **dừng lại sửa cho xong**. Thiếu tracing trong hệ 9 service là mù hoàn toàn.

> **Đã xong.** `ping-service` và `pong-service` là giàn giáo tạm, đã bị xoá khi
> identity-service và notification-service thay thế vai trò của chúng ở Phase 1.
> `pnpm smoke` và `pnpm verify:idempotency` giờ kiểm chứng đúng những điều trên,
> nhưng trên luồng nghiệp vụ thật.

---

## Phase 1 — identity-service (2.5 tuần)

- [ ] Schema `users`, `profiles`, `sessions`, `verificationTokens`
- [ ] Register + argon2id + email verify
- [ ] Login + access token RS256 + refresh cookie
- [ ] **Refresh rotation + reuse detection + grace period**
- [ ] Session management, logout, logout-all
- [ ] Forgot/reset password
- [ ] OAuth Google + GitHub (PKCE + exchange code)
- [ ] Multi-profile, giới hạn 5, PIN, kids mode
- [ ] **Gateway**: verify JWT một lần, gắn claim vào NATS header
- [ ] Event: `user.registered`, `user.logged_in`, `profile.created`, `security.alert`
- [ ] FE: login/register/verify/forgot, profile select, `authStore`, refresh queue
- [ ] Contract test cho mọi event identity phát ra

**Done khi**:

- Login → 16 phút sau thao tác tiếp → tự refresh, không bị đá ra
- Reuse detection hoạt động, cả family bị revoke
- OAuth Google đăng nhập được
- Event `user.registered` nằm trong JetStream, xem được bằng `nats stream view`

---

## Phase 2 — catalog-service + composition (2.5 tuần)

**Mục tiêu**: duyệt phim được, và **lần đầu phải ghép dữ liệu từ 2 service**.

- [ ] Schema `titles`, `episodes`, `genres`, `people`
- [ ] API: list, detail, byIds (batch), search, rows, episodes
- [ ] Search text index + bỏ dấu tiếng Việt
- [ ] Cache Redis + invalidate qua event `title.updated`
- [ ] Admin CRUD + import TMDB
- [ ] **Gateway composition cho `/catalog/home`** — ghép catalog + (sau này) activity
- [ ] **Circuit breaker + fallback** cho mọi lời gọi từ gateway
- [ ] Seed 20 title
- [ ] FE: Browse, TitleDetail, Search
- [ ] Contract test

**Done khi**:

- `/browse` hiện đủ row, click ra trang chi tiết
- **Tắt `catalog-service` → gateway trả 503 có thông báo rõ ràng, không treo 30 giây**
- Sửa title ở admin → cache bị xóa qua event, FE thấy ngay

---

## Phase 3 — media-service + activity-service (4 tuần) ⚠️ Phase khó nhất

**Mục tiêu**: upload → phát được; và **lần đầu có sync call giữa service với fallback**.

### media-service + transcode-worker

- [ ] Schema `assets`, `mediaKeys`
- [ ] Presigned multipart upload, resume được
- [ ] ffprobe + magic bytes validate
- [ ] FFmpeg HLS multi-bitrate, keyframe thẳng hàng
- [ ] AES-128 + key endpoint có authz
- [ ] Sprite, poster, phụ đề
- [ ] BullMQ job, retry, idempotent, SIGTERM
- [ ] Master playlist động theo `maxQuality`
- [ ] Playback token
- [ ] **Sync call tới `identity.user.subscription` + cache Redis 60s + fallback**
- [ ] Event `asset.ready`, `asset.failed`, `transcode.progress`

### activity-service

- [ ] Schema `progress`, `watchHistory`, `watchlist`, `ratings`
- [ ] Progress upsert, continue watching
- [ ] Stream limit (Redis sorted set + heartbeat)
- [ ] **Read model `titleProjections`** — consume `catalog.title.published/updated`
- [ ] Job đối soát projection với catalog
- [ ] Event `progress.updated` (gộp 60s), `title.completed`

### Frontend

- [ ] Player tự build: hls.js, controls, phụ đề, chất lượng, PiP, phím tắt
- [ ] `useProgressSync` + sendBeacon
- [ ] Skip Intro, Next Episode, seek preview
- [ ] Admin upload UI

**Done khi**:

- Upload 1080p → vài phút sau phát được, bóp băng thông thì tự xuống 480p
- Continue Watching đúng vị trí trên thiết bị khác
- **Tắt `catalog-service` → watchlist vẫn hiện tên phim** (nhờ `titleProjections`)
- **Tắt `identity-service` → đang xem vẫn xem tiếp được** (nhờ cache subscription)
- Xóa title ở catalog → event → activity tự dọn watchlist trỏ tới nó

---

## Phase 4 — realtime-service (2.5 tuần)

- [ ] Socket.IO gateway + auth handshake + `auth:refresh`
- [ ] **Redis adapter** — test được với 2 instance
- [ ] Watch Party: room, sync, clock offset, drift correction
- [ ] Chat, reaction, rate limit
- [ ] Chuyển host, reconnect grace 30s
- [ ] Presence
- [ ] Consume `media.transcode.progress` → đẩy xuống admin
- [ ] Sync call `identity.profile.verifyOwnership`, `media.playback.authorize`
- [ ] FE: WatchPartyPanel, invite, chat, banner kết nối
- [ ] E2E Playwright 2 browser context

**Done khi**: 2 tab join cùng room, host seek → tab kia theo trong < 500ms; chạy 2 instance realtime-service, client ở hai instance khác nhau vẫn sync được.

---

## Phase 5 — Saga & 3 service còn lại (3 tuần)

**Mục tiêu**: những thứ chỉ tồn tại trong hệ phân tán.

- [ ] **`billing-service`** + mock payment provider + webhook HMAC + idempotency
- [ ] **`notification-service`** — consumer thuần, email + in-app
- [ ] **`recommendation-service`** — content-based + item-item CF + cron
- [ ] **Saga orchestration: xóa tài khoản** (7 bước, 6 service, có bước bù trừ)
  - [ ] Lưu trạng thái saga bền vững
  - [ ] Tiếp tục được saga dở dang sau khi restart
- [ ] **Saga: nâng gói** + eventual consistency tới media
- [ ] Choreography: đăng ký → tạo subscription free + email + taste vector
- [ ] **DLQ + trang admin xem/replay**
- [ ] 2FA TOTP
- [ ] Cron mô phỏng vòng đời subscription

**Done khi**:

- Xóa tài khoản → dữ liệu biến mất khỏi cả 6 service
- **Kill service giữa chừng saga → bật lại → saga tự chạy tiếp từ bước dang dở**
- Nâng gói → trong < 2 giây chất lượng tối đa lên 1080p
- Gây lỗi cố ý → event vào DLQ → replay từ admin UI thành công

---

## Phase 6 — Hoàn thiện & vận hành (2.5 tuần)

- [ ] Grafana + Prometheus: dashboard cho mỗi service
- [ ] **Alert `outbox_pending_count` và DLQ** — hai chỉ số báo hỏng âm thầm
- [ ] Contract test đầy đủ + kiểm tra tương thích ngược ở CI
- [ ] Chaos test thủ công: tắt từng service, ghi lại hệ thống hỏng ra sao
- [ ] i18n vi + en
- [ ] Accessibility pass
- [ ] Hiệu năng: bundle < 250KB, LCP < 2.5s
- [ ] PWA
- [ ] Deploy: Cloudflare Pages + Tunnel, domain `is-a.dev` ([ADR-008](adr/008-zero-cost-infrastructure.md))
- [ ] README: sơ đồ kiến trúc, screenshot, GIF demo

**Done khi**: Lighthouse >= 90; app chạy trên domain công khai; **có tài liệu ghi rõ tắt từng service thì hệ thống xuống cấp thế nào**; chi phí vẫn 0đ.

---

## Phase 7 — Mở rộng (tùy chọn)

- [ ] **k3s** thay Docker Compose (Oracle Always Free chạy được) — học service mesh, HPA
- [ ] API Gateway thật (Kong / Traefik) thay gateway tự viết
- [ ] gRPC cho đường sync nóng nhất, so sánh với NATS
- [ ] Event sourcing cho `activity-service`
- [ ] Meilisearch thay text index
- [ ] Download offline, Chromecast, giao diện TV
- [ ] Transcode song song theo chunk

---

## Tổng kết

| Phase | Nội dung                      | Tuần | Tích lũy |
| ----- | ----------------------------- | ---- | -------- |
| 0     | Nền móng phân tán             | 3    | 3        |
| 1     | identity-service              | 2.5  | 5.5      |
| 2     | catalog-service + composition | 2.5  | 8        |
| 3     | media + activity              | 4    | 12       |
| 4     | realtime                      | 2.5  | 14.5     |
| 5     | Saga + 3 service              | 3    | 17.5     |
| 6     | Hoàn thiện & vận hành         | 2.5  | **20**   |

**~20 tuần part-time**, so với ~12 tuần nếu làm monolith. Demo được từ cuối Phase 3 (tuần 12).

### So sánh với bản monolith

|                         | Monolith | Microservices | Chênh       |
| ----------------------- | -------- | ------------- | ----------- |
| Nền móng                | 1 tuần   | 3 tuần        | +2          |
| Auth                    | 2        | 2.5           | +0.5        |
| Catalog                 | 2        | 2.5           | +0.5        |
| Video                   | 3        | 4             | +1          |
| Realtime                | 2        | 2.5           | +0.5        |
| Saga/billing/notif/reco | 2        | 3             | +1          |
| Hoàn thiện              | 2        | 2.5           | +0.5        |
| **Tổng**                | **12**   | **20**        | **+8 tuần** |

8 tuần là giá của việc học kiến trúc phân tán trên một dự án thật. Đó là lựa chọn có ý thức, không phải chi phí phát sinh.

---

## Rủi ro

| Rủi ro                                       | Mức         | Cách giảm                                                                                                                                                                    |
| -------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Distributed monolith** — cắt ranh giới sai | **Rất cao** | Kiểm tra [ma trận phụ thuộc](13-service-catalog.md#ma-trận-phụ-thuộc) cuối mỗi phase. Thấy số sync call tăng → dừng, gộp service. **Gộp sớm rẻ hơn nhiều so với sống chung** |
| Nản ở Phase 0 — 3 tuần không ra tính năng    | **Rất cao** | Chấp nhận trước. Mốc tạo động lực: cuối tuần 3 nhìn thấy trace liền mạch trên Jaeger — đó là thành quả thật, dù không demo được cho người ngoài                              |
| Phase 3 kéo dài gấp đôi                      | Cao         | FFmpeg + sync call + read model cùng lúc. Làm tuần tự: phát được 1 rendition → ABR → encryption → mới tới read model                                                         |
| Debug mò vì thiếu tracing                    | Cao         | Phase 0 không được bỏ qua OpenTelemetry. Đây là lý do nó nằm ở Phase 0 chứ không phải Phase 6                                                                                |
| Lỗi âm thầm: outbox relay chết               | Trung bình  | Metric `outbox_pending_count` + alert, làm ngay từ Phase 0                                                                                                                   |
| Máy không đủ RAM                             | Trung bình  | Dùng [compose profile](10-devops-setup.md#31-chạy-một-phần-hệ-thống), chỉ chạy service đang làm                                                                              |
| Scope creep                                  | Cao         | [00 — Non-goals](00-overview.md#2-non-goals--những-thứ-không-làm). Muốn thêm gì phải viết ADR                                                                                |

### Dấu hiệu phải dừng lại và gộp service

Kiểm tra cuối mỗi phase. Nếu dính từ 2 dấu hiệu trở lên, **gộp trước khi đi tiếp**:

- Sửa một tính năng phải deploy > 2 service
- Một request đi qua > 2 hop sync
- Hai service luôn deploy cùng nhau
- Một service chỉ toàn CRUD, không có logic riêng
- Read model phình to gần bằng bản gốc
- Phải viết saga cho một thao tác chạy hàng ngày

---

**Tiếp theo**: [12 — Testing Strategy](12-testing-strategy.md)
