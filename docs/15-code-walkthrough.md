# 15 — Đọc hiểu code

Tài liệu này giải thích **file nào làm gì** và **ai gọi ai**. Dành cho người mới vào dự án.

Các tài liệu khác mô tả _thiết kế_; tài liệu này mô tả _code thật đang có_.

---

## 1. Bản đồ tổng thể

```
nekoflix/
├── apps/              ← CHƯƠNG TRÌNH chạy được (mỗi cái một process riêng)
├── packages/          ← THƯ VIỆN dùng chung (không chạy một mình được)
├── infra/             ← Cấu hình Docker: MongoDB, NATS, ...
├── scripts/           ← Công cụ chạy tay: seed, smoke test, scaffold
└── docs/              ← Tài liệu
```

Phân biệt quan trọng nhất:

|               | `apps/`             | `packages/`         |
| ------------- | ------------------- | ------------------- |
| Là gì         | Process chạy được   | Thư viện            |
| Chạy bằng     | `node dist/main.js` | không chạy riêng    |
| Có `main.ts`? | Có                  | Không               |
| Deploy ra     | Một container       | Gộp vào app dùng nó |

---

## 2. Từng thư mục

### `apps/gateway` — cửa vào duy nhất

Nhận HTTP từ trình duyệt, chuyển xuống service phía sau qua NATS.

| File                                       | Việc                                        |
| ------------------------------------------ | ------------------------------------------- |
| `src/main.ts`                              | Điểm khởi động. Gọi `createService()`       |
| `src/app.module.ts`                        | Khai báo gateway có những gì                |
| `src/ping/ping.controller.ts`              | Các route HTTP `/v1/ping/*`                 |
| `src/health/gateway-health.controller.ts`  | `/health/live`, `/health/ready`, `/metrics` |
| `src/common/request-context.middleware.ts` | Gắn `requestId` + `traceId` cho mỗi request |

**Gateway không có database và không chứa logic nghiệp vụ.** Mỗi khi định viết `if` nghiệp vụ ở đây, hãy hỏi: logic này thuộc service nào?

### `apps/ping-service` — service mẫu (bên PHÁT event)

| File                          | Việc                                                      |
| ----------------------------- | --------------------------------------------------------- |
| `src/main.ts`                 | Khởi động                                                 |
| `src/app.module.ts`           | Bật `outbox: true` vì service này phát event              |
| `src/echo/echo.controller.ts` | Nhận lệnh từ NATS (`@MessagePattern`)                     |
| `src/echo/echo.service.ts`    | **Logic nghiệp vụ** — ghi DB + outbox trong 1 transaction |
| `src/echo/echo.schema.ts`     | Hình dạng dữ liệu trong MongoDB                           |

### `apps/pong-service` — service mẫu (bên NGHE event)

| File                                  | Việc                                                |
| ------------------------------------- | --------------------------------------------------- |
| `src/app.module.ts`                   | Bật `consumeEvents: true` vì service này nghe event |
| `src/received/echo.handlers.ts`       | **Xử lý event** (`@OnEvent`)                        |
| `src/received/received.controller.ts` | API đọc dữ liệu đã nhận                             |
| `src/received/received.schema.ts`     | Hình dạng dữ liệu                                   |

> `ping-service` và `pong-service` là **giàn giáo tạm**, sẽ xoá ở Phase 1. Chúng tồn tại để chứng minh đường dây đúng trước khi có nghiệp vụ thật.

### `packages/contracts` — bản hợp đồng

Nơi khai báo **mọi thứ đi qua lại giữa các service**. Cả bên gửi lẫn bên nhận đều import từ đây, nên không thể lệch nhau mà TypeScript không báo.

| File                  | Việc                                                   |
| --------------------- | ------------------------------------------------------ |
| `src/envelope.ts`     | Khung chung của mọi event (`id`, `type`, `traceId`...) |
| `src/events/ping.ts`  | Hình dạng dữ liệu của event `ping.echo.created`        |
| `src/events/index.ts` | **`EVENT_REGISTRY`** — danh bạ mọi event               |
| `src/rpc/ping.ts`     | Hình dạng request/response                             |
| `src/rpc/index.ts`    | **`RPC_REGISTRY`** — danh bạ mọi lệnh gọi              |
| `src/errors.ts`       | Mã lỗi (`NOT_FOUND`, `VALIDATION_FAILED`...)           |

