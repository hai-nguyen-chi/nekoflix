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
   MongoDB (8 DB độc lập) · Redis · MinIO · Jaeger
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
| —      | [ADR](docs/adr/)                                                          | 12 Architecture Decision Records                |

> Mới bắt đầu? Đọc theo thứ tự: [00](docs/00-overview.md) → [02](docs/02-architecture.md) → [13](docs/13-service-catalog.md) → [14](docs/14-inter-service-communication.md).

## Tech Stack

**Frontend**: React 19, TypeScript, Vite, TanStack Query, Zustand, Tailwind CSS, hls.js, socket.io-client
**Backend**: NestJS 11 × 9 service, Mongoose, Passport, BullMQ, socket.io, Zod
**Giao tiếp**: NATS JetStream (event + request/reply), Transactional Outbox, Saga
**Data**: MongoDB 7 (replica set, 8 database độc lập), Redis 7
**Media**: FFmpeg, MinIO (S3-compatible), HLS (fMP4, AES-128)
**Observability**: OpenTelemetry + Jaeger, pino, Prometheus
**Infra**: Docker Compose, GitHub Actions, pnpm workspaces + Turborepo
**Deploy (0đ)**: Cloudflare Pages + Cloudflare Tunnel · tùy chọn Oracle Cloud Always Free

## Bắt đầu

> **Mới vào dự án?** Đọc [GETTING-STARTED.md](GETTING-STARTED.md) — hướng dẫn từng bước từ số 0, kể cả cài Docker.
>
> **Đã cài xong, cần tra lệnh?** [COMMANDS.md](COMMANDS.md) — sổ tay lệnh + xử lý lỗi.

Xem [docs/10-devops-setup.md](docs/10-devops-setup.md).

```bash
pnpm install
pnpm infra:up               # mongo, redis, nats, minio, jaeger
pnpm db:migrate && pnpm db:seed

pnpm dev                    # tất cả service
pnpm dev:auth               # hoặc chỉ gateway + identity + web
```

Không cần chạy cả 15 container mỗi lần — xem [compose profiles](docs/10-devops-setup.md#31-chạy-một-phần-hệ-thống).

## Trạng thái

🟢 **Phase 0 xong** — nền móng phân tán chạy được end-to-end. Xem [PHASE-0.md](PHASE-0.md).
⬜ Phase 1 (identity-service) — tiếp theo. Xem [Roadmap](docs/11-roadmap.md).

```
pnpm typecheck   7/7 xanh
pnpm test        22/22 xanh  (gồm transaction thật trên MongoDB replica set)
pnpm smoke       kiểm chứng HTTP -> NATS -> outbox -> JetStream -> consumer
```
