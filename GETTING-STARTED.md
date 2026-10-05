# Bắt đầu từ số 0

Hướng dẫn cho người chưa quen Docker/microservices. Làm theo đúng thứ tự, mỗi bước đều có cách kiểm tra "đã đúng chưa".

---

## Phần 1 — Cần cài gì

Máy bạn **đã có**:

| Công cụ       | Phiên bản  | Dùng để                         |
| ------------- | ---------- | ------------------------------- |
| Node.js       | 20.12.2 ✅ | Chạy code JavaScript/TypeScript |
| pnpm          | 9.15.0 ✅  | Quản lý thư viện                |
| WSL2 + Ubuntu | ✅         | Docker cần cái này trên Windows |
| Git           | ✅         |                                 |

Máy bạn **còn thiếu**:

| Công cụ            | Dùng để                              |
| ------------------ | ------------------------------------ |
| **Docker Desktop** | Chạy database và các dịch vụ phụ trợ |

Chỉ thiếu đúng một thứ.

### Docker là gì, tại sao cần?

Dự án cần 6 phần mềm chạy nền: MongoDB (database), Redis (bộ nhớ đệm), NATS (truyền tin giữa các service), SeaweedFS (lưu video), Jaeger (xem trace), Mailpit (nhận email thử).

Cài tay 6 cái này mất cả buổi và dễ hỏng. Docker đóng gói sẵn mỗi cái vào một "hộp" (gọi là **container**) — gõ một lệnh là cả 6 cái tự chạy, gõ lệnh khác là tự tắt sạch, không để lại rác trên máy.

---

## Phần 2 — Cài Docker Desktop

### Bước 1: Tải và cài

1. Vào https://www.docker.com/products/docker-desktop/
2. Bấm **Download for Windows (AMD64)**
3. Chạy file `Docker Desktop Installer.exe`
4. Khi hỏi, **tích chọn "Use WSL 2 instead of Hyper-V"** (máy bạn đã có WSL2 rồi)
5. Cài xong → **khởi động lại máy**

### Bước 2: Mở Docker Desktop

Mở app **Docker Desktop** từ Start Menu. Lần đầu nó hỏi đăng nhập — **bấm Skip, không cần tài khoản**.

Chờ tới khi góc dưới trái hiện chấm xanh **"Engine running"**.

> Docker Desktop **phải đang mở** thì các lệnh `docker` mới chạy được. Giống như phải mở MySQL Workbench thì mới kết nối được database vậy.

### Bước 3: Kiểm tra

Mở terminal **mới** (quan trọng — terminal cũ chưa biết Docker vừa được cài), gõ:

```bash
docker --version
```

Đúng thì ra kiểu: `Docker version 27.x.x, build ...`

```bash
docker compose version
```

Đúng thì ra: `Docker Compose version v2.x.x`

Nếu báo `command not found` → Docker Desktop chưa mở, hoặc chưa khởi động lại máy.

### Bước 4: Tài nguyên — thường KHÔNG cần làm gì

Vào Settings ⚙️ → **Resources**, bạn sẽ thấy **chỉ có "Enable Resource Saver"**, không có thanh trượt CPU/Memory.

**Đó là bình thường.** Khi Docker Desktop dùng backend WSL 2 (máy Windows có WSL2 đều vậy), tài nguyên do **WSL quản lý**, không phải Docker Desktop — nên Docker ẩn hai thanh trượt đó đi.

Mặc định WSL 2 đã cấp **50% RAM của máy + toàn bộ CPU core**. Máy 16GB → WSL được ~8GB. Dự án này cần ~2.3GB lúc rảnh, nên **mặc định là quá đủ, bỏ qua bước này**.

<details>
<summary>Chỉ khi nào máy ít RAM (&lt; 8GB) hoặc muốn giới hạn lại</summary>

Tạo file `C:\Users\<tên-bạn>\.wslconfig` (chú ý có dấu chấm đầu):

```ini
[wsl2]
memory=6GB
processors=4
swap=2GB
```

