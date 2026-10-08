# 17 — Quy trình Git

Ba nhánh môi trường, tính năng đi lên theo bậc.

```
feat/catalog-service ──●──●──┐
                             │ PR (squash)
develop ──────────●──────────●──────●────────►   QC test ở đây
                                     │
                                     │ PR (merge commit)
staging ─────────────────────────────●────●──►   bản ứng viên
                                           │
                                           │ PR (merge commit)
master ────────────────────────────────────●──►  đang chạy thật
                                           │
                                          tag v0.2.0
```

| Nhánh     | Chứa gì                             | Ai đụng vào                           |
| --------- | ----------------------------------- | ------------------------------------- |
| `develop` | Tính năng đã xong, chờ QC           | Mọi nhánh `feat/*`, `fix/*` gộp vào   |
| `staging` | Tập tính năng chuẩn bị phát hành    | Chỉ nhận từ `develop`                 |
| `master`  | Đang phát hành, người dùng đang xài | Chỉ nhận từ `staging` hoặc `hotfix/*` |

**Không nhánh nào trong ba nhánh này được push thẳng.** Mọi thay đổi vào qua Pull Request.

---

## 1. Làm một tính năng

```bash
# LUÔN cắt từ develop, và luôn kéo mới trước
git checkout develop
git pull

git checkout -b feat/catalog-service
```

Tiền tố quyết định nhánh được merge vào đâu — CI chặn nếu sai:

| Tiền tố     | Dùng khi            |
| ----------- | ------------------- |
| `feat/`     | Tính năng mới       |
| `fix/`      | Sửa lỗi             |
| `refactor/` | Đổi cấu trúc code   |
| `chore/`    | Build, cấu hình, CI |
| `docs/`     | Chỉ tài liệu        |
| `test/`     | Chỉ test            |

Làm xong:

```bash
pnpm lint && pnpm typecheck && pnpm test
git push -u origin feat/catalog-service
```

Rồi mở PR trên GitHub, **base là `develop`**.

### Nhánh sống lâu thì phải đồng bộ

Nhánh để cả tuần sẽ lệch xa `develop`, và lúc merge mới phát hiện xung đột chồng chất:

```bash
git checkout develop && git pull
git checkout feat/catalog-service
git merge develop          # KHÔNG rebase — xem §5
```

---

## 2. Đưa lên staging (chuẩn bị phát hành)

```bash
git checkout staging && git pull
git merge --no-ff develop
git push
```

Hoặc mở PR `develop` → `staging` trên GitHub, chọn **"Create a merge commit"**.

> **TUYỆT ĐỐI không dùng "Squash and merge" cho PR này.** Lý do ở §5 — đây là
> cái bẫy làm hỏng GitFlow nhiều nhất.

Từ lúc này `staging` là **bản ứng viên phát hành**. Tính năng mới vẫn chảy vào
`develop` bình thường, không ảnh hưởng tới bản đang kiểm.

Lỗi phát hiện lúc kiểm trên staging: sửa bằng nhánh `fix/*` cắt từ `develop`, rồi
lại merge `develop` → `staging`.

---

## 3. Phát hành

```bash
git checkout master && git pull
git merge --no-ff staging
git tag -a v0.2.0 -m "Phase 1: identity, multi-profile, OAuth"
git push --follow-tags
```

`--follow-tags` đẩy cả commit lẫn tag. Đẩy riêng `git push` thì tag nằm lại trên
máy, và lịch sử phát hành trên GitHub trống trơn.

