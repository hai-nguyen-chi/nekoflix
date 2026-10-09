# Setup & chạy app

Hướng dẫn thao tác, không giải thích. Mỗi bước có một **cách kiểm tra** — làm xong
bước nào thì xác nhận bước đó, đừng chạy hết rồi mới đi tìm chỗ hỏng.

- Chưa có Docker, chưa biết Docker là gì → [GETTING-STARTED.md](GETTING-STARTED.md)
- Cần tra một lệnh cụ thể → [COMMANDS.md](COMMANDS.md)
- Quy trình nhánh / PR / phát hành → [docs/17-git-workflow.md](docs/17-git-workflow.md)

> **Địa chỉ web: http://localhost:5173**

---

## A. Setup lần đầu (máy mới)

Làm một lần cho mỗi máy. Mất khoảng 10–20 phút, phần lớn là Docker tải image.

### Cần có sẵn

| Thứ            | Phiên bản | Kiểm tra        |
| -------------- | --------- | --------------- |
| Node.js        | ≥ 20.11   | `node -v`       |
| pnpm           | ≥ 9       | `pnpm -v`       |
| Docker Desktop | bản mới   | `docker ps`     |
| Git            | bất kỳ    | `git --version` |

Thiếu pnpm: `npm install -g pnpm`.
Docker Desktop phải **đang mở** (chấm xanh "Engine running"), không chỉ là đã cài.

---

### Bước 1 — Lấy code và cài thư viện

```bash
git clone https://github.com/hai-nguyen-chi/nekoflix.git
cd nekoflix
git checkout develop     # nhánh phát triển; master là bản đang phát hành
pnpm install
```

**Kiểm tra:** kết thúc bằng `Done in ...`, không có dòng `ERR_`.

---

### Bước 2 — Tạo file cấu hình

```bash
cp .env.example .env
pnpm gen:secrets
```

**Kiểm tra:** `grep -c JWT_PRIVATE_KEY .env` trả về `1`.

`gen:secrets` sinh cặp khoá RSA để ký JWT. Khoá không bao giờ nằm trong repo nên
mỗi máy tự sinh khoá riêng. Chạy lại nhiều lần không làm mất secret đã có — nó
chỉ điền vào chỗ còn trống.

> **Thiếu bước này thì identity-service không khởi động được.** Nó cần
> `JWT_PRIVATE_KEY` ngay lúc start, và `.env.example` để trống có chủ đích.

`apps/web/.env` là **tuỳ chọn** — không có thì web tự dùng `http://localhost:4000`.

---

### Bước 3 — Bật hạ tầng Docker

```bash
pnpm infra:up
```

Lần đầu tải ~2GB image, mất 5–15 phút. Lần sau khoảng 10 giây.

**Kiểm tra:**

```bash
docker compose -f infra/docker-compose.yml ps
```

7 container, các container có healthcheck phải ở trạng thái `healthy`.

Hai dòng `exited with code 0` của `mongo-init` và `storage-init` là **bình thường**
— chúng chạy một lần (tạo 8 DB user, tạo bucket) rồi tự tắt.

---

### Bước 4 — Build

```bash
pnpm build
```

**Kiểm tra:** `Tasks: 6 successful, 6 total`.

Bắt buộc ở lần đầu: `packages/contracts` và `packages/service-kit` phải có `dist/`
trước khi các app import được chúng.

---

### Bước 5 — Chạy

