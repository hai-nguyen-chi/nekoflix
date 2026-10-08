# Sổ tay lệnh

Mở file này khi quên lệnh hoặc khi có gì đó hỏng.

- Setup & start từng bước → [RUN.md](RUN.md)
- Quy trình nhánh / PR / phát hành → [docs/17-git-workflow.md](docs/17-git-workflow.md)
- Lần đầu cài máy mới, chưa có Docker → [GETTING-STARTED.md](GETTING-STARTED.md)
- Code chạy ra sao → [docs/15-code-walkthrough.md](docs/15-code-walkthrough.md)
- Phase 0 có gì (tài liệu lịch sử) → [PHASE-0.md](PHASE-0.md)

---

## 0. Mười lệnh dùng nhiều nhất

```bash
pnpm progress                    # feature nào xong / đang làm / chưa làm
pnpm infra:up                    # bật hạ tầng Docker
pnpm dev:auth                    # chạy app (để nguyên cửa sổ)   -> localhost:5173
pnpm ci:local                    # chạy đúng chuỗi lệnh của CI   (gõ trước khi push)
pnpm test                        # test, không cần hạ tầng
pnpm smoke                       # kiểm chứng trên hạ tầng thật
pnpm build                       # dịch TypeScript
pnpm format                      # tự sửa định dạng
pnpm infra:down                  # tắt container, giữ dữ liệu
pnpm infra:reset                 # tắt + XOÁ SẠCH dữ liệu

git checkout develop && git pull && git checkout -b feat/<tên>
```

---

## 1. Hằng ngày

### Bắt đầu buổi làm việc

```bash
pnpm infra:up          # MongoDB, Redis, NATS, SeaweedFS, Jaeger, Mailpit
pnpm dev:auth          # chạy service — ĐỂ NGUYÊN cửa sổ này
```

Cửa sổ thứ hai để gõ lệnh khác (`curl`, `pnpm smoke`, git...).

**Web lên sau ~5 giây, backend sau ~60 giây.** Mở web sớm thì trang hiện ra nhưng
đăng nhập báo lỗi mạng — chờ đủ ba dòng "đã sẵn sàng".

### Kết thúc

```bash
# Ctrl+C ở cửa sổ đang chạy service
pnpm infra:down        # tắt container, GIỮ NGUYÊN dữ liệu
```

Không tắt cũng không sao — Docker tự thu hồi RAM khi container rảnh.

---

## 2. Git — ba nhánh môi trường

Chi tiết và lý do: [docs/17](docs/17-git-workflow.md). Đây là phần tra nhanh.

```
feat/*  →  develop  →  staging  →  master
```

`develop`, `staging`, `master` **không push thẳng được** — ruleset chặn. Mọi thay
đổi đi qua Pull Request.

### Làm một tính năng

```bash
git checkout develop && git pull
git checkout -b feat/catalog-service

# ... code ...

pnpm ci:local                              # BẮT BUỘC trước khi push
git push -u origin feat/catalog-service
# rồi mở PR trên GitHub, base = develop
```

Tiền tố nhánh (CI chặn nếu sai): `feat/` `fix/` `refactor/` `chore/` `docs/` `test/`

### Đồng bộ nhánh đang làm với develop

```bash
git checkout develop && git pull
git checkout -
git merge develop        # KHÔNG rebase nếu nhánh đã push
```

### Đưa lên staging / phát hành

Làm **trên GitHub** bằng PR, chọn **"Create a merge commit"** (không squash):

| Bước      | base      | compare   |
| --------- | --------- | --------- |
| Lên QC    | `staging` | `develop` |
| Phát hành | `master`  | `staging` |

Rồi gắn tag ở máy:

```bash
git checkout master && git pull
git tag -a v0.2.0 -m "Phase 2: catalog-service"
git push origin v0.2.0          # tag KHÔNG bị ruleset chặn
```

### Sau hotfix — đừng quên back-merge

Hai PR nữa, nếu không bug sống lại ở lần phát hành sau:

| base      | compare   |
| --------- | --------- |
| `staging` | `master`  |
| `develop` | `staging` |