Rồi áp dụng:

```bash
wsl --shutdown
```

Mở lại Docker Desktop. Kiểm tra WSL nhận đúng chưa:

```bash
wsl -e free -h       # xem RAM
wsl -e nproc         # xem số core
```

</details>

> **"Resource Saver" là gì?** Khi không có container nào chạy, Docker tự thu hồi RAM để trả lại cho Windows. Cứ bật, có lợi — khi bạn chạy `pnpm infra:up` nó tự thoát chế độ đó.

---

## Phần 3 — Chạy lần đầu

Mở terminal tại thư mục `C:\nekoflix`.

### Bước 1: Cài thư viện

```bash
pnpm install
```

Lần đầu mất 1–2 phút. Lần sau chỉ vài giây.

<details>
<summary>Đúng thì thấy gì?</summary>

```
Done in 1m 42.4s
```

</details>

---

### Bước 2: Tạo file cấu hình

```bash
cp .env.example .env
```

File `.env` chứa thông tin kết nối (địa chỉ database, mật khẩu...). Nó **không được commit lên Git** — mỗi người một file riêng.

---

### Bước 3: Bật hạ tầng

```bash
pnpm infra:up
```

Lần đầu Docker phải **tải ~2GB image** từ mạng → mất 5–15 phút tùy mạng. Lần sau chỉ 10 giây.

<details>
<summary>Đúng thì thấy gì?</summary>

```
 ✔ Container nekoflix-mongo      Healthy
 ✔ Container nekoflix-redis      Healthy
 ✔ Container nekoflix-nats       Healthy
 ✔ Container nekoflix-storage    Healthy
 ✔ Container nekoflix-jaeger     Healthy
 ✔ Container nekoflix-mailpit    Healthy

nekoflix-mongo-init    | Đã cấu hình 10 DB user.
nekoflix-mongo-init    exited with code 0
nekoflix-storage-init  | Buckets sẵn sàng:
nekoflix-storage-init  |   nekoflix-media / nekoflix-public / nekoflix-uploads
nekoflix-storage-init  exited with code 0
```

Hai dòng `exited with code 0` là **bình thường** — đó là 2 container chỉ chạy một lần (tạo tài khoản database, tạo thư mục lưu file) rồi tự tắt. `code 0` nghĩa là thành công.
</details>

**Kiểm tra:** mở trình duyệt vào http://localhost:8222 — thấy trang NATS là hạ tầng đã chạy.

---

### Bước 4: Build code

```bash
pnpm build
```

Bước này dịch TypeScript sang JavaScript. Mất ~15 giây.

<details>
<summary>Đúng thì thấy gì?</summary>

```
 Tasks:    5 successful, 5 total
```

</details>

---

### Bước 5: Chạy 3 service

```bash
pnpm dev:ping
```

**Terminal này sẽ không trả lại con trỏ** — đó là bình thường, 3 service đang chạy trong đó. Để nguyên cửa sổ này.

<details>
<summary>Đúng thì thấy gì?</summary>

Log màu từ 3 service trộn lẫn nhau, kết thúc bằng 3 dòng kiểu:

```
INFO: gateway đã sẵn sàng          port: 4000
INFO: ping-service đã sẵn sàng     port: 4101
INFO: pong-service đã sẵn sàng     port: 4102
INFO: đã kết nối NATS JetStream
INFO: outbox relay đã khởi động
INFO: JetStream consumer đã khởi động
```

</details>

**Kiểm tra:** mở http://localhost:4000/health/ready — thấy `{"status":"ok",...}`.

---

### Bước 6: Chạy kiểm thử

Mở **terminal thứ hai** (giữ nguyên terminal đang chạy service), tại cùng thư mục:

```bash
pnpm smoke
```

<details>
<summary>Đúng thì thấy gì?</summary>

