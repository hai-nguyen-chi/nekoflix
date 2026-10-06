# Phase 0 — Nền móng phân tán

> **Tài liệu lịch sử.** Phase 0 đã xong và `ping-service`/`pong-service` — giàn
> giáo dùng để chứng minh đường dây — **đã bị xoá ở Phase 1**, khi
> identity-service và notification-service thay vào đúng vai trò đó.
>
> Các lệnh `pnpm dev:ping`, `curl /v1/ping/*` bên dưới không còn chạy được. Giữ
> file này vì phần giải thích _vì sao_ vẫn đúng nguyên: outbox, idempotency, trace
> xuyên service là nền của mọi service sau. Để chạy thử hôm nay, dùng
> [COMMANDS.md](COMMANDS.md).

Trạng thái: **đã implement và CHẠY THẬT**. Toàn bộ definition of done đã kiểm chứng trên máy.

```
pnpm build              5/5 xanh
pnpm lint               5/5 xanh    (rào chắn kiến trúc đã kiểm chứng là CHẶN thật)
pnpm typecheck          7/7 xanh
pnpm test               22/22 xanh  (transaction thật trên MongoDB replica set)
pnpm smoke              10/10 đạt   (hạ tầng Docker thật)
pnpm verify:idempotency ĐẠT         (gửi lại event 3 lần -> không nhân bản)
Jaeger                  trace LIỀN MẠCH qua 3 service — đã xác minh
```

Phase này không ra tính năng nào cho người dùng. Nó dựng đường dây mà **mọi service sau đều đi qua** — làm ẩu ở đây thì 17 tuần sau trả giá gấp nhiều lần.

---

## 1. Chạy thử

```bash
pnpm install
cp .env.example .env

pnpm infra:up          # mongo (replica set), redis, nats, storage, jaeger, mailpit
pnpm build
pnpm dev:ping          # gateway + ping-service + pong-service

# Cửa sổ khác:
pnpm smoke             # kiểm chứng definition of done
```

| Dịch vụ                       | URL                                |
| ----------------------------- | ---------------------------------- |
| Gateway                       | http://localhost:4000              |
| ping-service (health/metrics) | http://localhost:4101/health/ready |
| pong-service                  | http://localhost:4102/health/ready |
| **Jaeger**                    | http://localhost:16686             |
| NATS monitoring               | http://localhost:8222              |
| Mongo Express                 | http://localhost:8081              |
| SeaweedFS Filer               | http://localhost:9001              |
| Mailpit                       | http://localhost:8025              |

### Thử bằng tay

```bash
# HTTP -> NATS request/reply
curl -X POST localhost:4000/v1/ping \
  -H 'Content-Type: application/json' -d '{"message":"xin chào"}'

# Ghi DB + outbox trong 1 transaction -> relay publish -> pong nhận
curl -X POST localhost:4000/v1/ping/echo \
  -H 'Content-Type: application/json' -d '{"message":"hello"}'

curl localhost:4000/v1/ping/received     # đầu kia của đường dây

# Rollback: lỗi sau khi ghi -> KHÔNG để lại event mồ côi
curl -X POST localhost:4000/v1/ping/echo \
  -H 'Content-Type: application/json' \
  -d '{"message":"rollback","failAfterWrite":true}'

# Composition 2 service + fallback khi một bên chết
curl localhost:4000/v1/ping/status
```

---

## 2. Đã xây gì

### `packages/contracts`

Nguồn sự thật cho mọi giao tiếp. `EVENT_REGISTRY` và `RPC_REGISTRY` map tên → Zod schema, nên gọi sai subject hoặc sai payload là **lỗi compile-time**.

### `packages/service-kit`

Hạ tầng dùng chung — phần đáng đầu tư nhất khi làm microservices một mình.

| Thành phần                      | Giải quyết vấn đề gì                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `createService()`               | Bootstrap thống nhất: NATS, OTel, graceful shutdown           |
| `OutboxService` + `OutboxRelay` | **Dual write**: ghi DB và phát event phải nguyên tử           |
| `IdempotencyService`            | JetStream giao at-least-once → event **sẽ** đến hai lần       |
| `JetStreamConsumer`             | Khám phá `@OnEvent`, bọc idempotency, nak/DLQ                 |
| `RpcClient`                     | Request/reply typed + timeout + circuit breaker + fallback    |
| `CircuitBreaker`                | Chặn sập lan truyền khi một service **chậm** (không cần chết) |
| `AllExceptionsFilter`           | Một hình dạng lỗi cho cả HTTP lẫn RPC                         |
| Telemetry / logger / metrics    | Trace liền mạch, log có `requestId`, `outbox_pending_count`   |

### `apps/gateway`

Biên hệ thống. **Không có database, không có business logic.** Có `/v1/ping/status` làm ví dụ API composition: gọi 2 service song song, một thiết yếu một không.

### `apps/ping-service` · `apps/pong-service`

Walking skeleton — **sẽ xóa ở Phase 1**. Tồn tại để chứng minh đường dây đúng trước khi có nghiệp vụ thật: ping phát event, pong tiêu thụ.

---

## 3. Kiểm chứng

```bash
pnpm lint                # rào chắn kiến trúc
pnpm typecheck
pnpm test                # không cần hạ tầng
pnpm smoke               # cần hạ tầng + service đang chạy
pnpm verify:idempotency  # cần hạ tầng + service đang chạy
```

### Rào chắn kiến trúc — đã kiểm chứng

Thử import chéo service, ESLint chặn thật:

