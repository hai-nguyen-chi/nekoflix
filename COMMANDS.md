# Sổ tay lệnh

Mở file này khi quên lệnh hoặc khi có gì đó hỏng.

- Setup & start từng bước → [RUN.md](RUN.md)
- Quy trình nhánh / PR / phát hành → [docs/17-git-workflow.md](docs/17-git-workflow.md)
- Lần đầu cài máy mới, chưa có Docker → [GETTING-STARTED.md](GETTING-STARTED.md)
- Code chạy ra sao → [docs/15-code-walkthrough.md](docs/15-code-walkthrough.md)
- Phase 0 có gì (tài liệu lịch sử) → [PHASE-0.md](PHASE-0.md)

---

## 1. Hằng ngày

### Bắt đầu buổi làm việc

```bash
pnpm infra:up          # bật MongoDB, Redis, NATS, SeaweedFS, Jaeger, Mailpit
pnpm dev:auth          # chạy service — ĐỂ NGUYÊN cửa sổ này
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

### Quy trình chuẩn — KHÔNG đồng bộ database

```bash
# ── Máy A, trước khi rời ──
git add -A && git commit -m "feat: ..."
git push -u origin feat/<tên-nhánh>     # đẩy cả nhánh dở dang cũng không sao

# ── Máy B ──
git fetch
git checkout feat/<tên-nhánh>
pnpm install           # nếu package.json đổi
pnpm build
pnpm infra:up
pnpm dev:auth
```

Làm việc trên **nhánh riêng**, không phải `develop` — nhờ vậy đẩy code dở dang
lên cũng không ảnh hưởng máy kia. Xem [docs/17](docs/17-git-workflow.md).

Tài khoản đã tạo ở máy A **không có** ở máy B. Đăng ký lại một tài khoản mới qua
giao diện web, mất 30 giây.

> Nguyên tắc: **code đi theo Git, dữ liệu dev tạo lại tại chỗ.** Đừng coi database dev là thứ phải nâng niu — nó là thứ vứt đi và tạo lại được.

`pnpm db:seed` hiện **không tạo gì cả** (mảng seed đang trống). Luồng đăng ký phải
phát event và gửi email xác thực, nên chèn thẳng tài khoản vào MongoDB sẽ cho ra
tài khoản không giống tài khoản thật. Seed sẽ có ích từ Phase 2, khi cần hàng trăm
bản ghi phim mà không ai muốn nhập tay.

### Khi có dữ liệu tạo tay cần mang theo

Dùng khi bạn đã tạo nhiều dữ liệu bằng tay và không muốn làm lại.

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

|                                  | Cách xử lý ở máy mới                            |
| -------------------------------- | ----------------------------------------------- |
| `node_modules/`                  | `pnpm install`                                  |
| `dist/`                          | `pnpm build`                                    |
| **`.env`**                       | `cp .env.example .env` **+ `pnpm gen:secrets`** |
| **`apps/web/.env`**              | tuỳ chọn — mặc định đã đúng                     |
| Dữ liệu MongoDB                  | đăng ký lại tài khoản                           |
| Dữ liệu Redis / NATS / SeaweedFS | tự sinh lại                                     |

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
| `pnpm gen:secrets`              | Sinh khoá RSA ký JWT vào `.env` (máy mới)      |
| `pnpm build`                    | Dịch TypeScript → JavaScript                   |
| `pnpm dev`                      | Chạy **tất cả** service                        |
| `pnpm dev:auth`                 | gateway + identity + notification + web        |
| `pnpm lint`                     | Kiểm tra quy tắc code + **rào chắn kiến trúc** |
| `pnpm typecheck`                | Kiểm tra lỗi kiểu dữ liệu                      |
| `pnpm format`                   | Tự sửa định dạng                               |
| `pnpm new:service <tên> <cổng>` | Tạo service mới theo khuôn chuẩn               |

### Git

| Lệnh                                                                      | Làm gì                     |
| ------------------------------------------------------------------------- | -------------------------- |
| `git checkout develop && git pull && git checkout -b feat/x`              | Bắt đầu tính năng mới      |
| `git checkout develop && git pull && git checkout - && git merge develop` | Đồng bộ nhánh đang làm     |
| `git fetch --prune`                                                       | Dọn nhánh remote đã bị xoá |
| `git branch -d feat/x && git push origin --delete feat/x`                 | Xoá nhánh đã merge         |

Đưa lên staging, phát hành, hotfix: xem [docs/17 §7](docs/17-git-workflow.md).

### Database

| Lệnh                      | Làm gì                                       |
| ------------------------- | -------------------------------------------- |
| `pnpm db:seed`            | Sinh dữ liệu mẫu — **hiện chưa có seed nào** |
| `pnpm db:seed -- --reset` | Xoá dữ liệu cũ rồi seed lại                  |
| `pnpm db:export`          | Xuất ra `.data/`                             |
| `pnpm db:import`          | Nhập bản mới nhất                            |
| `pnpm db:list`            | Liệt kê bản đã xuất                          |

### Kiểm thử

| Lệnh                      | Cần gì                               |
| ------------------------- | ------------------------------------ |
| `pnpm test`               | Không cần hạ tầng                    |
| `pnpm ci:local`           | Chạy đúng chuỗi lệnh của CI          |
| `pnpm smoke`              | Cần hạ tầng **và** service đang chạy |
| `pnpm verify:idempotency` | Cần hạ tầng **và** service đang chạy |

`pnpm test` bao gồm **contract test**: event mà identity-service phát ra có khớp
schema trong `packages/contracts` không, và notification-service có xử lý được
fixture chuẩn không. Hai bên không chạy cùng nhau — ràng buộc chung là schema.

Khi cố ý sửa schema và đã xử lý cả hai phía, cập nhật snapshot tương thích ngược:

```bash
UPDATE_CONTRACT_SNAPSHOT=1 pnpm --filter @nekoflix/contracts test
```

Commit `packages/contracts/test/snapshots/*.json` cùng thay đổi schema — diff của
snapshot chính là thứ cần nhìn khi review.

---

## 4. Các trang web

| Địa chỉ                | Dùng để                                                 |
| ---------------------- | ------------------------------------------------------- |
| http://localhost:4000  | API chính (gateway)                                     |
| http://localhost:16686 | **Jaeger** — xem request đi qua service nào, chậm ở đâu |
| http://localhost:8081  | **Mongo Express** — xem dữ liệu trong database          |
| http://localhost:8222  | NATS — xem stream và consumer                           |
| http://localhost:9001  | SeaweedFS — nơi sẽ lưu video                            |
| http://localhost:8025  | **Mailpit** — mọi email hệ thống gửi đi hiện ở đây      |
| http://localhost:5173  | Giao diện web (Vite dev server)                         |

---

## 5. Kiểm tra nhanh khi nghi có vấn đề

```bash
# Container nào đang chạy, có healthy không?
docker compose -f infra/docker-compose.yml ps

# Service có sống không?
curl localhost:4000/health/ready    # gateway
curl localhost:4001/health/ready    # identity-service
curl localhost:4007/health/ready    # notification-service

# Xem dữ liệu trong MongoDB
docker exec nekoflix-mongo mongosh -u root -p rootpassword \
  --authenticationDatabase admin --quiet \
  --eval 'db.getSiblingDB("nekoflix_identity").users.find().limit(5)'

# Kiểm tra ranh giới service CÓ được ép không (phải trả Unauthorized)
docker exec nekoflix-mongo mongosh -u identity_svc -p devpassword \
  --authenticationDatabase admin --quiet \
  --eval 'db.getSiblingDB("nekoflix_notification").emailoutboxes.countDocuments()'
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

# 5. Làm lại từ đầu (XOÁ SẠCH dữ liệu — an toàn, đăng ký lại là xong)
pnpm infra:reset && pnpm infra:up
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
| `pnpm smoke` báo không chạy được                        | Service chưa chạy                      | Cửa sổ khác phải đang `pnpm dev:auth`            |
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
  --eval 'db.getSiblingDB("nekoflix_identity").outbox.getIndexes()'

# Xoá index cũ
docker exec nekoflix-mongo mongosh -u root -p rootpassword \
  --authenticationDatabase admin --quiet \
  --eval 'db.getSiblingDB("nekoflix_identity").outbox.dropIndex("ten_index_cu")'
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

**Mỗi service một database riêng.** `identity-service` chỉ đọc được `nekoflix_identity`. Thử đọc database khác sẽ bị MongoDB từ chối — đó là chủ đích, không phải lỗi.

**Lỗi im lặng nguy hiểm hơn lỗi ồn ào.** Ba thứ cần để ý trong log:

- `outbox_pending_count` tăng dần → relay chết, event không được phát
- `TẠO INDEX THẤT BẠI` → ràng buộc schema không được thực thi
- Jaeger trống → tracing tắt, mất khả năng lần vết

**Trước khi hỏi "sao không chạy", kiểm tra 3 thứ:**

1. `docker compose -f infra/docker-compose.yml ps` — container healthy chưa?
2. `curl localhost:4000/health/ready` — service sống chưa?
3. Cửa sổ chạy `pnpm dev:auth` có báo lỗi gì không?

**`pnpm infra:reset` là an toàn.** Nó xoá dữ liệu dev, mà dữ liệu dev dựng lại được bằng `pnpm db:seed`. Khi bí, đừng ngại dùng.