Nhờ hai "danh bạ" này, gõ sai tên lệnh là **lỗi lúc build**, không phải lỗi lúc chạy:

```ts
rpc.request('ping.echo.create', { message: 'hi' }); // ✅
rpc.request('ping.echo.craete', { message: 'hi' }); // ❌ TypeScript báo ngay
```

### `packages/service-kit` — bộ khung dùng chung

Phần quan trọng nhất của dự án. Mọi service đều dựa vào đây.

| Thư mục                  | Giải quyết vấn đề gì                                                       |
| ------------------------ | -------------------------------------------------------------------------- |
| `bootstrap.ts`           | Khởi động service: nạp `.env`, bật tracing, kết nối NATS, bắt tín hiệu tắt |
| `service-kit.module.ts`  | Lắp ráp: service này cần outbox không? nghe event không?                   |
| `config/load-env.ts`     | Tìm và nạp file `.env` ở thư mục gốc                                       |
| `outbox/`                | **Ghi DB và phát event phải cùng sống hoặc cùng chết**                     |
| `idempotency/`           | **Event đến 2 lần không được xử lý 2 lần**                                 |
| `events/`                | Nhận event từ NATS, bọc idempotency, thử lại khi lỗi                       |
| `rpc/`                   | Gọi service khác: timeout, circuit breaker, bắt lỗi                        |
| `nats/`                  | Kết nối NATS JetStream                                                     |
| `observability/`         | Log, số đo, trace                                                          |
| `health/`                | `/health/live`, `/health/ready`, `/metrics`                                |
| `infra/index-guard.ts`   | Báo động khi MongoDB tạo index thất bại                                    |
| `validation/zod.pipe.ts` | Kiểm tra dữ liệu gửi lên có đúng hợp đồng không                            |

### `infra/` — cấu hình Docker

| File                      | Việc                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `docker-compose.yml`      | **Khai báo 7 container**: MongoDB, Redis, NATS, SeaweedFS, Jaeger, Mailpit, Mongo Express |
| `mongo/init-users.js`     | Tạo 10 tài khoản DB, mỗi cái chỉ vào được 1 database                                      |
| `nats/nats.conf`          | Cấu hình NATS JetStream                                                                   |
| `storage/s3.json`         | Tài khoản truy cập kho file                                                               |
| `storage/init-buckets.sh` | Tạo 3 bucket chứa video/ảnh                                                               |

### `scripts/` — công cụ chạy tay

| File                    | Lệnh                            |
| ----------------------- | ------------------------------- |
| `seed/index.ts`         | `pnpm db:seed`                  |
| `db-sync.ts`            | `pnpm db:export` / `db:import`  |
| `smoke-test.ts`         | `pnpm smoke`                    |
| `verify-idempotency.ts` | `pnpm verify:idempotency`       |
| `new-service.ts`        | `pnpm new:service <tên> <cổng>` |
| `gen-secrets.ts`        | `pnpm gen:secrets`              |

### File ở thư mục gốc

| File                  | Việc                                                  |
| --------------------- | ----------------------------------------------------- |
| `package.json`        | Danh sách lệnh `pnpm ...` và thư viện                 |
| `pnpm-workspace.yaml` | Báo pnpm biết `apps/*` và `packages/*` là các gói con |
| `turbo.json`          | Thứ tự build: `packages/` xong mới tới `apps/`        |
| `eslint.config.mjs`   | Quy tắc code + **rào chắn kiến trúc**                 |
| `.env.example`        | Mẫu cấu hình — copy thành `.env`                      |
| `.gitignore`          | File không đưa lên Git                                |
| `.gitattributes`      | Chuẩn hoá xuống dòng (LF)                             |

---

## 3. Flow 1 — Service khởi động như thế nào

Chạy `node apps/ping-service/dist/main.js`:

```
main.ts
  │  createService({ name, moduleFactory, healthPort })
  ▼
service-kit/bootstrap.ts
  │
  ├─1─ loadEnv()                      config/load-env.ts
  │    → đi ngược lên tìm .env ở thư mục gốc, nạp vào process.env
  │
  ├─2─ createRootLogger()             observability/logger.ts
  │
  ├─3─ startTelemetry()               observability/telemetry.ts
  │    → BẮT BUỘC chạy TRƯỚC bước 4
  │
  ├─4─ await moduleFactory()          ← mới import app.module.ts ở ĐÂY
  │    │
  │    └─ app.module.ts
  │         └─ ServiceKitModule.forRoot({ database, outbox, consumeEvents })
  │              ├─ kết nối MongoDB         (dựng chuỗi kết nối từ `database`)
  │              ├─ kết nối NATS            nats/nats.connection.ts
  │              ├─ nếu outbox:true         → OutboxService + OutboxRelay
  │              ├─ nếu consumeEvents:true  → IdempotencyService + JetStreamConsumer
  │              └─ IndexGuard, HealthController
  │
  ├─5─ gắn bộ lọc lỗi + interceptor
  ├─6─ startAllMicroservices()        → bắt đầu nghe lệnh từ NATS
  ├─7─ listen(healthPort)             → mở cổng HTTP cho /health, /metrics
  └─8─ bắt SIGTERM/SIGINT             → tắt êm: dừng relay, drain NATS, đóng Mongo
```

### Vì sao bước 4 phải là dynamic import

Đây là chỗ dễ làm sai nhất.

OpenTelemetry (công cụ tracing) hoạt động bằng cách **vá** thư viện `mongoose` và `http` **lúc chúng được nạp**. Nếu `app.module.ts` được `import` ở đầu file `main.ts`, thì `mongoose` đã nằm trong bộ nhớ đệm của Node **trước khi** OpenTelemetry kịp khởi động — và nó sẽ không vá được nữa.

Hậu quả: trace mất hẳn phần database, **im lặng, không báo lỗi gì**. Mở Jaeger thấy trace nhưng thiếu các bước truy vấn DB.

Vì vậy `createService` nhận một **hàm** trả về module, không nhận thẳng module:

```ts
// ❌ SAI — mongoose bị nạp trước khi telemetry chạy
import { AppModule } from './app.module';
createService({ module: AppModule });

// ✅ ĐÚNG — chỉ nạp app.module SAU khi telemetry đã khởi động
createService({ moduleFactory: async () => (await import('./app.module')).AppModule });
```

---

## 4. Flow 2 — Một request HTTP đi qua đâu

Ví dụ: `curl -X POST localhost:4000/v1/ping/echo -d '{"message":"hello"}'`

```
TRÌNH DUYỆT / curl
  │ HTTP POST
  ▼
┌─ GATEWAY (process 1, cổng 4000) ────────────────────────┐
│                                                          │
│  common/request-context.middleware.ts                    │
│    → sinh requestId, lưu vào AsyncLocalStorage            │
│      (nhờ đó mọi dòng log sau này tự có requestId)        │
│         │                                                 │
│         ▼                                                 │
│  ping/ping.controller.ts  @Post('echo')                   │
│    → zodPipe(createEchoRequest) kiểm tra dữ liệu          │
│       Sai hình dạng → trả 400 NGAY, không gọi xuống dưới  │
│         │                                                 │
│         ▼                                                 │
│  service-kit/rpc/rpc-client.ts      request(...)           │
│    ├─ circuit-breaker.ts  — service kia đang hỏng?         │
│    ├─ rpc-payload.ts      — gói thêm requestId + traceparent│
│    └─ gửi qua NATS, chờ tối đa 2 giây                     │
└──────────────────────────┬───────────────────────────────┘
                           │ NATS  "ping.echo.create"
                           ▼
┌─ PING-SERVICE (process 2) ───────────────────────────────┐
│                                                           │
│  service-kit/rpc/rpc-context.interceptor.ts               │
│    → khôi phục requestId + traceId của bên gọi            │
│         │                                                  │
│         ▼                                                  │
│  echo/echo.controller.ts  @MessagePattern('ping.echo.create')│
│    → chỉ parse dữ liệu rồi gọi xuống, KHÔNG có logic       │
│         │                                                  │
│         ▼                                                  │
│  echo/echo.service.ts      ← LOGIC NGHIỆP VỤ Ở ĐÂY        │
│    │                                                       │
│    └─ outbox.withTransaction(async (session) => {          │
│         ① ghi vào bảng `echoes`          (dùng session)    │
│         ② ghi vào bảng `outbox`          (dùng session)    │
│       })                                                   │
│       ↑ MỘT transaction — cùng thành công hoặc cùng huỷ    │
└───────────────────────────────────────────────────────────┘
                           │ trả kết quả ngược lên
                           ▼
                   HTTP 201 về trình duyệt
```