### Dọn dẹp

```bash
git branch -d feat/x && git push origin --delete feat/x   # xoá nhánh đã merge
git fetch --prune                                          # dọn nhánh remote đã mất
git branch -vv                                             # xem nhánh theo dõi nhánh nào
git log --oneline --graph --all -15                        # xem cây nhánh
```

### Kiểm tra ruleset có thật sự chặn không

```bash
git checkout develop && git pull
echo "# thử" >> README.md
git commit -am "test: thử push thẳng" && git push
# PHẢI nhận: ! [remote rejected] develop (protected branch hook declined)

git reset --hard origin/develop        # dọn lại
```

---

## 3. Làm việc trên 2 máy

```bash
# ── Máy A, trước khi rời ──
git add -A && git commit -m "wip: ..."
git push -u origin feat/<tên-nhánh>     # đẩy cả nhánh dở dang cũng không sao

# ── Máy B ──
git fetch
git checkout feat/<tên-nhánh>
pnpm install           # nếu package.json đổi
pnpm build
pnpm infra:up
pnpm dev:auth
```

Làm trên **nhánh riêng**, không phải `develop` — nhờ vậy đẩy code dở dang lên cũng
không ảnh hưởng máy kia.

### Những gì KHÔNG đi theo Git

|                                  | Cách xử lý ở máy mới                            |
| -------------------------------- | ----------------------------------------------- |
| `node_modules/`                  | `pnpm install`                                  |
| `dist/`                          | `pnpm build`                                    |
| **`.env`**                       | `cp .env.example .env` **+ `pnpm gen:secrets`** |
| **`apps/web/.env`**              | tuỳ chọn — mặc định đã đúng                     |
| Dữ liệu MongoDB                  | đăng ký lại tài khoản qua giao diện web         |
| Dữ liệu Redis / NATS / SeaweedFS | tự sinh lại                                     |

> Nguyên tắc: **code đi theo Git, dữ liệu dev tạo lại tại chỗ.** Database dev là
> thứ vứt đi và tạo lại được, đừng nâng niu.

`pnpm db:seed` hiện **không tạo gì cả** (mảng seed đang trống). Luồng đăng ký phải
phát event và gửi email xác thực, nên chèn thẳng tài khoản vào MongoDB sẽ cho ra
tài khoản không giống tài khoản thật. Seed sẽ có ích từ Phase 2, khi cần hàng trăm
bản ghi phim.

### Khi thật sự cần mang dữ liệu theo

```bash
# ── Máy A ──
pnpm db:export         # -> .data/nekoflix-<ngày>.gz
# copy file .gz qua Google Drive / USB

# ── Máy B ──
pnpm infra:up
pnpm db:import         # nhập bản mới nhất
pnpm db:list           # xem các bản đã có
```

`.data/` đã gitignore. **Đừng commit file dump** — nhị phân, phình nhanh, có thể
chứa dữ liệu nhạy cảm.

---

## 4. Toàn bộ lệnh

### Hạ tầng (Docker)

| Lệnh               | Làm gì                                            |
| ------------------ | ------------------------------------------------- |
| `pnpm infra:up`    | Bật tất cả container                              |
| `pnpm infra:down`  | Tắt, **giữ** dữ liệu                              |
| `pnpm infra:reset` | Tắt + **XOÁ SẠCH** dữ liệu, về trạng thái ban đầu |
| `pnpm infra:logs`  | Xem log hạ tầng (Ctrl+C để thoát)                 |

### Code

| Lệnh                            | Làm gì                                    |
| ------------------------------- | ----------------------------------------- |
| `pnpm install`                  | Cài thư viện                              |
| `pnpm gen:secrets`              | Sinh khoá RSA ký JWT vào `.env` (máy mới) |
| `pnpm build`                    | Dịch TypeScript → JavaScript              |
| `pnpm dev`                      | Chạy **tất cả** service                   |
| `pnpm dev:auth`                 | gateway + identity + notification + web   |
| `pnpm dev:identity`             | Chỉ gateway + identity (nhẹ hơn)          |
| `pnpm lint`                     | Quy tắc code + **rào chắn kiến trúc**     |
| `pnpm typecheck`                | Lỗi kiểu dữ liệu                          |
| `pnpm format`                   | Tự sửa định dạng                          |
| `pnpm format:check`             | Chỉ kiểm, không sửa (CI dùng cái này)     |
| `pnpm new:service <tên> <cổng>` | Tạo service mới theo khuôn chuẩn          |

