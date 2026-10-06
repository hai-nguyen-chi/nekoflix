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
pnpm gen:secrets
```

File `.env` chứa thông tin kết nối (địa chỉ database, mật khẩu...). Nó **không được commit lên Git** — mỗi người một file riêng.

`pnpm gen:secrets` sinh cặp khoá RSA để ký JWT và vài secret khác. Khoá ký token
không bao giờ nằm trong repo, nên mỗi máy tự sinh khoá của mình. Chạy lại nhiều
lần không làm mất secret đã có — nó chỉ điền vào chỗ còn trống.

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

nekoflix-mongo-init    | Đã cấu hình 8 DB user.
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
 Tasks:    6 successful, 6 total
```

</details>

---

### Bước 5: Chạy hệ thống

```bash
pnpm dev:auth
```

**Terminal này sẽ không trả lại con trỏ** — đó là bình thường, 3 service + giao
diện web đang chạy trong đó. Để nguyên cửa sổ này.

<details>
<summary>Đúng thì thấy gì?</summary>

Log màu từ các service trộn lẫn nhau, kết thúc bằng những dòng kiểu:

```
INFO: gateway đã sẵn sàng                port: 4000
INFO: identity-service đã sẵn sàng       port: 4001
INFO: notification-service đã sẵn sàng   port: 4007
INFO: đã kết nối NATS JetStream
INFO: outbox relay đã khởi động
INFO: JetStream consumer đã khởi động
VITE ready                               http://localhost:5173
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
Nekoflix — smoke test (http://localhost:4000)

1. Sức khoẻ hệ thống
  gateway sẵn sàng ... OK
  identity-service sẵn sàng ... OK
  notification-service sẵn sàng ... OK

2. Đăng ký
  tạo tài khoản mới ... OK
  refresh token CHỈ nằm trong cookie httpOnly, không vào body ... OK
  ...

3. identity -> outbox -> JetStream -> notification -> SMTP
  email xác thực tới được Mailpit ... OK
  token trong email dùng được để xác thực ... OK

4. Refresh rotation và phát hiện token bị đánh cắp
  refresh hợp lệ -> cấp token mới (rotation) ... OK
  token cũ dùng lại NGAY -> vẫn chấp nhận (grace period) ... OK
  token cũ dùng lại sau grace period -> TOKEN_REUSE_DETECTED ... OK
  ...

────────────────────────────────────────────────────
  20 đạt, 0 thất bại

  ĐẠT.
```

Mất khoảng 30 giây — có một bước cố ý chờ hết grace period 10 giây.

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
gateway  POST /v1/auth/register                                  250ms
 └─ rpc identity.auth.register                                   240ms
     ├─ [identity-service] mongoose.User.save                      12ms   ← dữ liệu
     ├─ [identity-service] mongoose.OutboxEvent.save                4ms   ← event, CÙNG transaction
     └─ [notification-service] event identity.user.registered      35ms   ← qua JetStream
         ├─ mongoose.ProcessedEvent.save                           14ms   ← chống xử lý 2 lần
         └─ mongoose.EmailOutbox.save                               4ms
```

> Phần lớn 250ms là băm mật khẩu bằng argon2id — **cố ý chậm**, để kẻ có
> được database không thể dò mật khẩu hàng loạt.

Nếu thay vào đó bạn thấy **nhiều trace rời rạc** → trace context bị đứt, cần sửa trước khi làm tiếp.

> **Tại sao quan trọng?** Hệ thống này sẽ có 9 service (hiện mới 3). Khi một request lỗi, nó đã đi qua 4–5 service rồi. Không có trace liền mạch thì gần như không thể tìm ra chỗ hỏng.

---

## Phần 4 — Bạn vừa chạy cái gì?

```
   Bạn gõ curl / mở trình duyệt
            │
            ▼
   ┌──────────────────────┐
   │       gateway        │  cổng vào duy nhất (port 4000)
   │                      │  không có database, không chứa nghiệp vụ
   └──────────┬───────────┘
              │ gửi tin qua NATS
              ▼
   ┌──────────────────────┐
   │   identity-service   │  ghi vào database của RIÊNG nó
   │                      │  + ghi "thư báo" vào bảng outbox
   └──────────┬───────────┘     (cả hai trong 1 transaction)
              │
              │ outbox relay đọc bảng outbox mỗi giây
              │ rồi gửi lên NATS JetStream
              ▼
   ┌──────────────────────┐
   │ notification-service │  nhận tin, xếp email vào hàng đợi
   │                      │  rồi một relay riêng gửi qua SMTP
   └──────────────────────┘