```
Nekoflix — smoke test Phase 0 (http://localhost:4000)

1. Health check
  gateway /health/live ... OK
  gateway /health/ready (NATS đã kết nối) ... OK

2. HTTP -> NATS request/reply -> ping-service
  POST /v1/ping trả lời từ ping-service ... OK
  requestId được truyền xuống service ... OK
  validate payload sai -> 400 VALIDATION_FAILED ... OK

3. Outbox -> JetStream -> pong-service
  echo đã ghi vào ping-service ... OK
  event tới pong-service qua JetStream (<15s) ... OK

4. Transaction rollback
  lỗi sau khi ghi -> rollback CẢ dữ liệu lẫn outbox ... OK
  không có event mồ côi tới pong-service ... OK

5. API composition ở gateway
  GET /v1/ping/status ghép 2 service ... OK

────────────────────────────────────────────────────
  10 đạt, 0 thất bại

  Phase 0 ĐẠT.
```

</details>

---

### Bước 7: Xem trace (việc cuối cùng)

Smoke test không kiểm được phần này, phải nhìn bằng mắt.

1. Mở http://localhost:16686 (Jaeger)
2. Ô **Service** chọn `gateway`
3. Bấm **Find Traces**
4. Bấm vào trace trên cùng

**Phải thấy MỘT khối liền mạch** như thế này:

```
gateway  POST /v1/ping/echo                              45.3ms
 └─ rpc ping.echo.create                                 43.0ms
     ├─ [ping-service] mongoose.Echo.save                10.9ms   ← dữ liệu
     ├─ [ping-service] mongoose.OutboxEvent.save          3.9ms   ← event, CÙNG transaction
     └─ [pong-service] event ping.echo.created           33.4ms   ← qua JetStream
         ├─ mongoose.ProcessedEvent.save                 13.6ms   ← chống xử lý 2 lần
         └─ mongoose.Received.save                        4.4ms
```

Nếu thay vào đó bạn thấy **nhiều trace rời rạc** → trace context bị đứt, cần sửa trước khi làm tiếp.

> **Tại sao quan trọng?** Hệ thống này có 9 service (hiện mới 3). Khi một request lỗi, nó đã đi qua 4–5 service rồi. Không có trace liền mạch thì gần như không thể tìm ra chỗ hỏng.

---

## Phần 4 — Bạn vừa chạy cái gì?

```
   Bạn gõ curl / mở trình duyệt
            │
            ▼
   ┌─────────────────┐
   │    gateway      │  cổng vào duy nhất (port 4000)
   │                 │  không có database, không chứa nghiệp vụ
   └────────┬────────┘
            │ gửi tin qua NATS
            ▼
   ┌─────────────────┐
   │  ping-service   │  ghi vào database của RIÊNG nó
   │                 │  + ghi "thư báo" vào bảng outbox
   └────────┬────────┘     (cả hai trong 1 transaction)
            │
            │ outbox relay đọc bảng outbox mỗi giây
            │ rồi gửi lên NATS JetStream
            ▼
   ┌─────────────────┐
   │  pong-service   │  nhận tin, ghi vào database RIÊNG của nó
   └─────────────────┘
```

### Ba ý tưởng cốt lõi

**1. Mỗi service có database riêng, không ai đọc của ai.**

`ping-service` dùng database `nekoflix_ping`, `pong-service` dùng `nekoflix_pong`. Mỗi service có tài khoản MongoDB riêng chỉ mở được database của mình — đọc nhầm là lỗi ngay, không phải chuyện "nhớ đừng làm".

**2. Muốn báo tin cho service khác thì gửi "event", không gọi thẳng.**

`ping-service` không biết `pong-service` tồn tại. Nó chỉ nói "tôi vừa tạo echo" lên NATS. Ai quan tâm thì nghe. Nhờ vậy tắt `pong-service` đi thì `ping-service` vẫn chạy bình thường.

**3. Outbox — chỗ dễ sai nhất.**

Nếu viết kiểu thông thường:

```
ghi vào database        ← xong
gửi tin lên NATS        ← máy sập ở đây!
```