```
'../../ping-service/src/echo/echo.service' import is restricted.
Service không được import service khác. Dùng RpcClient (sync) hoặc @OnEvent (async)
```

Đây là khác biệt giữa "ranh giới trên giấy" và "ranh giới không lách được".

Test tích hợp chạy trên **MongoDB replica set thật** (`mongodb-memory-server`), không phải mock — vì toàn bộ giá trị của outbox nằm ở transaction, mà standalone MongoDB không có transaction. Test trên standalone sẽ "xanh" vì không có gì chạy cả.

Những gì đã verify:

| Test                               | Chứng minh                                                 |
| ---------------------------------- | ---------------------------------------------------------- |
| outbox: ghi chung transaction      | Dữ liệu + event cùng commit                                |
| outbox: rollback                   | Lỗi sau khi ghi → **không có event mồ côi**                |
| outbox: claim song song            | 2 relay không giành cùng một event                         |
| outbox: thu hồi bản ghi kẹt        | Relay chết giữa chừng vẫn hồi được                         |
| idempotency: giao lại              | Tác dụng phụ chỉ chạy một lần                              |
| **idempotency: song song**         | Bắt lỗi `findOne`-rồi-`insert` mà test tuần tự luôn bỏ lọt |
| **redelivery trên hệ thống thật**  | Gửi lại cùng event 3 lần qua JetStream -> 0 bản ghi mới    |
| **consumer chết, event không mất** | Tắt pong-service, gửi 3 event, bật lại -> nhận đủ          |
| idempotency: handler lỗi           | Rollback cả `processedEvents` → giao lại vẫn xử lý được    |
| out-of-order                       | Event cũ không ghi đè dữ liệu mới                          |
| circuit breaker (10 ca)            | Mở/half-open/đóng, chặn thật, chỉ 1 request thử            |

### Việc PHẢI tự kiểm tra bằng mắt

Smoke test không kiểm được tracing. Mở http://localhost:16686, chọn service `gateway`, xem trace gần nhất:

```
gateway  POST /v1/ping/echo
 └─ rpc ping.echo.create          (ping-service)
     └─ mongodb insert
         └─ event ping.echo.created   (pong-service)
             └─ mongodb insert
```

**Phải là MỘT trace liền mạch.** Nếu Jaeger hiện nhiều trace rời rạc, trace context đang đứt — sửa xong mới được sang Phase 1.

---

## 4. Những chỗ lệch so với tài liệu thiết kế

Ghi lại để tài liệu và code không nói hai chuyện khác nhau.

| Tài liệu nói                                                       | Code làm                                                  | Vì sao                                                                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Ngữ cảnh đi qua NATS **header** ([02 §5](docs/02-architecture.md)) | Nhúng vào **payload** (`RpcPayload.meta`)                 | Transporter NATS của NestJS không expose header per-request. Hiệu quả tương đương                                     |
| `createService({ module })` ([09](docs/09-project-structure.md))   | `createService({ moduleFactory })`                        | OTel vá module lúc `require`. Import AppModule trước khi SDK start → mất hẳn trace tầng DB, **im lặng**               |
| Một kết nối NATS                                                   | **Hai** — Nest transporter (RPC) + raw client (JetStream) | Transporter của Nest chỉ dùng NATS core, pub/sub **không bền bỉ**. Event mất khi consumer restart thì outbox vô nghĩa |
| `@Prop()` suy type từ TypeScript                                   | `@Prop({ type: String, ... })` tường minh                 | Vitest dùng esbuild, không emit decorator metadata. Tường minh cũng dễ đọc hơn                                        |
| Node >= 22                                                         | Chạy được trên **Node 20.11+**                            | Máy dev hiện tại là Node 20. CI vẫn dùng 22                                                                           |

---

## 5. Bước tiếp theo — Phase 1 (đã xong)

Theo [roadmap](docs/11-roadmap.md): `identity-service` (~2.5 tuần).

```bash
# 1. Xóa walking skeleton  — ĐÃ LÀM
rm -rf apps/ping-service apps/pong-service
#    + xóa 'ping'/'pong' khỏi infra/mongo/init-users.js
#    + xóa events/ping.ts, rpc/ping.ts khỏi packages/contracts
#    + xóa apps/gateway/src/ping/

# 2. Tạo identity-service theo đúng khuôn đó  — ĐÃ LÀM
```

Checklist Phase 1:

- [x] Schema `users`, `profiles`, `sessions`, `verificationTokens`
- [x] argon2id + register + email verify
- [x] Access token RS256 + refresh cookie
- [x] **Refresh rotation + reuse detection + grace period** ← phần khó nhất
- [x] OAuth Google/GitHub (PKCE + exchange code)
- [x] Multi-profile, PIN, kids mode
- [x] Gateway verify JWT một lần, gắn claim vào `RpcPayload.meta`
- [x] Event: `user.registered`, `user.logged_in`, `profile.created`, `security.alert`
- [x] Contract test cho mọi event — producer, consumer, và snapshot tương thích ngược

Một thay đổi so với kế hoạch: `identity-service` có thêm tầng `application/` mà
`ping-service` không có. Logic auth phải mở transaction trải qua nhiều
collection nên buộc phải biết Mongoose, trong khi `domain/` không được biết —
ESLint chặn thật. Xem [docs/09](docs/09-project-structure.md).

**Trước khi sang Phase 2**, kiểm tra [ma trận phụ thuộc](docs/13-service-catalog.md#ma-trận-phụ-thuộc): nếu số lời gọi sync tăng ngoài dự kiến, ranh giới service đang sai — gộp lại trước khi đi tiếp.