### Chạy cho một package riêng

```bash
pnpm --filter identity-service test        # chỉ test identity
pnpm --filter @nekoflix/contracts build    # chỉ build contracts
pnpm --filter web dev                      # chỉ chạy frontend
pnpm --filter @nekoflix/contracts test:watch  # chỉ contracts + service-kit có
```

Tên để sau `--filter` là `name` trong `package.json`: `gateway`,
`identity-service`, `notification-service`, `web`, `@nekoflix/contracts`,
`@nekoflix/service-kit`.

### Kiểm thử

| Lệnh                      | Cần gì                               | Mất bao lâu |
| ------------------------- | ------------------------------------ | ----------- |
| `pnpm test`               | Không cần hạ tầng                    | ~40s        |
| `pnpm ci:local`           | Không cần hạ tầng                    | ~2 phút     |
| `pnpm smoke`              | Cần hạ tầng **và** service đang chạy | ~75s        |
| `pnpm verify:idempotency` | Cần hạ tầng **và** service đang chạy | ~12s        |

> **Turbo có cache.** Chạy lại khi code không đổi thì `pnpm test` xong trong 1
> giây và in `FULL TURBO` — không phải nó bỏ qua test, mà kết quả cũ vẫn còn giá
> trị. Muốn ép chạy thật: `npx turbo run test --force`.
>
> `pnpm smoke` mất ~75s vì có một bước **cố ý chờ 11.5 giây** cho hết grace
> period của refresh token, cộng thời gian đợi email đi qua JetStream và SMTP.

**`pnpm ci:local` chạy đúng chuỗi lệnh của job CI**, kể cả
`pnpm install --frozen-lockfile`. Gõ nó trước khi push thì gần như chắc chắn CI
xanh. `pnpm test` một mình KHÔNG đủ: nó không chạm tới lockfile, nên không bắt
được lỗi lockfile lệch workspace.

### Contract test và snapshot

`pnpm test` bao gồm **contract test**: event identity-service phát ra có khớp
schema trong `packages/contracts` không, và notification-service có xử lý được
fixture chuẩn không.

Khi **cố ý** sửa schema và đã xử lý cả hai phía:

```bash
UPDATE_CONTRACT_SNAPSHOT=1 pnpm --filter @nekoflix/contracts test
```

Commit `packages/contracts/test/snapshots/*.json` **cùng PR** với thay đổi schema
— diff của snapshot chính là thứ người review cần nhìn.

### Tiến độ

| Lệnh            | Làm gì                                                 |
| --------------- | ------------------------------------------------------ |
| `pnpm progress` | Feature nào xong / đang làm / chưa làm, và làm gì tiếp |

Trạng thái nằm ở cột **Xong** trong bảng feature của
[docs/11-roadmap.md](docs/11-roadmap.md). Merge xong một feature thì đổi ⬜ thành ✅
ở đó; đang làm dở thì để 🔄.

Script chỉ tổng hợp lại và chỉ ra việc kế tiếp — nó không tự đoán.

### Database

| Lệnh                      | Làm gì                                       |
| ------------------------- | -------------------------------------------- |
| `pnpm db:seed`            | Sinh dữ liệu mẫu — **hiện chưa có seed nào** |
| `pnpm db:seed -- --reset` | Xoá dữ liệu cũ rồi seed lại                  |
| `pnpm db:export`          | Xuất ra `.data/`                             |
| `pnpm db:import`          | Nhập bản mới nhất                            |
| `pnpm db:list`            | Liệt kê bản đã xuất                          |

---

## 5. Các trang web

