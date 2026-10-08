# Nekoflix

Nền tảng xem phim streaming self-hosted, lấy cảm hứng từ Netflix.
Dự án portfolio: full-stack TypeScript, video pipeline thật (FFmpeg → HLS), realtime, OAuth.

> **Chi phí vận hành: 0đ.** Mọi thành phần đều self-host hoặc dùng gói miễn phí vĩnh viễn không cần thẻ tín dụng. Xem [ADR-008](docs/adr/008-zero-cost-infrastructure.md).

Kiến trúc **microservices, event-driven** — 9 service NestJS giao tiếp qua NATS JetStream.

```
React 19 + Vite
      │ HTTP / WSS
      ▼
┌─────────────┐
│ api-gateway │  authN · rate limit · API composition · circuit breaker
└──┬───┬───┬──┘
   │   │   │        NATS request/reply
   ▼   ▼   ▼
┌──────────┐ ┌─────────┐ ┌───────┐ ┌──────────┐ ┌──────────┐
│ identity │ │ catalog │ │ media │ │ activity │ │ realtime │  + billing
└────┬─────┘ └────┬────┘ └───┬───┘ └────┬─────┘ └────┬─────┘  + notification
     │            │          │          │            │        + recommendation
     └────────────┴─────┬────┴──────────┴────────────┘
                        ▼
              ┌───────────────────┐
              │  NATS JetStream   │  event bus (at-least-once)
              └───────────────────┘
                        │
   MongoDB (DB riêng mỗi service) · Redis · SeaweedFS · Jaeger
```

Mỗi service sở hữu database riêng, không ai đọc DB của ai. Ghi DB + phát event qua **Transactional Outbox**.

## Tài liệu

| #      | Tài liệu                                                                  | Nội dung                                        |
| ------ | ------------------------------------------------------------------------- | ----------------------------------------------- |
| 00     | [Tổng quan & Scope](docs/00-overview.md)                                  | Mục tiêu, phạm vi, cái gì KHÔNG làm             |
| 01     | [Product Requirements](docs/01-product-requirements.md)                   | Feature list, user stories, acceptance criteria |
| 02     | [System Architecture](docs/02-architecture.md)                            | Kiến trúc microservices, data flow, chịu lỗi    |
| 03     | [Database Schema](docs/03-database-schema.md)                             | Sở hữu dữ liệu theo service, collections, index |
| 04     | [API Specification](docs/04-api-specification.md)                         | REST endpoints qua gateway, error codes         |
| 05     | [Authentication & Authorization](docs/05-authentication.md)               | JWT rotation, OAuth2, authN xuyên service       |
| 06     | [Realtime / WebSocket](docs/06-realtime-websocket.md)                     | Watch Party, presence, Socket.IO scale          |
| 07     | [Video Pipeline](docs/07-video-pipeline.md)                               | Upload → transcode → HLS → signed playback      |
| 08     | [Frontend Architecture](docs/08-frontend-architecture.md)                 | React structure, state, player, routing         |
| 09     | [Project Structure](docs/09-project-structure.md)                         | Monorepo 9 service, service-kit, convention     |
| 10     | [Local Setup & DevOps](docs/10-devops-setup.md)                           | Docker Compose, chạy một phần hệ thống, CI/CD   |
| 11     | [Roadmap](docs/11-roadmap.md)                                             | 7 phase ~20 tuần, definition of done            |
| 12     | [Testing Strategy](docs/12-testing-strategy.md)                           | Unit / contract / integration / e2e             |
| **13** | [**Service Catalog**](docs/13-service-catalog.md)                         | Từng service: trách nhiệm, dữ liệu, API, event  |
| **14** | [**Inter-service Communication**](docs/14-inter-service-communication.md) | Outbox, idempotency, saga, DLQ, contract test   |
| **15** | [**Đọc hiểu code**](docs/15-code-walkthrough.md)                          | File nào làm gì, ai gọi ai, config từ đâu       |
| **16** | [**Cấu hình OAuth**](docs/16-oauth-setup.md)                              | Lấy credential Google/GitHub, luồng PKCE        |
| **17** | [**Quy trình Git**](docs/17-git-workflow.md)                              | Ba nhánh môi trường, PR, hotfix, phát hành      |
| —      | [ADR](docs/adr/)                                                          | 15 Architecture Decision Records                |

> **Mới bắt đầu?** Chạy được rồi thì đọc [15 — Đọc hiểu code](docs/15-code-walkthrough.md) trước.
> Muốn hiểu thiết kế: [00](docs/00-overview.md) → [02](docs/02-architecture.md) → [13](docs/13-service-catalog.md) → [14](docs/14-inter-service-communication.md).

## Tech Stack

**Frontend**: React 19, TypeScript, Vite, TanStack Query, Zustand, Tailwind CSS, hls.js, socket.io-client
**Backend**: NestJS 11 × 9 service, Mongoose, Passport, BullMQ, socket.io, Zod
**Giao tiếp**: NATS JetStream (event + request/reply), Transactional Outbox, Saga
**Data**: MongoDB 7 (replica set, 8 database độc lập), Redis 7
**Media**: FFmpeg, SeaweedFS (S3-compatible), HLS (fMP4, AES-128)
**Observability**: OpenTelemetry + Jaeger, pino, Prometheus
**Infra**: Docker Compose, GitHub Actions, pnpm workspaces + Turborepo
**Deploy (0đ)**: Cloudflare Pages + Cloudflare Tunnel · tùy chọn Oracle Cloud Always Free

## Bắt đầu

> **Chỉ cần chạy cho được?** [RUN.md](RUN.md) — setup & start từng bước, có cách kiểm tra ở mỗi bước.
>
> **Mới vào dự án, chưa có Docker?** [GETTING-STARTED.md](GETTING-STARTED.md) — từ số 0, kèm giải thích.
>
> **Cần tra một lệnh?** [COMMANDS.md](COMMANDS.md) — sổ tay lệnh + xử lý lỗi.

Xem [docs/10-devops-setup.md](docs/10-devops-setup.md).

```bash
pnpm install
cp .env.example .env
pnpm gen:secrets            # sinh khoá RSA ký JWT — thiếu bước này identity không start
pnpm infra:up               # mongo, redis, nats, storage, jaeger, mailpit
pnpm build

pnpm dev:auth               # gateway + identity + notification + web
```

Rồi mở **http://localhost:5173**. Backend mất khoảng 60 giây để compile xong —
web lên trước nên đừng vội kết luận là hỏng.

Cửa sổ thứ hai: `pnpm smoke` để kiểm chứng toàn bộ đường dây.

## Trạng thái

🟢 **Phase 0 xong** — nền móng phân tán. Giàn giáo `ping/pong` đã được xoá, xem [PHASE-0.md](PHASE-0.md).
🟢 **Phase 1 xong** — identity-service (auth, multi-profile, OAuth, quên mật khẩu), notification-service, frontend.
⬜ Phase 2 (catalog-service) — tiếp theo. Xem [Roadmap](docs/11-roadmap.md).

```
pnpm build               6/6 xanh
pnpm lint                6/6 xanh    (rào chắn kiến trúc, đã kiểm chứng chặn thật)
pnpm typecheck           8/8 xanh
pnpm test                163 xanh    (gồm contract test producer + consumer)
pnpm smoke               31/31 đạt   (hạ tầng Docker thật)
pnpm verify:idempotency  đạt
Jaeger                   trace liền mạch qua 3 service
```