Sang **[phần B](#b-khởi-động-hằng-ngày)** bên dưới.

---

## B. Khởi động hằng ngày

### 1. Bật hạ tầng

```bash
pnpm infra:up
```

Bỏ qua được nếu Docker Desktop vẫn đang chạy từ lần trước.

### 2. Chạy app

```bash
pnpm dev:auth
```

**Cửa sổ này sẽ không trả lại con trỏ** — đó là đúng. 3 service + giao diện web
đang chạy trong đó. Để nguyên, mở cửa sổ thứ hai nếu cần gõ lệnh khác.

### 3. Mở trình duyệt

**http://localhost:5173**

---

### Thời gian khởi động — đọc kỹ chỗ này

Hai phần lên **không cùng lúc**:

```
~5 giây   →  web (Vite)        http://localhost:5173  ✅ mở được rồi
~60 giây  →  gateway + identity + notification        ⏳ còn đang compile
```

Mở web trong 60 giây đầu thì **trang hiện ra nhưng đăng nhập sẽ lỗi mạng** —
backend chưa sẵn sàng, không phải code hỏng. Chờ đến khi thấy đủ ba dòng này
trong cửa sổ `pnpm dev:auth`:

```
INFO: gateway đã sẵn sàng                port: 4000
INFO: identity-service đã sẵn sàng       port: 4001
INFO: notification-service đã sẵn sàng   port: 4007
```

Kiểm tra nhanh bằng lệnh:

```bash
curl localhost:4000/health/ready
```

Trả `{"status":"ok",...}` là xong.

---

## C. Dùng thử lần đầu

Email **không gửi ra Internet thật** — Mailpit giữ lại tất cả, nên dùng địa chỉ gì
cũng được.

1. Mở **http://localhost:5173** → tự chuyển sang trang đăng nhập
2. Bấm **Đăng ký ngay**
   - Email: bất kỳ, ví dụ `toi@nekoflix.local`
   - Mật khẩu: tối thiểu 8 ký tự, **phải có cả chữ và số** (vd `Matkhau123`)
   - Tên hiển thị: tối thiểu 2 ký tự
3. Mở **http://localhost:8025** (Mailpit) → email xác thực đã nằm ở đó
4. Bấm nút **Xác thực email** trong email đó
5. Quay lại web → chọn hồ sơ → vào trang Browse

Đăng ký xong hệ thống tạo sẵn **một hồ sơ mặc định** mang tên bạn vừa nhập. Thêm
hồ sơ ở trang **Quản lý hồ sơ**, tối đa 5.

---

## D. Dừng

```bash
# Ctrl+C ở cửa sổ đang chạy pnpm dev:auth
pnpm infra:down        # tắt container, GIỮ NGUYÊN dữ liệu
```

Không tắt Docker cũng không sao — nó tự thu hồi RAM khi container rảnh.

Muốn **xoá sạch dữ liệu** và về trạng thái ban đầu:

```bash
pnpm infra:reset && pnpm infra:up
```

An toàn: dữ liệu dev dựng lại được bằng cách đăng ký lại tài khoản.

---

## E. Bảng cổng

| Cổng      | Là gì                                | Mở trong trình duyệt? |
| --------- | ------------------------------------ | --------------------- |
| **5173**  | **Giao diện web**                    | ✅ đây là app         |
| **8025**  | **Mailpit** — mọi email hệ thống gửi | ✅ rất hay dùng       |
| **16686** | **Jaeger** — xem request đi qua đâu  | ✅ khi debug          |
| **8081**  | **Mongo Express** — xem dữ liệu DB   | ✅ khi debug          |
| 8222      | NATS — xem stream và consumer        | ✅ khi debug          |
| 4000      | gateway (API)                        | chỉ gọi bằng `curl`   |
| 4001      | identity-service                     | nội bộ                |
| 4007      | notification-service                 | nội bộ                |
| 27017     | MongoDB                              | dùng Mongo Express    |

Trình duyệt **không bao giờ gọi 4001/4007**. Nó chỉ nói chuyện với 5173 (giao
diện) và 4000 (API); phần còn lại nằm sau NATS.

---

## F. Kiểm chứng hệ thống

Chạy ở cửa sổ thứ hai, trong khi `pnpm dev:auth` vẫn đang chạy:

```bash
pnpm smoke                # 31 kiểm tra trên hạ tầng thật, ~25 giây
pnpm verify:idempotency   # event bị giao lại không sinh email thứ hai
```

Không cần hạ tầng:

```bash
pnpm test                 # 163 test, gồm contract test
pnpm lint
pnpm typecheck
```

---

## G. Khi hỏng

| Triệu chứng                                             | Nguyên nhân                                   | Cách sửa                                        |
| ------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| Web mở được nhưng đăng nhập báo lỗi mạng                | Backend chưa khởi động xong                   | Chờ đủ 3 dòng "đã sẵn sàng" (~60s)              |
| `JWT_PRIVATE_KEY` / identity-service không start        | Quên `pnpm gen:secrets`                       | `pnpm gen:secrets` rồi chạy lại                 |
| `Không kết nối được NATS`                               | Chưa bật hạ tầng                              | `pnpm infra:up`                                 |
| `Transaction numbers are only allowed on a replica set` | MongoDB không ở chế độ replica set            | `pnpm infra:reset && pnpm infra:up`             |
| `MongoServerError: Authentication failed`               | Đổi `SERVICE_DB_PASSWORD` sau khi đã tạo user | `pnpm infra:reset && pnpm infra:up`             |
| `EADDRINUSE :4000` (hoặc 5173)                          | Lần chạy trước chưa tắt hẳn                   | xem bên dưới                                    |
| `Cannot find module '@nekoflix/contracts'`              | Chưa build package dùng chung                 | `pnpm build`                                    |
| Đăng ký xong Mailpit không có email                     | notification-service chưa chạy                | Xem log, kiểm tra `localhost:4007/health/ready` |
| `docker: command not found`                             | Docker Desktop chưa mở                        | Mở app, chờ chấm xanh, mở **terminal mới**      |

### Cổng bị chiếm

```bash
netstat -ano | findstr :5173      # tìm PID đang giữ cổng
taskkill /PID <số> /F
```

### Làm lại từ đầu khi bí

```bash
pnpm infra:reset      # xoá sạch dữ liệu Docker
pnpm infra:up
pnpm build
pnpm dev:auth
```

---

## H. Đổi máy (công ty ↔ nhà)

Database **không** đi theo Git. Quy trình:

```bash
# Máy A — trước khi rời
git add -A && git commit -m "..."
git push -u origin feat/<phase>

# Máy B
git fetch && git checkout feat/<phase>
pnpm install          # nếu package.json đổi
pnpm build
pnpm infra:up
pnpm dev:auth
```

Làm trên nhánh riêng cắt từ `develop`, không push thẳng vào nhánh môi trường —
xem [docs/17-git-workflow.md](docs/17-git-workflow.md).

Tài khoản đã tạo ở máy A **không có** ở máy B — đăng ký lại một tài khoản mới,
mất 30 giây. Đó là chủ đích: dữ liệu dev là thứ vứt đi và tạo lại được.

`.env` cũng không đi theo Git. Máy mới phải làm lại [Bước 2](#bước-2--tạo-file-cấu-hình).

Thật sự cần mang dữ liệu theo thì dùng `pnpm db:export` / `pnpm db:import` —
xem [COMMANDS.md §2](COMMANDS.md).

> `pnpm db:seed` hiện **không tạo gì cả** (mảng seed đang trống). Luồng đăng ký
> phải phát event và gửi email xác thực, nên chèn thẳng tài khoản vào MongoDB sẽ
> cho ra tài khoản không giống tài khoản thật.
