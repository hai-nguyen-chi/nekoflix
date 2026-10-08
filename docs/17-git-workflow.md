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
pnpm ci:local
git push -u origin feat/catalog-service
```

Rồi mở PR trên GitHub, **base là `develop`**.

`pnpm ci:local` chạy **đúng chuỗi lệnh của job CI**, kể cả
`pnpm install --frozen-lockfile`. Bước `--frozen-lockfile` là thứ `pnpm install`
thường ngày KHÔNG kiểm: nó bắt lỗi `pnpm-lock.yaml` lệch so với workspace — ví dụ
sau khi xoá hoặc đổi tên một service mà quên chạy lại `pnpm install`. Lệch kiểu đó
chạy ở máy vẫn bình thường vì `node_modules` đã có sẵn, nhưng CI cài từ đầu thì đỏ
ngay.

### Nhánh sống lâu thì phải đồng bộ

Nhánh để cả tuần sẽ lệch xa `develop`, và lúc merge mới phát hiện xung đột chồng chất:

```bash
git checkout develop && git pull
git checkout feat/catalog-service
git merge develop          # KHÔNG rebase — xem §5
```

---

## 2. Đưa lên staging (chuẩn bị phát hành)

Ba nhánh môi trường bị chặn push thẳng (§8), nên bước này làm **trên GitHub**:

1. **Pull requests → New pull request**
2. base = `staging`, compare = `develop`
3. Tiêu đề: `release: develop -> staging (<nội dung>)`
4. Chờ CI xanh → **Merge pull request** → chọn **"Create a merge commit"**

Rồi kéo về máy:

```bash
git checkout staging && git pull
```

> **TUYỆT ĐỐI không chọn "Squash and merge" cho PR này.** Lý do ở §5.1 — đây là
> cái bẫy làm hỏng GitFlow nhiều nhất. Nút đó nằm ngay cạnh nút đúng.

Từ lúc này `staging` là **bản ứng viên phát hành**. Tính năng mới vẫn chảy vào
`develop` bình thường, không ảnh hưởng tới bản đang kiểm.

Lỗi phát hiện lúc kiểm trên staging: sửa bằng nhánh `fix/*` cắt từ `develop`, rồi
lại merge `develop` → `staging`.

---

## 3. Phát hành

Trên GitHub: PR base = `master`, compare = `staging`, **"Create a merge commit"**.

Rồi gắn tag ở máy:

```bash
git checkout master && git pull
git tag -a v0.2.0 -m "Phase 1: identity, multi-profile, OAuth"
git push origin v0.2.0
```

Đẩy tag KHÔNG bị ruleset chặn — rule chỉ áp cho nhánh, không áp cho tag.

Quên `git push origin v0.2.0` thì tag nằm lại trên máy và trang Releases trên
GitHub trống trơn. Kiểm tra bằng `git ls-remote --tags origin`.

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

Hai PR nữa, cũng trên GitHub:

| #   | base      | compare   |
| --- | --------- | --------- |
| 1   | `staging` | `master`  |
| 2   | `develop` | `staging` |

Cả hai dùng **merge commit**, không squash.

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

# Đưa develop lên staging  -> PR trên GitHub (base staging, compare develop)
git checkout staging && git pull          # kéo về sau khi merge xong

# Phát hành  -> PR trên GitHub (base master, compare staging), rồi:
git checkout master && git pull
git tag -a v0.2.0 -m "..." && git push origin v0.2.0

# Sau hotfix — ĐỪNG QUÊN hai PR back-merge:
#   base staging  <- compare master
#   base develop  <- compare staging

# Xoá nhánh đã merge (cả local lẫn remote)
git branch -d feat/<tên> && git push origin --delete feat/<tên>

# Dọn nhánh remote đã bị xoá khỏi danh sách local
git fetch --prune
```

---

## 8. Ruleset trên GitHub

Quy trình ở các mục trên mới chỉ là thoả thuận. Ruleset biến nó thành **ràng buộc
không lách được** — kể cả lúc 11 giờ đêm và bạn chỉ muốn sửa một dòng cho xong.

Phần này phải bấm trên web, không có lệnh `git` tương đương.

### 8.1 Tạo ruleset

**Settings → Rules → Rulesets → New ruleset → New branch ruleset**

| Mục                | Đặt là                                      |
| ------------------ | ------------------------------------------- |
| Ruleset Name       | `Nhánh môi trường`                          |
| Enforcement status | **Active**                                  |
| Bypass list        | **ĐỂ TRỐNG**                                |
| Target branches    | `develop`, `staging`, `master` (thêm 3 lần) |

Ở **Target branches** bấm **Add target → Include by pattern**, gõ `develop`, Add.
Lặp lại cho `staging` và `master`.

> **`Enforcement status` để `Evaluate` thì ruleset chỉ ghi log, không chặn gì.**
> Đó là chế độ chạy thử. Phải là **Active**.

> **Bypass list để trống.** Thêm chính mình hoặc "Repository admin" vào đó là vô
> hiệu hoá toàn bộ ruleset đối với bạn — mà bạn lại là người duy nhất push. Lúc
> đó rule vẫn hiện màu xanh trong Settings nhưng không chặn gì cả.

### 8.2 Bật những rule này

- ☑ **Restrict deletions**
  → không ai xoá được `develop` / `staging` / `master`

- ☑ **Block force pushes**
  → không ai `--force` ghi đè lịch sử ba nhánh này

- ☑ **Require a pull request before merging**
  → **chặn push thẳng**. Mọi thay đổi phải qua PR.
  - **Required approvals: `0`** ← xem §8.3
  - ☐ Require review from Code Owners (repo chưa có `CODEOWNERS`)
  - ☑ Dismiss stale pull request approvals when new commits are pushed

- ☑ **Require status checks to pass**
  - ☑ Require branches to be up to date before merging
  - Thêm check: `Lint · Typecheck · Build · Test` và `Smoke test (hạ tầng thật)`
  - `Hướng merge` thêm sau — xem §8.4

### 8.3 Bẫy lớn nhất với dự án một người

**Required approvals phải là `0`.**

Đặt `1` thì GitHub yêu cầu một người KHÁC duyệt PR. Bạn không tự duyệt PR của
mình được. Repo một người + `1` approval = **không PR nào merge được bao giờ**, và
lối thoát duy nhất là tự cho mình vào bypass list — tức là tháo bỏ toàn bộ rule.

`0` vẫn giữ nguyên điều bạn cần: không push thẳng, phải qua PR, CI phải xanh.
Chỉ bỏ đi bước duyệt vốn không có ai thực hiện.

### 8.4 Thứ tự làm, để không bị kẹt

Check `Hướng merge` **chỉ chạy trên pull request**, nên tới giờ nó chưa chạy lần
nào và sẽ không hiện trong ô tìm kiếm status check.

1. Tạo ruleset như §8.1–8.2, tạm thời **chưa** thêm `Hướng merge`
2. Mở PR đầu tiên (`docs/*` → `develop`) — `Hướng merge` chạy lần đầu
3. Quay lại ruleset, thêm `Hướng merge` vào danh sách check bắt buộc

### 8.5 Những rule KHÔNG được bật

| Rule                       | Vì sao không                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| **Require linear history** | Cấm merge commit → phá vỡ `develop → staging → master`, vốn **bắt buộc** dùng merge commit (§5.1) |
| **Require signed commits** | Repo chưa cấu hình GPG/SSH signing → chặn sạch mọi commit                                         |
| **Restrict updates**       | Chặn cả thao tác merge PR, không chỉ push thẳng                                                   |
| **Restrict creations**     | Chặn luôn việc tạo nhánh `feat/*`                                                                 |

### 8.6 Kiểm tra rule có thật sự chặn không

Rule hiện màu xanh trong Settings không có nghĩa là nó đang chạy. Thử thật:

```bash
git checkout develop && git pull
echo "# thử" >> README.md
git commit -am "test: thử push thẳng" && git push
```

**Phải** nhận được:

```
! [remote rejected] develop -> develop (protected branch hook declined)
```

Nhận được như vậy là xong. Dọn lại:

```bash
git reset --hard origin/develop
```

Nếu push **thành công** thì ruleset chưa có tác dụng — kiểm tra lại ba thứ:
Enforcement status có phải `Active`, Bypass list có trống không, và Target
branches có đúng tên nhánh không.

Thử nốt rule xoá nhánh:

```bash
git push origin --delete staging
# phải nhận: [remote rejected] staging (refusing to delete ...)
```

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