| Địa chỉ                | Dùng để                                                 |
| ---------------------- | ------------------------------------------------------- |
| http://localhost:5173  | **Giao diện web** — đây là app                          |
| http://localhost:8025  | **Mailpit** — mọi email hệ thống gửi đi                 |
| http://localhost:16686 | **Jaeger** — xem request đi qua service nào, chậm ở đâu |
| http://localhost:8081  | **Mongo Express** — xem dữ liệu trong database          |
| http://localhost:4000  | API chính (gateway) — gọi bằng `curl`                   |
| http://localhost:8222  | NATS — xem stream và consumer                           |
| http://localhost:9001  | SeaweedFS — nơi sẽ lưu video                            |

---

## 6. Kiểm tra nhanh khi nghi có vấn đề

```bash
# Container nào đang chạy, có healthy không?
docker compose -f infra/docker-compose.yml ps

# Service có sống không?
curl localhost:4000/health/ready    # gateway
curl localhost:4001/health/ready    # identity-service
curl localhost:4007/health/ready    # notification-service
```

### Thử API bằng tay

```bash
# Đăng ký -> email xác thực sẽ hiện ở Mailpit
curl -X POST localhost:4000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"thu@nekoflix.local","password":"Matkhau123","displayName":"Thu Nghiem"}'

# Đăng nhập
curl -X POST localhost:4000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"thu@nekoflix.local","password":"Matkhau123"}'

# Gọi API cần đăng nhập
curl localhost:4000/v1/profiles -H "Authorization: Bearer <accessToken>"
```

### Đọc email trong Mailpit bằng lệnh

```bash
# Danh sách email gần nhất
curl -s localhost:8025/api/v1/messages?limit=10

# Tìm theo người nhận
curl -s "localhost:8025/api/v1/search?query=to%3Athu%40nekoflix.local"

# Xoá sạch hộp thư
curl -X DELETE localhost:8025/api/v1/messages
```

### Xem dữ liệu trong MongoDB

```bash
docker exec nekoflix-mongo mongosh -u root -p rootpassword \
  --authenticationDatabase admin --quiet \
  --eval 'db.getSiblingDB("nekoflix_identity").users.find().limit(5)'

# Liệt kê collection và số bản ghi
docker exec nekoflix-mongo mongosh -u root -p rootpassword \
  --authenticationDatabase admin --quiet \
  --eval 'const d=db.getSiblingDB("nekoflix_identity"); d.getCollectionNames().forEach(n=>print(n, d[n].countDocuments()))'

# Kiểm tra ranh giới service CÓ được ép không (phải trả Unauthorized)
docker exec nekoflix-mongo mongosh -u identity_svc -p devpassword \
  --authenticationDatabase admin --quiet \
  --eval 'db.getSiblingDB("nekoflix_notification").emailoutboxes.countDocuments()'
```

---

## 7. Khi có lỗi

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

Bước 5 an toàn vì dữ liệu dev dựng lại được. Nếu có dữ liệu tay cần giữ,
`pnpm db:export` trước.

### Bảng lỗi thường gặp