Tag theo [semver](https://semver.org/lang/vi/): `v<major>.<minor>.<patch>`.

| Tăng số nào | Khi                                      |
| ----------- | ---------------------------------------- |
| `major`     | Phá vỡ tương thích (API, hợp đồng event) |
| `minor`     | Thêm tính năng, vẫn tương thích ngược    |
| `patch`     | Chỉ sửa lỗi                              |

---

## 4. Hotfix — sửa khẩn trên bản đang chạy

Lỗi nghiêm trọng ở `master` mà `staging` đang dở dang, không chờ được.

```bash
git checkout master && git pull
git checkout -b hotfix/refresh-token-500
# ... sửa ...
git push -u origin hotfix/refresh-token-500
```

PR vào `master`, merge, tag `v0.2.1`.

### Rồi BẮT BUỘC đưa ngược xuống

```bash
git checkout staging && git pull && git merge master && git push
git checkout develop && git pull && git merge staging && git push
```

**Bỏ bước này là bug sống lại.** `develop` vẫn chứa code cũ còn lỗi; lần phát hành
sau nó leo lên `master` và ghi đè bản vá. Triệu chứng kinh điển: "sao lỗi này đã
sửa rồi mà quay lại?".

---

## 5. Hai cái bẫy im lặng

### 5.1 Squash khi merge giữa ba nhánh môi trường

Squash tạo ra **một commit MỚI với SHA khác**, không phải commit đã có trên nhánh
nguồn. Git không còn biết `staging` đã chứa những gì của `develop`.

```
develop  ──A──B──C
                  ╲  squash
staging  ──────────S          S có nội dung A+B+C, nhưng SHA hoàn toàn mới
```

Lần merge sau, Git so từ tổ tiên chung — vẫn là điểm trước A — nên **A, B, C hiện
lại trong diff**. Càng merge càng rối, xung đột ở những dòng đã xử lý từ lâu.

| Hướng merge                      | Cách merge                            |
| -------------------------------- | ------------------------------------- |
| `feat/*` → `develop`             | **Squash** — một tính năng một commit |
| `develop` → `staging` → `master` | **Merge commit** (`--no-ff`)          |

Squash ở tầng dưới thì an toàn, vì nhánh `feat/*` bị xoá ngay sau đó, không ai
merge từ nó nữa.

### 5.2 Rebase nhánh đã push

```bash
git rebase develop     # ❌ nếu nhánh đã push lên GitHub
```

Rebase viết lại lịch sử. Nhánh đã push thì phải `--force`, và bạn đang làm việc
trên **hai máy** — máy kia còn giữ bản cũ, `git pull` ở đó sẽ trộn hai lịch sử
thành một mớ trùng lặp.

Dùng `git merge develop` thay thế. Lịch sử có thêm merge commit, nhưng nó phản ánh
đúng chuyện đã xảy ra.

---

## 6. Làm việc trên 2 máy

Điểm khác so với trước: **xuất phát từ `develop`, không phải `master`**.

```bash
# ── Máy A, trước khi rời ──
git push -u origin feat/catalog-service     # đẩy cả nhánh dở dang cũng không sao

# ── Máy B ──
git fetch
git checkout feat/catalog-service
pnpm install && pnpm build
```

Nhánh dở dang đẩy lên thoải mái — đó chính là lý do có nhánh riêng. `develop` vẫn
xanh, máy kia không bị ảnh hưởng.

Nếu lỡ commit nửa vời, ghi rõ trong message:

```bash
git commit -m "wip: catalog schema, chưa chạy được"
```

Trước khi mở PR thì dọn lại:

```bash
git rebase -i develop     # ✅ được, vì nhánh feat/* chỉ mình bạn dùng
```

---

## 7. Bảng tra nhanh

```bash
# Bắt đầu tính năng
git checkout develop && git pull && git checkout -b feat/<tên>

# Đồng bộ nhánh đang làm với develop
git checkout develop && git pull && git checkout - && git merge develop

# Đưa develop lên staging
git checkout staging && git pull && git merge --no-ff develop && git push

# Phát hành
git checkout master && git pull && git merge --no-ff staging
git tag -a v0.2.0 -m "..." && git push --follow-tags

# Sau hotfix — ĐỪNG QUÊN
git checkout staging && git merge master && git push
git checkout develop && git merge staging && git push

# Xoá nhánh đã merge (cả local lẫn remote)
git branch -d feat/<tên> && git push origin --delete feat/<tên>

# Dọn nhánh remote đã bị xoá khỏi danh sách local
git fetch --prune
```

---

## 8. Cần bật trên GitHub (không làm bằng lệnh được)

Vào **Settings → Branches → Add branch ruleset**, áp cho cả ba nhánh
`master`, `staging`, `develop`:

- ☑ **Require a pull request before merging** — chặn push thẳng
- ☑ **Require status checks to pass** → chọn `Lint · Typecheck · Build · Test`,
  `Smoke test (hạ tầng thật)`, `Hướng merge`
- ☑ **Require branches to be up to date before merging**
- ☑ **Block force pushes**

Và **Settings → General → Default branch** đổi sang `develop`. Mặc định là
`develop` chứ không phải `master`: nó làm PR tự nhắm đúng đích, và người lạ vào
repo thấy ngay nhánh đang phát triển.

> Dự án một người thì "require pull request" nghe thừa — nhưng nó chính là thứ
> biến quy trình từ thoả thuận với bản thân thành ràng buộc không lách được, kể
> cả lúc vội.

---

## 9. Ba nhánh này deploy đi đâu?

Hiện tại: **chưa đâu cả.** Theo [roadmap](11-roadmap.md), deploy nằm ở Phase 6.

Tới lúc đó, mỗi nhánh gắn với một **GitHub Environment** (Settings → Environments)
để có secret riêng và cổng duyệt riêng:

| Nhánh     | Environment   | Deploy tới                        |
| --------- | ------------- | --------------------------------- |
| `develop` | `development` | Cloudflare Pages preview          |
| `staging` | `staging`     | Cloudflare Pages + Tunnel staging |
| `master`  | `production`  | Domain thật, cần duyệt tay        |

Trước Phase 6, ba nhánh này là **ba bậc tin cậy**: mức độ chắc chắn rằng code
chạy đúng, chứ chưa phải ba máy chủ khác nhau.