```

### Ba ý tưởng cốt lõi

**1. Mỗi service có database riêng, không ai đọc của ai.**

`identity-service` dùng database `nekoflix_identity`, `notification-service` dùng `nekoflix_notification`. Mỗi service có tài khoản MongoDB riêng chỉ mở được database của mình — đọc nhầm là lỗi ngay, không phải chuyện "nhớ đừng làm".

Hệ quả thực tế: notification-service **không tra được email của người dùng**. Nên email phải nằm sẵn trong event. Nhờ vậy identity có chết thì email vẫn gửi được bình thường.

**2. Muốn báo tin cho service khác thì gửi "event", không gọi thẳng.**

`identity-service` không biết `notification-service` tồn tại. Nó chỉ nói "có người vừa đăng ký" lên NATS. Ai quan tâm thì nghe. Nhờ vậy tắt `notification-service` đi thì đăng ký vẫn chạy bình thường — chỉ là email tới muộn hơn.

**3. Outbox — chỗ dễ sai nhất.**

Nếu viết kiểu thông thường:

```
ghi vào database        ← xong
gửi tin lên NATS        ← máy sập ở đây!
```

Dữ liệu đã lưu nhưng tin không bao giờ được gửi. Người dùng có tài khoản nhưng **không bao giờ nhận được email xác thực**, và tài khoản đó kẹt vĩnh viễn ở trạng thái chưa xác thực. **Không có lỗi nào được báo ra** — hệ thống cứ thế lệch dần.

Cách làm đúng: ghi dữ liệu **và** ghi "thư cần gửi" vào cùng một bảng, trong **cùng một transaction**. Hai cái cùng thành công hoặc cùng thất bại. Rồi một tiến trình riêng (`outbox relay`) đọc bảng đó và gửi đi.

Đây chính là cái mà `pnpm smoke` bước 3 kiểm tra.

---

## Phần 5 — Nghịch thử để hiểu

Giữ `pnpm dev:auth` chạy, mở terminal thứ hai.

### Thử 1: Đăng ký một tài khoản

```bash
curl -X POST localhost:4000/v1/auth/register   -H "Content-Type: application/json"   -d '{"email":"thu@nekoflix.local","password":"Matkhau123","displayName":"Thu Nghiem"}'
```

Rồi mở http://localhost:8025 (Mailpit). **Email xác thực đã nằm ở đó.**

Email đó không do gateway gửi, cũng không do identity-service gửi. Nó đi qua ba
chặng: identity ghi outbox → relay đẩy lên JetStream → notification nhận và xếp
hàng → relay email gửi qua SMTP. Bạn vừa thấy toàn bộ đường dây hoạt động.

### Thử 2: Xem outbox hoạt động

Mở http://localhost:8081 (Mongo Express) → database `nekoflix_identity` → bảng `outbox`.

Bạn sẽ thấy các bản ghi với `status: "published"` — đó là những "lá thư" đã được gửi đi.

Rồi sang database `nekoflix_notification` → bảng `emailoutboxes`: cùng một sự
kiện, nhưng giờ là email đã gửi. Hai database tách biệt hoàn toàn.

### Thử 3: Chứng minh ranh giới database là thật

```bash
docker exec nekoflix-mongo mongosh -u identity_svc -p devpassword   --authenticationDatabase admin --quiet   --eval 'db.getSiblingDB("nekoflix_notification").emailoutboxes.countDocuments()'
```

Phải trả về **`Unauthorized`**. Nếu nó đọc được, MongoDB đang chạy thiếu `--auth`
và toàn bộ tài khoản phân quyền chỉ là trang trí.

### Thử 4: Tắt notification-service, xem hệ thống xuống cấp ra sao

Trong terminal đang chạy service, bấm `Ctrl+C`. Rồi chỉ chạy 2 service:

```bash
pnpm dev --filter=gateway --filter=identity-service
```

Giờ `notification-service` không chạy. Đăng ký một tài khoản khác:

```bash
curl -X POST localhost:4000/v1/auth/register   -H "Content-Type: application/json"   -d '{"email":"khi-notif-chet@nekoflix.local","password":"Matkhau123","displayName":"Thu 2"}'
```

**Vẫn trả 201.** Đăng ký không phụ thuộc vào việc email có gửi được hay không.
Mailpit thì chưa có gì — đúng như mong đợi.

### Thử 5: Event không bị mất khi service chết

Bật lại đầy đủ (`Ctrl+C` rồi `pnpm dev:auth`), chờ vài giây rồi xem Mailpit.

Email cho `khi-notif-chet@nekoflix.local` **vẫn xuất hiện**. NATS JetStream đã
giữ tin lại suốt thời gian notification-service tắt, và giao khi nó sống lại.

Đây là khác biệt giữa "gửi tin" và "gọi hàm": lời gọi hàm tới một service đang
chết thì mất luôn, còn event thì nằm chờ.

### Thử 6: Phát hiện token bị đánh cắp

```bash
pnpm verify:idempotency
```

Script này ép một tình huống không bao giờ xảy ra ở luồng bình thường: cùng một
event được JetStream giao 4 lần. Kết quả phải là **1 email duy nhất**.

Nó cũng chạy một bước đối chứng — event id khác, payload giống hệt → phải ra
email thứ hai. Thiếu bước đối chứng thì "không tăng" có thể chỉ nghĩa là cả
pipeline đang chết.

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
pnpm dev:auth         # chạy gateway + identity + notification + web
pnpm test             # chạy test tự động (không cần hạ tầng)
pnpm typecheck        # kiểm tra lỗi kiểu dữ liệu
pnpm smoke            # kiểm thử trên hệ thống đang chạy
pnpm format           # tự sửa format code
```

