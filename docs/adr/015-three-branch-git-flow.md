# ADR-015: Ba nhánh môi trường develop / staging / master

**Trạng thái**: Accepted
**Ngày**: 2026-10-08

## Bối cảnh

Tới hết Phase 1, mọi commit được đẩy thẳng vào một nhánh duy nhất (`main`). Cách
đó chạy được vì dự án có một người, nhưng có ba vấn đề thật:

1. **CI chạy sai thời điểm.** Workflow kích hoạt khi `push` vào `main` — code đã
   nằm trong nhánh chính rồi mới biết nó đỏ. Đã xảy ra: lần sửa `outbox.id` làm
   smoke test gãy và chỉ phát hiện sau khi đã push.

2. **Làm trên hai máy.** Đẩy tính năng dở dang lên nhánh chính thì máy còn lại
   `git pull` về một cây build không được.

3. **Không có ranh giới giữa "code đã viết xong" và "code đã kiểm xong".** Hai
   trạng thái đó rất khác nhau, mà một nhánh thì không diễn đạt được.

## Quyết định

Ba nhánh dài hạn, tính năng đi lên theo bậc:

```
feat/*  →  develop  →  staging  →  master
```

| Nhánh     | Ý nghĩa                          | Nguồn hợp lệ                |
| --------- | -------------------------------- | --------------------------- |
| `develop` | Tính năng đã xong, chờ kiểm thử  | `feat/*` `fix/*` `chore/*`… |
| `staging` | Tập tính năng chuẩn bị phát hành | `develop`, `hotfix/*`       |
| `master`  | Đang phát hành                   | `staging`, `hotfix/*`       |

Mọi thay đổi vào ba nhánh này đều qua Pull Request. Hướng merge được **CI ép**,
không phải thoả thuận miệng — job `guard` trong `ci.yml` chặn PR đi sai hướng,
ví dụ `develop` → `master` nhảy cóc qua `staging`.

Chi tiết thao tác: [docs/17-git-workflow.md](../17-git-workflow.md).

## Các lựa chọn đã cân nhắc

| Phương án                        | Nhận xét                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Giữ một nhánh, không PR          | Không giải quyết được cả ba vấn đề trên                                                                       |
| Trunk-based: `master` + `feat/*` | Giải quyết được (1) và (2), nhưng không có chỗ cho bước QC nằm giữa "viết xong" và "phát hành"                |
| **Ba nhánh môi trường**          | **Đã chọn.** Mỗi bậc là một mức tin cậy, và khớp với quy trình QC mà người làm dự án đang quen ở nơi làm việc |

Trunk-based là mặc định hợp lý hơn cho web app giao liên tục, và chính tác giả
GitFlow đã ghi chú (2020) rằng mô hình của ông dành cho phần mềm có phiên bản
phát hành. Nhưng dự án này có một yêu cầu mà trunk-based không đáp ứng: **một
nơi để bản ứng viên nằm yên trong lúc kiểm thử, trong khi tính năng mới vẫn tiếp
tục chảy vào.** `staging` chính là nơi đó.

## Hệ quả

**Được:**

- CI chạy trước khi code vào nhánh môi trường, không phải sau
- Nhánh dở dang đẩy lên thoải mái mà không ảnh hưởng ai
- Lịch sử PR là thứ người đọc repo nhìn trước git log
- Tag `v*` trên `master` cho một lịch sử phát hành thật

**Mất:**

- Mỗi thay đổi phải merge **ba lần**. Với dự án một người đây là chi phí thật,
  không phải lý thuyết.
- Hotfix phải merge ngược về `staging` và `develop`. **Quên là bug sống lại** ở
  lần phát hành sau. Đây là chỗ sai phổ biến nhất của mô hình này, và CI không
  bắt được — chỉ có tài liệu và thói quen.
- `develop` và `master` sẽ phân kỳ. Lúc nào cũng phải tự hỏi "nhánh này đang
  thiếu những gì".

**Cái bẫy phải biết:** merge `develop` → `staging` → `master` **không được
squash**. Squash tạo commit mới với SHA khác, nên lần merge sau Git so lại từ tổ
tiên chung và mọi commit cũ hiện lại trong diff. Chỉ squash ở `feat/*` →
`develop`, vì nhánh đó bị xoá ngay sau khi merge. Giải thích đầy đủ ở
[docs/17 §5.1](../17-git-workflow.md).

## Điều chưa đúng với tên gọi

Ba nhánh được gọi là "ba môi trường", nhưng tới thời điểm viết ADR này **chưa
nhánh nào deploy đi đâu** — deploy nằm ở Phase 6 ([roadmap](../11-roadmap.md)).

Hiện tại chúng là **ba bậc tin cậy**. Ở Phase 6, mỗi nhánh sẽ gắn với một GitHub
Environment (`development` / `staging` / `production`) để có secret riêng và cổng
duyệt riêng. Ghi rõ ở đây để sau này không ai đọc tài liệu rồi đi tìm máy chủ
staging không tồn tại.