Dữ liệu đã lưu nhưng tin không bao giờ được gửi. `pong-service` không bao giờ biết. **Và không có lỗi nào được báo ra** — hệ thống cứ thế lệch dần.

Cách làm đúng: ghi dữ liệu **và** ghi "thư cần gửi" vào cùng một bảng, trong **cùng một transaction**. Hai cái cùng thành công hoặc cùng thất bại. Rồi một tiến trình riêng (`outbox relay`) đọc bảng đó và gửi đi.

Đây chính là cái mà smoke test bước 4 kiểm tra.

---

## Phần 5 — Nghịch thử để hiểu

Giữ `pnpm dev:ping` chạy, mở terminal thứ hai.

### Thử 1: Gửi một tin

```bash
curl -X POST localhost:4000/v1/ping/echo \
  -H "Content-Type: application/json" \
  -d '{"message":"thu nghiem"}'
```

Rồi xem bên nhận:

```bash
curl localhost:4000/v1/ping/received
```

Thấy `thu nghiem` xuất hiện → tin đã đi hết đường dây.

### Thử 2: Xem outbox hoạt động

Mở http://localhost:8081 (Mongo Express) → chọn database `nekoflix_ping` → bảng `outbox`.

Bạn sẽ thấy các bản ghi với `status: "published"` — đó là những "lá thư" đã được gửi đi.

### Thử 3: Chứng minh rollback đúng

```bash
curl -X POST localhost:4000/v1/ping/echo \
  -H "Content-Type: application/json" \
  -d '{"message":"se-bi-huy","failAfterWrite":true}'
```

Lệnh này cố ý gây lỗi **sau khi** đã ghi database + outbox. Trả về lỗi 500.

Giờ kiểm tra:

```bash
curl localhost:4000/v1/ping/echo       # không có "se-bi-huy"
curl localhost:4000/v1/ping/received   # cũng không có
```

Cả hai đều trống → transaction đã hủy sạch. **Không có "lá thư ma"** nào được gửi cho một dữ liệu không tồn tại.

### Thử 4: Tắt một service, xem hệ thống xuống cấp ra sao

Trong terminal đang chạy service, bấm `Ctrl+C` để tắt hết. Rồi chỉ chạy 2 service:

```bash
pnpm dev --filter=gateway --filter=ping-service
```

Giờ `pong-service` không chạy. Thử:

```bash
curl localhost:4000/v1/ping/status
```

Kết quả:

```json
{ "data": { "published": 5, "delivered": null, "degraded": true, "pending": null } }
```

`degraded: true` — gateway vẫn trả lời, chỉ thiếu phần của `pong-service`. **Không sập.**

Đây là thứ phải thiết kế có chủ đích: mỗi lời gọi phải trả lời trước câu hỏi "service kia chết thì sao?".

### Thử 5: Event không bị mất khi service chết

Vẫn trong tình trạng `pong-service` đang tắt:

```bash
curl -X POST localhost:4000/v1/ping/echo \
  -H "Content-Type: application/json" -d '{"message":"gui-khi-pong-chet"}'
```

Giờ bật lại đầy đủ (`Ctrl+C` rồi `pnpm dev:ping`), chờ vài giây:

```bash
curl localhost:4000/v1/ping/received
```

`gui-khi-pong-chet` **vẫn xuất hiện**. NATS JetStream đã giữ tin lại và giao khi `pong-service` sống lại.

---

## Phần 6 — Các lệnh hay dùng

> Bảng đầy đủ hơn + cách xử lý lỗi: [COMMANDS.md](COMMANDS.md)

```bash
# Hạ tầng
pnpm infra:up         # bật mongo, redis, nats, storage, jaeger, mailpit
pnpm infra:down       # tắt (giữ nguyên dữ liệu)
pnpm infra:reset      # tắt + XÓA SẠCH dữ liệu, về trạng thái ban đầu
pnpm infra:logs       # xem log của hạ tầng

# Code
pnpm build            # dịch TypeScript -> JavaScript
pnpm dev:ping         # chạy gateway + ping + pong
pnpm test             # chạy test tự động (không cần hạ tầng)
pnpm typecheck        # kiểm tra lỗi kiểu dữ liệu
pnpm smoke            # kiểm thử trên hệ thống đang chạy
pnpm format           # tự sửa format code
```