### Các địa chỉ web

| Địa chỉ                | Là gì                                              |
| ---------------------- | -------------------------------------------------- |
| http://localhost:5173  | **Giao diện web** — đăng ký, đăng nhập, chọn hồ sơ |
| http://localhost:4000  | API chính (gateway)                                |
| http://localhost:16686 | **Jaeger** — xem request đi qua những service nào  |
| http://localhost:8081  | **Mongo Express** — xem dữ liệu trong database     |
| http://localhost:8222  | NATS — xem tin nhắn giữa các service               |
| http://localhost:9001  | SeaweedFS — nơi sẽ lưu video                       |
| http://localhost:8025  | **Mailpit** — mọi email hệ thống gửi đi            |

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
| `pnpm smoke` báo "không chạy được"                      | Service chưa chạy                             | Terminal khác phải đang chạy `pnpm dev:auth`              |
| Docker rất chậm                                         | Bình thường trên Windows lần đầu              | Tăng RAM trong Settings → Resources                       |

### Cách "làm lại từ đầu" khi bí

```bash
pnpm infra:reset      # xóa sạch dữ liệu Docker
pnpm infra:up         # dựng lại
pnpm build
pnpm dev:auth
```

An toàn — hiện chưa có dữ liệu thật nào để mất.

---

## Phần 8 — Tiếp theo đọc gì

Theo thứ tự này:

1. **[docs/15-code-walkthrough.md](docs/15-code-walkthrough.md)** — file nào làm gì, ai gọi ai
2. **[docs/05-authentication.md](docs/05-authentication.md)** — rotation, reuse detection, OAuth
3. **[docs/00-overview.md](docs/00-overview.md)** — mục tiêu và phạm vi dự án
4. **[docs/02-architecture.md](docs/02-architecture.md)** — kiến trúc tổng thể
5. **[docs/14-inter-service-communication.md](docs/14-inter-service-communication.md)** — outbox, idempotency, saga (phần khó nhất và cũng giá trị nhất)

Muốn hiểu code thì đọc theo đường đi của một request:

```
apps/gateway/src/auth/auth.controller.ts              ← điểm vào HTTP
  → packages/service-kit/src/rpc/rpc-client.ts        ← gửi qua NATS
    → apps/identity-service/src/api/auth.controller.ts      ← nhận
      → apps/identity-service/src/application/auth.service.ts  ← nghiệp vụ + outbox
        → packages/service-kit/src/outbox/outbox.relay.ts     ← gửi event
          → apps/notification-service/src/events/identity.handlers.ts ← nhận event
```