**Điểm then chốt:** bước ① và ② nằm trong **một transaction**. Nếu máy sập giữa hai bước, cả hai cùng bị huỷ — không bao giờ có chuyện dữ liệu đã lưu mà thông báo không được gửi.

---

## 5. Flow 3 — Event đi từ service này sang service kia

Tiếp nối flow trên. Dữ liệu đã nằm trong bảng `outbox`, nhưng **chưa ai biết**.

```
┌─ PING-SERVICE ───────────────────────────────────────────┐
│  outbox/outbox.relay.ts                                   │
│    chạy nền, cứ 1 giây một lần:                          │
│      ① tìm bản ghi status='pending'                       │
│      ② đánh dấu 'publishing' (để 2 relay không giành nhau)│
│      ③ gửi lên NATS JetStream                             │
│      ④ đánh dấu 'published'                               │
│                                                            │
│    Gửi lỗi? → trả về 'pending', lát sau thử lại.          │
│    Event KHÔNG BAO GIỜ mất.                               │
└────────────────────────┬─────────────────────────────────┘
                         │ NATS JetStream  (lưu bền 7 ngày)
                         │ "nekoflix.events.ping.echo.created"
                         ▼
┌─ PONG-SERVICE ───────────────────────────────────────────┐
│  events/jetstream.consumer.ts                             │
│    ① tìm hàm có @OnEvent('ping.echo.created')             │
│    ② khôi phục traceId (nối trace xuyên service)          │
│    ③ gọi idempotency.runOnce(...)                         │
│         │                                                  │
│         ├─ GHI `processedEvents` TRƯỚC                     │
│         │    Trùng khoá → event này xử lý rồi → bỏ qua    │
│         │                                                  │
│         └─ rồi mới gọi handler:                           │
│              received/echo.handlers.ts                     │
│                → ghi vào bảng `received`                  │
│            (cả hai trong MỘT transaction)                 │
│                                                            │
│    ④ thành công → ack (báo NATS đã xong)                  │
│       thất bại  → thử lại 1s, 5s, 25s, 125s               │
│                   quá 5 lần → đẩy sang DLQ                │
└───────────────────────────────────────────────────────────┘
```

### Vì sao phải ghi `processedEvents` TRƯỚC khi xử lý

NATS cam kết "giao **ít nhất** một lần" — tức là **sẽ có lúc giao 2 lần** (khi service chết giữa chừng, khi quá hạn ack...).

Nếu làm theo thứ tự tự nhiên:

```
1. kiểm tra đã xử lý chưa?   → chưa
2. xử lý                      ← hai bản sao chạy song song đều lọt vào đây
3. ghi là đã xử lý
```

Hai bản sao cùng chạy sẽ **lọt cả hai** qua khe hở giữa bước 1 và 2.

Cách đúng: **ghi trước, xử lý sau, trong một transaction.** Bản sao thứ hai sẽ đụng khoá trùng ngay ở bước ghi và dừng lại.

---

## 6. Cấu hình đến từ đâu

### Thứ tự ưu tiên

```
1. Biến môi trường có sẵn      ← CAO NHẤT (Docker, CI đặt vào)
2. File .env ở thư mục gốc     ← load-env.ts nạp, KHÔNG ghi đè cái trên
3. Giá trị mặc định trong code ← ?? 'localhost:4222'
```

Quy tắc `override: false` quan trọng: trên CI, biến môi trường do GitHub Actions đặt **luôn thắng** `.env`.

### Chuỗi kết nối MongoDB được dựng ra sao

Trong `service-kit.module.ts`, hàm `buildMongoUri('nekoflix_ping')`:

```
Có MONGO_URI?  →  dùng luôn (dành cho Atlas / production)
Không          →  tự ghép:

   nekoflix_ping  →  bỏ tiền tố  →  ping  →  user: ping_svc
                                                 │
   mongodb://ping_svc:devpassword@localhost:27017/nekoflix_ping
            ?replicaSet=rs0&directConnection=true&authSource=admin
```