### Các địa chỉ web

| Địa chỉ                | Là gì                                             |
| ---------------------- | ------------------------------------------------- |
| http://localhost:4000  | API chính (gateway)                               |
| http://localhost:16686 | **Jaeger** — xem request đi qua những service nào |
| http://localhost:8081  | **Mongo Express** — xem dữ liệu trong database    |
| http://localhost:8222  | NATS — xem tin nhắn giữa các service              |
| http://localhost:9001  | SeaweedFS — nơi sẽ lưu video                      |
| http://localhost:8025  | Mailpit — email gửi đi sẽ hiện ở đây              |

---

## Phần 7 — Khi gặp lỗi

| Lỗi                                                     | Nguyên nhân                                   | Cách sửa                                                  |
| ------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| `docker: command not found`                             | Docker Desktop chưa mở, hoặc terminal cũ      | Mở Docker Desktop, rồi mở **terminal mới**                |
| `error during connect... docker_engine`                 | Docker Desktop chưa chạy xong                 | Chờ chấm xanh "Engine running"                            |
| `Không kết nối được NATS tại nats://localhost:4222`     | Chưa chạy `pnpm infra:up`                     | `pnpm infra:up`                                           |
| `Unable to connect to the database. Retrying...`        | MongoDB chưa sẵn sàng                         | Chờ 10–20 giây, nó tự thử lại                             |
| `MongoServerError: Authentication failed`               | Đổi `SERVICE_DB_PASSWORD` sau khi đã tạo user | `pnpm infra:reset` rồi `pnpm infra:up`                    |
| `Transaction numbers are only allowed on a replica set` | MongoDB không chạy ở chế độ replica set       | `pnpm infra:reset` rồi `pnpm infra:up`                    |
| `EADDRINUSE :4000`                                      | Lần chạy trước chưa tắt hẳn                   | `netstat -ano \| findstr :4000` → `taskkill /PID <số> /F` |
| `pnpm smoke` báo "không chạy được"                      | Service chưa chạy                             | Terminal khác phải đang chạy `pnpm dev:ping`              |
| Docker rất chậm                                         | Bình thường trên Windows lần đầu              | Tăng RAM trong Settings → Resources                       |

### Cách "làm lại từ đầu" khi bí

```bash
pnpm infra:reset      # xóa sạch dữ liệu Docker
pnpm infra:up         # dựng lại
pnpm build
pnpm dev:ping
```

An toàn — hiện chưa có dữ liệu thật nào để mất.

---

## Phần 8 — Tiếp theo đọc gì

Theo thứ tự này:

1. **[PHASE-0.md](PHASE-0.md)** — tóm tắt những gì đã xây
2. **[docs/00-overview.md](docs/00-overview.md)** — mục tiêu và phạm vi dự án
3. **[docs/02-architecture.md](docs/02-architecture.md)** — kiến trúc tổng thể
4. **[docs/14-inter-service-communication.md](docs/14-inter-service-communication.md)** — outbox, idempotency, saga (phần khó nhất và cũng giá trị nhất)

Muốn hiểu code thì đọc theo đường đi của một request:

```
apps/gateway/src/ping/ping.controller.ts          ← điểm vào HTTP
  → packages/service-kit/src/rpc/rpc-client.ts    ← gửi qua NATS
    → apps/ping-service/src/echo/echo.controller.ts   ← nhận
      → apps/ping-service/src/echo/echo.service.ts    ← nghiệp vụ + outbox
        → packages/service-kit/src/outbox/outbox.relay.ts  ← gửi event
          → apps/pong-service/src/received/echo.handlers.ts ← nhận event
```
