# ADR-013: SeaweedFS thay MinIO làm object storage

**Trạng thái**: Accepted
**Ngày**: 2026-10-05
**Sửa đổi một phần**: [ADR-008](008-zero-cost-infrastructure.md)

## Bối cảnh

[ADR-008](008-zero-cost-infrastructure.md) chọn **MinIO tự host** làm object storage, với lập luận: mọi dịch vụ object storage bên ngoài đều tính phí theo dung lượng lưu trữ, mà video là loại dữ liệu nặng nhất — free tier 10GB chỉ chứa được 2 phim 1080p.

Lập luận đó vẫn đúng. Nhưng giả định ngầm bên dưới thì không: **rằng image MinIO luôn pull được miễn phí.**

Khi dựng hạ tầng Phase 0 trên máy thật, phát hiện:

```
$ docker pull minio/minio:latest
Error response from daemon: pull access denied for minio/minio,
repository does not exist or may require 'docker login'

$ docker pull minio/mc:latest
Error response from daemon: pull access denied for minio/mc, ...

$ docker pull quay.io/minio/minio:latest
401 Unauthorized

$ docker pull quay.io/minio/minio:RELEASE.2024-06-13T22-53-53Z
401 Unauthorized
```

Không pull được trên Docker Hub lẫn quay.io, kể cả tag cũ đã ghim. MinIO đã siết phân phối image container.

Đây **không phải lỗi cấu hình** — nó là một ràng buộc bên ngoài, và nó vi phạm đúng điều kiện số 4 của ADR-008: _"mỗi dịch vụ bên ngoài phải có đường thoát self-hosted nếu họ đổi chính sách"_. Trớ trêu là MinIO được chọn **vì** nó self-hosted; hóa ra self-hosted vẫn phụ thuộc vào việc tải được image.

## Các lựa chọn

| Phương án                             | Pull được? | Ghi chú                                                |
| ------------------------------------- | ---------- | ------------------------------------------------------ |
| MinIO (Docker Hub / quay.io)          | ❌         | Đã kiểm chứng: 401 / access denied                     |
| Bitnami MinIO                         | ❌         | Bitnami đóng catalog miễn phí năm 2025                 |
| **SeaweedFS** (`chrislusf/seaweedfs`) | ✅         | Một container là có S3 gateway                         |
| Garage (`dxflrs/garage`)              | ✅         | Nhẹ, nhưng cần bước cấu hình layout cụm trước khi dùng |
| LocalStack                            | ✅         | Nặng, thiên về giả lập AWS cho test                    |
| Tự build MinIO từ source              | ✅         | Thêm bước build vào mọi môi trường                     |

## Quyết định

Chọn **SeaweedFS**, và chuyển script tạo bucket sang **AWS CLI**.

### Vì sao SeaweedFS

- **Một container là xong**: `weed server -s3` khởi động master + volume + filer + S3 gateway. Garage cần thêm một bước khởi tạo layout cụm, tức thêm một container init nữa
- Hỗ trợ S3 API đủ cho nhu cầu: bucket, object, presigned URL, multipart upload
- Có file cấu hình identity/credential riêng → giữ được mô hình "có access key, không truy cập ẩn danh" như MinIO
- Dự án mã nguồn mở, không ràng buộc thương mại

### Thay đổi quan trọng hơn: bỏ CLI riêng của nhà cung cấp

Script tạo bucket cũ dùng `mc` — CLI **riêng của MinIO**. Khi MinIO biến mất, script chết theo.

Script mới dùng **AWS CLI** (`amazon/aws-cli`) nói chuyện qua **S3 API chuẩn**:

```sh
aws --endpoint-url "$S3_ENDPOINT" s3api create-bucket --bucket nekoflix-uploads
```

Script này chạy y nguyên với SeaweedFS (dev), Garage, S3 thật, hay Cloudflare R2 — chỉ đổi `--endpoint-url`.

Đây là bài học thật sự của ADR này: **cái khóa chân không phải nhà cung cấp, mà là công cụ riêng của nhà cung cấp.** Code ứng dụng vốn đã dùng S3 API chuẩn nên không phải sửa một dòng nào; chỉ script hạ tầng — chỗ duy nhất lỡ dùng CLI riêng — là phải viết lại.

### Cấu hình

```yaml
storage:
  image: chrislusf/seaweedfs:latest
  command: >
    server -dir=/data -ip=storage
    -s3 -s3.port=8333 -s3.config=/config/s3.json
  ports:
    - '9000:8333' # S3 API — giữ cổng 9000 như cũ, .env không phải đổi
    - '9001:8888' # Filer UI
    - '9333:9333' # Master UI
```

Credential chuyển từ `minioadmin/minioadmin` sang `nekoflix/nekoflix123`.

## Hệ quả

### Tích cục

- Hạ tầng pull và chạy được, không cần đăng nhập registry
- Script hạ tầng giờ **trung lập với nhà cung cấp** — đổi sang R2/S3 chỉ là đổi endpoint
- Giữ nguyên cổng 9000 → `.env` và code không phải sửa
- Code ứng dụng không đổi dòng nào (đã dùng S3 API chuẩn từ đầu)

### Cái giá phải trả

- **SeaweedFS ít phổ biến hơn MinIO rõ rệt.** Ít tài liệu, ít câu hỏi StackOverflow, gần như không có tài liệu tiếng Việt. Khi gặp sự cố sẽ phải đọc docs gốc và source
- **Chưa kiểm chứng phần S3 nâng cao.** Phase 0 mới chỉ tạo bucket và liệt kê. Presigned multipart upload và CORS — thứ Phase 3 cần — chưa test. Script init đã để `|| true` cho bước CORS vì SeaweedFS có thể chưa hỗ trợ `put-bucket-cors`
- Không có giao diện quản trị đẹp như MinIO Console; Filer UI của SeaweedFS khá thô
- Thêm một thứ phải học khi debug tầng lưu trữ

### Rủi ro còn mở

**Phase 3 phải xác minh sớm**: presigned multipart upload có hoạt động không. Nếu không, phương án dự phòng theo thứ tự: Garage → upload qua API server (chấp nhận tốn RAM, chỉ hợp với file nhỏ) → tự build MinIO từ source.

Đừng để tới giữa Phase 3 mới phát hiện — kiểm tra ngay ở đầu phase bằng một file 100MB.

### Khi nào nên xem lại

- Nếu MinIO mở lại phân phối image miễn phí
- Nếu SeaweedFS thiếu tính năng S3 mà Phase 3 cần
- Khi deploy thật: dùng thẳng Cloudflare R2 thay vì self-host, lúc đó storage chỉ còn là một endpoint — và nhờ script đã trung lập, chuyển đổi gần như không tốn gì