Mỗi service dùng **tài khoản riêng chỉ vào được database của mình**. `ping_svc` đọc `nekoflix_pong` sẽ bị MongoDB từ chối. Đó là chủ đích — xem [ADR-012](adr/012-database-per-service.md).

### Biến môi trường ai dùng

| Biến                                                | Dùng ở                                                 |
| --------------------------------------------------- | ------------------------------------------------------ |
| `MONGO_HOST`, `MONGO_ROOT_*`, `SERVICE_DB_PASSWORD` | `service-kit.module.ts`, scripts                       |
| `NATS_URL`                                          | `nats/nats.connection.ts`, `service-kit.module.ts`     |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`                | `observability/telemetry.ts` — **trống = tắt tracing** |
| `LOG_LEVEL`                                         | `observability/logger.ts`                              |
| `PORT`                                              | `main.ts` của từng app                                 |
| `WEB_ORIGIN`                                        | `gateway/src/main.ts` (CORS)                           |

---

## 7. Ai được import ai

```
apps/gateway  ─┐
apps/ping     ─┼─→  @nekoflix/service-kit  ─→  @nekoflix/contracts
apps/pong     ─┘                           ─→  (nestjs, mongoose, nats)

❌ apps/ping  ──X──  apps/pong        (service KHÔNG import service)
❌ service-kit ──X──  apps/*          (thư viện KHÔNG biết app nào dùng mình)
```

Quy tắc 1 được **ESLint chặn thật**, không phải chỉ ghi trong tài liệu:

```bash
$ pnpm lint
'../../ping-service/src/echo/echo.service' import is restricted.
Service không được import service khác. Dùng RpcClient (sync) hoặc @OnEvent (async)
```

Thử nghiệm được: tạo một file trong `apps/gateway/src/` import từ `apps/ping-service/`, chạy `pnpm lint` sẽ thấy báo lỗi.

### Phân lớp bên trong một service

```
controller  →  chỉ nhận/trả dữ liệu. KHÔNG logic.
service     →  LOGIC NGHIỆP VỤ nằm ở đây.
schema      →  hình dạng dữ liệu trong MongoDB.
handlers    →  xử lý event đến.
```

Dấu hiệu sai: thấy `if` nghiệp vụ trong controller, hoặc thấy controller gọi thẳng MongoDB.

---

## 8. Thứ tự build

`turbo.json` quy định `packages/` phải build xong mới tới `apps/`:

```
contracts  →  service-kit  →  gateway, ping-service, pong-service
                                  (3 cái này build song song)
```

Vì `service-kit` import `contracts`, và các app import cả hai. Sửa code trong `contracts` mà chưa build lại thì app vẫn dùng bản cũ trong `dist/` — nên khi thấy "sửa rồi mà không ăn", chạy `pnpm build`.

---

## 9. Muốn hiểu sâu thì đọc theo thứ tự này

Đọc theo **đường đi của một request**, không đọc theo thư mục:

```
1. apps/gateway/src/main.ts                      ← bắt đầu
2. packages/service-kit/src/bootstrap.ts         ← khởi động làm gì
3. apps/gateway/src/ping/ping.controller.ts      ← nhận HTTP
4. packages/service-kit/src/rpc/rpc-client.ts    ← gọi service khác
5. apps/ping-service/src/echo/echo.controller.ts ← nhận lệnh
6. apps/ping-service/src/echo/echo.service.ts    ← ⭐ logic + outbox
7. packages/service-kit/src/outbox/outbox.relay.ts       ← phát event
8. packages/service-kit/src/events/jetstream.consumer.ts ← nhận event
9. apps/pong-service/src/received/echo.handlers.ts       ← xử lý
```

File số **6** và **8** là hai file đáng đọc kỹ nhất — chúng chứa toàn bộ cái khó của kiến trúc này.

Mỗi file đều có comment tiếng Việt giải thích **vì sao** làm vậy, không chỉ làm gì.

---

**Liên quan**: [02 — Kiến trúc](02-architecture.md) · [14 — Giao tiếp giữa service](14-inter-service-communication.md) · [COMMANDS.md](../COMMANDS.md)
