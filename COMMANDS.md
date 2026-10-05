# Sổ tay lệnh

Mở file này khi quên lệnh hoặc khi có gì đó hỏng.

- Lần đầu cài máy mới → [GETTING-STARTED.md](GETTING-STARTED.md)
- Phase 0 có gì → [PHASE-0.md](PHASE-0.md)
- Code chạy ra sao → [docs/15-code-walkthrough.md](docs/15-code-walkthrough.md)

---

## 1. Hằng ngày

### Bắt đầu buổi làm việc

```bash
pnpm infra:up          # bật MongoDB, Redis, NATS, SeaweedFS, Jaeger, Mailpit
pnpm dev:ping          # chạy service — ĐỂ NGUYÊN cửa sổ này
```

Cửa sổ thứ hai để gõ lệnh khác (`curl`, `pnpm smoke`, git...).

### Kết thúc

```bash
# Ctrl+C ở cửa sổ đang chạy service
pnpm infra:down        # tắt container, GIỮ NGUYÊN dữ liệu
```

Không tắt cũng không sao — Docker tự thu hồi RAM khi container rảnh (Resource Saver).

---

## 2. Làm việc trên 2 máy

Đây là quy trình cho trường hợp máy công ty + máy nhà.

### Quy trình chuẩn — dùng seed, KHÔNG đồng bộ database

```bash
# ── Máy A, trước khi rời ──
git add -A && git commit -m "feat: ..." && git push

# ── Máy B ──
git pull
pnpm install           # nếu package.json đổi
pnpm infra:up
pnpm db:seed           # sinh lại dữ liệu mẫu — GIỐNG HỆT máy A
pnpm build && pnpm dev:ping
```

**Đây là cách nên dùng.** Dữ liệu seed là _tất định_: cùng một lệnh cho cùng một kết quả trên mọi máy. Không cần copy file, không cần mạng, không bao giờ lệch phiên bản.

> Nguyên tắc: **code đi theo Git, dữ liệu dev dựng lại bằng seed.** Đừng coi database dev là thứ phải nâng niu — nó là thứ vứt đi và tạo lại được.

### Khi có dữ liệu tạo tay cần mang theo

Chỉ dùng khi bạn tạo dữ liệu bằng tay mà seed không sinh ra được.

```bash
# ── Máy A ──
pnpm db:export         # -> .data/nekoflix-<ngày>.gz

# Copy file .gz đó qua Google Drive / USB / Dropbox

# ── Máy B ──
pnpm infra:up
pnpm db:import         # nhập bản mới nhất trong .data/
pnpm db:list           # xem các bản đã có
```

`.data/` đã được gitignore. **Đừng commit file dump** — nhị phân, phình nhanh, có thể chứa dữ liệu nhạy cảm.

### Những gì KHÔNG đi theo Git

|                                  | Cách xử lý ở máy mới   |
| -------------------------------- | ---------------------- |
| `node_modules/`                  | `pnpm install`         |
| `dist/`                          | `pnpm build`           |
| **`.env`**                       | `cp .env.example .env` |
| Dữ liệu MongoDB                  | `pnpm db:seed`         |
| Dữ liệu Redis / NATS / SeaweedFS | tự sinh lại            |

---

## 3. Toàn bộ lệnh

### Hạ tầng (Docker)

| Lệnh               | Làm gì                                            |
| ------------------ | ------------------------------------------------- |
| `pnpm infra:up`    | Bật tất cả container                              |
| `pnpm infra:down`  | Tắt, **giữ** dữ liệu                              |
| `pnpm infra:reset` | Tắt + **XOÁ SẠCH** dữ liệu, về trạng thái ban đầu |
| `pnpm infra:logs`  | Xem log hạ tầng (Ctrl+C để thoát)                 |

### Code

