# Architecture Decision Records

Mỗi ADR ghi lại **một quyết định kiến trúc**: bối cảnh lúc quyết, các lựa chọn đã cân nhắc, lý do chọn, và cái giá phải trả.

ADR không phải tài liệu thiết kế. Nó trả lời câu hỏi _"tại sao hồi đó lại làm thế?"_ — câu hỏi mà 3 tháng sau chính mình cũng không nhớ.

## Quy tắc

- Một file một quyết định, đánh số tăng dần, **không bao giờ sửa nội dung đã accepted**
- Đổi ý → viết ADR mới với trạng thái `Supersedes ADR-00X`, và sửa ADR cũ thành `Superseded by ADR-00Y`
- Phải ghi **cái giá phải trả**. ADR chỉ liệt kê ưu điểm là ADR vô dụng

## Danh sách

| #                                       | Quyết định                                                      | Trạng thái           | Ngày       |
| --------------------------------------- | --------------------------------------------------------------- | -------------------- | ---------- |
| [001](001-monolith-vs-microservices.md) | ~~Monolith modular thay vì microservices~~                      | ⛔ Superseded by 010 | 2026-10-05 |
| [002](002-password-hashing.md)          | argon2id thay vì bcrypt                                         | Accepted             | 2026-10-05 |
| [003](003-socketio-vs-raw-ws.md)        | Socket.IO thay vì WebSocket thuần                               | Accepted             | 2026-10-05 |
| [004](004-no-ssr.md)                    | SPA, không SSR                                                  | Accepted             | 2026-10-05 |
| [005](005-recommendation-approach.md)   | Recommendation lai, không ML                                    | Accepted             | 2026-10-05 |
| [006](006-codec-choice.md)              | H.264 + AAC, HLS fMP4                                           | Accepted             | 2026-10-05 |
| [007](007-no-drm.md)                    | AES-128 thay vì DRM thương mại                                  | Accepted             | 2026-10-05 |
| [008](008-zero-cost-infrastructure.md)  | Hạ tầng chi phí 0đ, không dịch vụ trả phí                       | Accepted             | 2026-10-05 |
| [009](009-mock-payment-provider.md)     | Mock payment provider thay vì Stripe                            | Accepted             | 2026-10-05 |
| [010](010-microservices.md)             | **Kiến trúc microservices** (thay thế 001)                      | Accepted             | 2026-10-05 |
| [011](011-nats-message-broker.md)       | NATS JetStream làm message broker                               | Accepted             | 2026-10-05 |
| [012](012-database-per-service.md)      | Database per service, tách logic                                | Accepted             | 2026-10-05 |
| [013](013-seaweedfs-replaces-minio.md)  | SeaweedFS thay MinIO (image MinIO không pull được)              | Accepted             | 2026-10-05 |
| [014](014-atlas-for-deploy-not-dev.md)  | MongoDB Atlas cho deploy, Docker local cho dev (đính chính 008) | Accepted             | 2026-10-05 |
| [015](015-three-branch-git-flow.md)     | Ba nhánh môi trường develop / staging / master                  | Accepted             | 2026-10-08 |

## Mẫu

```markdown
# ADR-00X: <Tiêu đề ngắn, là một quyết định>

**Trạng thái**: Proposed | Accepted | Superseded by ADR-00Y
**Ngày**: YYYY-MM-DD

## Bối cảnh

Vấn đề gì cần giải quyết? Ràng buộc nào đang có?

## Các lựa chọn

### A. ...

### B. ...

## Quyết định

Chọn gì, và lý do cốt lõi.

## Hệ quả

### Tích cực

### Cái giá phải trả

### Khi nào nên xem lại quyết định này
```