| Thông báo                                               | Nguyên nhân                            | Cách sửa                                      |
| ------------------------------------------------------- | -------------------------------------- | --------------------------------------------- |
| `docker: command not found`                             | Docker Desktop chưa mở                 | Mở app, chờ chấm xanh, mở **terminal mới**    |
| `error during connect... docker_engine`                 | Docker chưa khởi động xong             | Chờ "Engine running"                          |
| `Không kết nối được NATS`                               | Chưa bật hạ tầng                       | `pnpm infra:up`                               |
| `Unable to connect to the database. Retrying`           | MongoDB chưa sẵn sàng                  | Chờ 10–20 giây, tự thử lại                    |
| `MongoServerError: Authentication failed`               | Đổi mật khẩu sau khi tạo user          | `pnpm infra:reset && pnpm infra:up`           |
| `Transaction numbers are only allowed on a replica set` | MongoDB không chạy replica set         | `pnpm infra:reset && pnpm infra:up`           |
| `EADDRINUSE :4000`                                      | Lần chạy trước chưa tắt hẳn            | Xem "Cổng bị chiếm" bên dưới                  |
| `Cannot find module '@nekoflix/contracts'`              | Chưa build package dùng chung          | `pnpm build`                                  |
| `JWT_PRIVATE_KEY` thiếu, identity không start           | Quên `pnpm gen:secrets`                | `pnpm gen:secrets`                            |
| `E11000 duplicate key ... dup key: { id: null }`        | Index cũ còn sót sau khi đổi tên field | Xem "Index cũ" bên dưới                       |
| Web mở được nhưng đăng nhập lỗi mạng                    | Backend chưa compile xong              | Chờ đủ 3 dòng "đã sẵn sàng" (~60s)            |
| `pnpm smoke` báo không chạy được                        | Service chưa chạy                      | Cửa sổ khác phải đang `pnpm dev:auth`         |
| `pnpm lint` báo `import is restricted`                  | Service import service khác            | Đúng ý đồ — dùng `RpcClient` hoặc `@OnEvent`  |
| Jaeger trống trơn                                       | `.env` thiếu `OTEL_..._ENDPOINT`       | `cp .env.example .env`, khởi động lại service |
| CI đỏ ở `pnpm install --frozen-lockfile`                | Lockfile lệch workspace                | Xem "Lockfile lệch" bên dưới                  |

### Lockfile lệch

Xảy ra khi thêm/xoá/đổi tên một workspace mà quên chạy lại `pnpm install`. Ở máy
không ai thấy, vì `node_modules` đã có sẵn và `pnpm install` thường ngày tự sửa
lockfile trong im lặng. Chỉ `--frozen-lockfile` mới từ chối — mà chỉ CI dùng cờ đó.

```bash
pnpm install                        # sinh lại lockfile
pnpm install --frozen-lockfile      # phải báo "Lockfile is up to date"
git add pnpm-lock.yaml
```

Phòng từ đầu: gõ `pnpm ci:local` trước khi push.

### Cổng bị chiếm

```bash
netstat -ano | findstr :4000       # tìm PID đang giữ cổng (hoặc :5173)
taskkill /PID <số> /F

# Hoặc tắt hết tiến trình node (cẩn thận: tắt MỌI app Node)
taskkill /F /IM node.exe
```

### Index cũ còn sót

Xảy ra khi đổi tên field trong schema: Mongoose tạo index mới nhưng **không bao
giờ xoá index cũ**.

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

Nhanh nhất khi dữ liệu không quan trọng: `pnpm infra:reset && pnpm infra:up`.

> Từ Phase 0 đã có `IndexGuard` log `ERROR` khi tạo index thất bại. **Để ý dòng
> đó trong log** — nó nghĩa là một ràng buộc trong schema đang KHÔNG được thực thi.

### Docker chậm trên Windows

```bash
docker system prune -a        # dọn image/container không dùng
wsl --shutdown                # khởi động lại WSL, rồi mở lại Docker Desktop
```

---

## 8. Những điều nên nhớ

**Mỗi service một database riêng.** `identity-service` chỉ đọc được
`nekoflix_identity`. Thử đọc database khác sẽ bị MongoDB từ chối — đó là chủ đích,
không phải lỗi.

**Lỗi im lặng nguy hiểm hơn lỗi ồn ào.** Ba thứ cần để ý trong log:

- `outbox_pending_count` tăng dần → relay chết, event không được phát
- `TẠO INDEX THẤT BẠI` → ràng buộc schema không được thực thi
- Jaeger trống → tracing tắt, mất khả năng lần vết

**Trước khi hỏi "sao không chạy", kiểm tra 3 thứ:**

1. `docker compose -f infra/docker-compose.yml ps` — container healthy chưa?
2. `curl localhost:4000/health/ready` — service sống chưa?
3. Cửa sổ chạy `pnpm dev:auth` có báo lỗi gì không?

**`pnpm infra:reset` là an toàn.** Nó xoá dữ liệu dev, mà dữ liệu dev dựng lại
được bằng cách đăng ký lại tài khoản. Khi bí, đừng ngại dùng.

**Gõ `pnpm ci:local` trước khi push.** Rẻ hơn nhiều so với đợi CI đỏ rồi sửa.