| Lệnh                            | Làm gì                                         |
| ------------------------------- | ---------------------------------------------- |
| `pnpm install`                  | Cài thư viện                                   |
| `pnpm build`                    | Dịch TypeScript → JavaScript                   |
| `pnpm dev`                      | Chạy **tất cả** service                        |
| `pnpm dev:ping`                 | Chỉ gateway + ping + pong                      |
| `pnpm lint`                     | Kiểm tra quy tắc code + **rào chắn kiến trúc** |
| `pnpm typecheck`                | Kiểm tra lỗi kiểu dữ liệu                      |
| `pnpm format`                   | Tự sửa định dạng                               |
| `pnpm new:service <tên> <cổng>` | Tạo service mới theo khuôn chuẩn               |

### Database

| Lệnh                      | Làm gì                           |
| ------------------------- | -------------------------------- |
| `pnpm db:seed`            | Sinh dữ liệu mẫu (thêm/cập nhật) |
| `pnpm db:seed -- --reset` | Xoá dữ liệu cũ rồi seed lại      |
| `pnpm db:export`          | Xuất ra `.data/`                 |
| `pnpm db:import`          | Nhập bản mới nhất                |
| `pnpm db:list`            | Liệt kê bản đã xuất              |

### Kiểm thử

| Lệnh                      | Cần gì                               |
| ------------------------- | ------------------------------------ |
| `pnpm test`               | Không cần hạ tầng                    |
| `pnpm smoke`              | Cần hạ tầng **và** service đang chạy |
| `pnpm verify:idempotency` | Cần hạ tầng **và** service đang chạy |

---

## 4. Các trang web

| Địa chỉ                | Dùng để                                                 |
| ---------------------- | ------------------------------------------------------- |
| http://localhost:4000  | API chính (gateway)                                     |
| http://localhost:16686 | **Jaeger** — xem request đi qua service nào, chậm ở đâu |
| http://localhost:8081  | **Mongo Express** — xem dữ liệu trong database          |
| http://localhost:8222  | NATS — xem stream và consumer                           |
| http://localhost:9001  | SeaweedFS — nơi sẽ lưu video                            |
| http://localhost:8025  | Mailpit — email gửi đi hiện ở đây                       |

---

## 5. Kiểm tra nhanh khi nghi có vấn đề

```bash
# Container nào đang chạy, có healthy không?
docker compose -f infra/docker-compose.yml ps

# Service có sống không?
curl localhost:4000/health/ready    # gateway
curl localhost:4101/health/ready    # ping-service
curl localhost:4102/health/ready    # pong-service

# Xem dữ liệu trong MongoDB
docker exec nekoflix-mongo mongosh -u root -p rootpassword \
  --authenticationDatabase admin --quiet \
  --eval 'db.getSiblingDB("nekoflix_ping").echoes.find().limit(5)'

# Kiểm tra ranh giới service CÓ được ép không (phải trả Unauthorized)
docker exec nekoflix-mongo mongosh -u ping_svc -p devpassword \
  --authenticationDatabase admin --quiet \
  --eval 'db.getSiblingDB("nekoflix_pong").received.countDocuments()'
```

---

## 6. Khi có lỗi

### Thử theo thứ tự này

```bash
# 1. Container còn chạy không?
docker compose -f infra/docker-compose.yml ps

# 2. Bật lại hạ tầng
pnpm infra:down && pnpm infra:up

# 3. Build lại
pnpm build

# 4. Cài lại thư viện
rm -rf node_modules && pnpm install

# 5. Làm lại từ đầu (XOÁ SẠCH dữ liệu — an toàn, seed lại được)
pnpm infra:reset && pnpm infra:up && pnpm db:seed
```

Bước 5 an toàn vì dữ liệu dev dựng lại được. Nếu có dữ liệu tay cần giữ, `pnpm db:export` trước.

### Bảng lỗi thường gặp

| Thông báo                                               | Nguyên nhân                            | Cách sửa                                         |
| ------------------------------------------------------- | -------------------------------------- | ------------------------------------------------ |
| `docker: command not found`                             | Docker Desktop chưa mở                 | Mở app, chờ chấm xanh, mở **terminal mới**       |
| `error during connect... docker_engine`                 | Docker chưa khởi động xong             | Chờ "Engine running"                             |
| `Không kết nối được NATS`                               | Chưa bật hạ tầng                       | `pnpm infra:up`                                  |
| `Unable to connect to the database. Retrying`           | MongoDB chưa sẵn sàng                  | Chờ 10–20 giây, tự thử lại                       |
| `MongoServerError: Authentication failed`               | Đổi mật khẩu sau khi tạo user          | `pnpm infra:reset && pnpm infra:up`              |
| `Transaction numbers are only allowed on a replica set` | MongoDB không chạy replica set         | `pnpm infra:reset && pnpm infra:up`              |
| `EADDRINUSE :4000`                                      | Lần chạy trước chưa tắt hẳn            | Xem mục "Cổng bị chiếm" bên dưới                 |
| `E11000 duplicate key ... dup key: { id: null }`        | Index cũ còn sót sau khi đổi tên field | Xem mục "Index cũ" bên dưới                      |
| `pnpm smoke` báo không chạy được                        | Service chưa chạy                      | Cửa sổ khác phải đang `pnpm dev:ping`            |
| `pnpm lint` báo `import is restricted`                  | Service import service khác            | Đúng ý đồ — dùng `RpcClient` hoặc `@OnEvent`     |
| Jaeger trống trơn                                       | `.env` thiếu `OTEL_..._ENDPOINT`       | `cp .env.example .env` rồi khởi động lại service |

### Cổng bị chiếm

```bash
netstat -ano | findstr :4000       # tìm PID đang giữ cổng
taskkill /PID <số> /F              # tắt nó

# Hoặc tắt hết tiến trình node (cẩn thận: tắt MỌI app Node)
taskkill /F /IM node.exe
```

### Index cũ còn sót

Xảy ra khi đổi tên field trong schema: Mongoose tạo index mới nhưng **không bao giờ xoá index cũ**.

```bash
# Xem index hiện có
docker exec nekoflix-mongo mongosh -u root -p rootpassword \
  --authenticationDatabase admin --quiet \
  --eval 'db.getSiblingDB("nekoflix_ping").outbox.getIndexes()'

# Xoá index cũ
docker exec nekoflix-mongo mongosh -u root -p rootpassword \
  --authenticationDatabase admin --quiet \
  --eval 'db.getSiblingDB("nekoflix_ping").outbox.dropIndex("ten_index_cu")'
```

Cách nhanh nhất khi dữ liệu không quan trọng: `pnpm infra:reset && pnpm infra:up && pnpm db:seed`.

> Từ Phase 0 đã có `IndexGuard` log `ERROR` khi tạo index thất bại. **Để ý dòng đó trong log** — nó nghĩa là một ràng buộc trong schema đang KHÔNG được thực thi.

### Docker chậm trên Windows

Bình thường ở lần đầu. Nếu vẫn chậm:

```bash
docker system prune -a        # dọn image/container không dùng
wsl --shutdown                # khởi động lại WSL, rồi mở lại Docker Desktop
```

---

## 7. Những điều nên nhớ

**Mỗi service một database riêng.** `ping-service` chỉ đọc được `nekoflix_ping`. Thử đọc database khác sẽ bị MongoDB từ chối — đó là chủ đích, không phải lỗi.

**Lỗi im lặng nguy hiểm hơn lỗi ồn ào.** Ba thứ cần để ý trong log:

- `outbox_pending_count` tăng dần → relay chết, event không được phát
- `TẠO INDEX THẤT BẠI` → ràng buộc schema không được thực thi
- Jaeger trống → tracing tắt, mất khả năng lần vết

**Trước khi hỏi "sao không chạy", kiểm tra 3 thứ:**

1. `docker compose -f infra/docker-compose.yml ps` — container healthy chưa?
2. `curl localhost:4000/health/ready` — service sống chưa?
3. Cửa sổ chạy `pnpm dev:ping` có báo lỗi gì không?

**`pnpm infra:reset` là an toàn.** Nó xoá dữ liệu dev, mà dữ liệu dev dựng lại được bằng `pnpm db:seed`. Khi bí, đừng ngại dùng.
