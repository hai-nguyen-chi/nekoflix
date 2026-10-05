# ADR-010: Kiến trúc microservices

**Trạng thái**: Accepted
**Ngày**: 2026-10-05
**Supersedes**: [ADR-001](001-monolith-vs-microservices.md)

## Bối cảnh

[ADR-001](001-monolith-vs-microservices.md) chọn monolith modular, với lập luận: chi phí của microservices (service discovery, distributed tracing, saga, N pipeline CI/CD, debug xuyên service) là có thật và phải trả ngay, còn lợi ích chỉ xuất hiện ở quy mô mà dự án không có.

Lập luận đó dựa trên một giả định: **hàm mục tiêu là hoàn thành sản phẩm**.

Chủ dự án đính chính: mục tiêu thật là **học kiến trúc phân tán**. Nekoflix là phương tiện, không phải đích.

Đây là thay đổi căn bản, vì nó **đảo chiều toàn bộ bảng cân đối**:

| Hạng mục                    | Dưới ADR-001    | Dưới ADR-010             |
| --------------------------- | --------------- | ------------------------ |
| Saga, eventual consistency  | Chi phí         | **Chính là thứ cần học** |
| Distributed tracing         | Chi phí         | **Chính là thứ cần học** |
| Contract testing            | Chi phí         | **Chính là thứ cần học** |
| Outbox pattern, idempotency | Chi phí         | **Chính là thứ cần học** |
| Debug xuyên nhiều service   | Chi phí         | **Chính là thứ cần học** |
| Thời gian hoàn thành        | Ràng buộc chính | Ràng buộc phụ            |

Không có gì mâu thuẫn ở đây: ADR-001 trả lời đúng câu hỏi được đặt ra lúc đó. Câu hỏi đã đổi.

## Quyết định

Chuyển sang **microservices với giao tiếp event-driven**, triển khai theo giai đoạn.

### Nguyên tắc cắt ranh giới

Không cắt theo tầng kỹ thuật (`user-service`, `db-service`, `email-service` là phản mẫu). Cắt theo **bounded context** — nhóm dữ liệu và hành vi thay đổi cùng nhau.

Ba câu hỏi để kiểm tra một ranh giới:

1. **Cái gì thay đổi cùng nhau?** Nếu sửa một tính năng mà phải deploy 3 service → ranh giới sai.
2. **Ai sở hữu dữ liệu này?** Mỗi mẩu dữ liệu có **đúng một** service ghi được. Service khác chỉ đọc qua API hoặc qua bản sao read-model của riêng nó.
3. **Profile tài nguyên có khác nhau không?** Transcode ăn CPU hàng chục phút; WebSocket giữ kết nối dài và stateful; REST catalog thì ngắn và nhiều. Khác nhau rõ → tách là có lý do vật lý.

### Danh sách service

**Giai đoạn cốt lõi** (Phase 1–4) — 6 thành phần:

| Service                                | Bounded context               | Sở hữu dữ liệu                                 |
| -------------------------------------- | ----------------------------- | ---------------------------------------------- |
| `api-gateway`                          | Biên hệ thống                 | Không sở hữu gì                                |
| `identity-service`                     | Danh tính & quyền             | users, sessions, profiles, oauth, 2FA          |
| `catalog-service`                      | Nội dung                      | titles, episodes, genres, people, search index |
| `media-service` (+ `transcode-worker`) | Tài sản số                    | assets, renditions, mediaKeys, playback token  |
| `activity-service`                     | Quan hệ người dùng ↔ nội dung | progress, history, watchlist, ratings          |
| `realtime-service`                     | Tương tác thời gian thực      | watchParties, presence (chủ yếu ở Redis)       |

**Giai đoạn sau** (Phase 5) — 3 service:

| Service                  | Bounded context       | Sở hữu dữ liệu                         |
| ------------------------ | --------------------- | -------------------------------------- |
| `billing-service`        | Thuê bao & thanh toán | subscriptions, payments, paymentEvents |
| `notification-service`   | Thông báo             | notifications, email outbox            |
| `recommendation-service` | Gợi ý                 | titleSimilarity, tasteVector           |

Tổng cộng **9 service**. Chi tiết từng service: [13 — Service Catalog](../13-service-catalog.md).

### Những chỗ cố ý KHÔNG tách

Ghi rõ để sau này không ai "tách cho đủ bộ":

| Gộp                                                 | Vì sao không tách                                                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| auth + users + profiles → `identity-service`        | Thay đổi cùng nhau. Tách ra thì mỗi lần đăng ký phải chạy saga 3 bước cho một thao tác lẽ ra là một transaction                                                       |
| watchlist + ratings + progress → `activity-service` | Cùng một bounded context: "người dùng này đã làm gì với nội dung kia". Cùng khóa truy vấn `profileId`                                                                 |
| `transcode-worker` không phải service riêng         | Nó là **worker** trong bounded context của media, không có API riêng, không sở hữu dữ liệu riêng. Tách process vì lý do tài nguyên, không phải vì ranh giới nghiệp vụ |
| Không có `search-service` riêng                     | Search là một cách truy vấn catalog, không phải bounded context. Tách ra sẽ phải đồng bộ toàn bộ dữ liệu title sang nó — tự tạo một bài toán không cần có             |

> Nguyên tắc: **tách khi có lý do, không tách cho đủ số.** Một service thừa tốn vĩnh viễn: thêm một pipeline, một bộ test, một chỗ để lỗi, một hop mạng.

### Giao tiếp

| Hướng                                 | Cách                      | Chi tiết                                                                 |
| ------------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| Ngoài → hệ thống                      | HTTP/WS qua `api-gateway` | Client **chỉ** biết gateway                                              |
| Service → service (cần trả lời ngay)  | NATS request/reply        | [ADR-011](011-nats-message-broker.md)                                    |
| Service → service (không cần trả lời) | NATS JetStream pub/sub    | Event, at-least-once                                                     |
| Ghi DB + phát event                   | **Transactional Outbox**  | [14 — Inter-service Communication](../14-inter-service-communication.md) |

**Ưu tiên async.** Mỗi lời gọi sync là một liên kết cứng: service kia chết thì mình cũng chết, service kia chậm thì mình cũng chậm. Quy tắc: nếu nghiệp vụ chịu được độ trễ vài trăm ms thì dùng event.

### Dữ liệu

**Một database cho mỗi service**, tách logic trên cùng một MongoDB replica set — xem [ADR-012](012-database-per-service.md).

Cấm tuyệt đối: service A đọc trực tiếp database của service B. Đây là ranh giới duy nhất mà vi phạm nó sẽ biến kiến trúc này thành "distributed monolith" — thứ tệ hơn cả monolith lẫn microservices.

## Hệ quả

### Tích cực

- Học được những pattern chỉ xuất hiện trong hệ phân tán: saga, outbox, idempotency, eventual consistency, contract testing, distributed tracing, circuit breaker
- Mỗi service deploy độc lập — sửa catalog không cần restart phiên đang xem phim
- Ranh giới được **network enforce**, không chỉ dựa vào kỷ luật và ESLint. Muốn phá ranh giới phải cố ý, không lỡ tay được
- Scale riêng từng phần: thêm 3 `transcode-worker` khi hàng đợi dài, thêm `realtime-service` khi nhiều watch party
- Lỗi được cô lập: `recommendation-service` chết thì trang chủ mất một row, không sập cả site (nếu gateway xử lý fallback đúng)
- Có thứ thật để nói trong phỏng vấn: không phải "em biết microservices" mà "em đã xử lý saga rollback khi xóa tài khoản"

### Cái giá phải trả — phải nói thẳng

**1. Thời gian tăng khoảng 60%.** Roadmap từ ~12 tuần lên **~19 tuần** part-time. Phần tăng nằm ở: hạ tầng giao tiếp, outbox, contract test, tracing, và việc mỗi tính năng xuyên service đều tốn gấp đôi công.

**2. Mọi thao tác xuyên service không còn transaction.** Đăng ký tài khoản + tạo profile mặc định giờ là hai service. Xóa tài khoản chạm 6 service. Không có `ROLLBACK` — phải viết saga với bước bù trừ, và phải nghĩ xem bù trừ thất bại thì sao.

**3. Đọc dữ liệu tổng hợp trở nên khó.** Trang chủ cần title (catalog) + progress (activity) + subscription (identity). Trước là một aggregate pipeline; giờ là composition ở gateway, phải xử lý: service nào chậm, service nào chết, timeout bao nhiêu, fallback ra sao.

**4. Dữ liệu sai lệch tạm thời là trạng thái bình thường.** User nâng gói → `billing` phát event → `identity` cập nhật → `media` đọc được. Trong vài trăm ms, user đã trả tiền nhưng vẫn bị giới hạn 720p. Phải thiết kế UI chấp nhận điều này, không coi là bug.

**5. Debug khó hơn hẳn.** Một request lỗi có thể đi qua 4 service. Không có distributed tracing thì gần như không lần ra được — nên **OpenTelemetry chuyển từ P2 lên P0**, không còn là tùy chọn.

**6. Tốn tài nguyên hơn.** ~13 container thay vì 5. Ước tính ~2.5–3GB RAM lúc rảnh. Vẫn nằm trong giới hạn của laptop 16GB và Oracle Always Free 24GB ([ADR-008](008-zero-cost-infrastructure.md)) — nhưng không còn dư dả.

**7. Rủi ro lớn nhất: distributed monolith.** Nếu cắt ranh giới sai, kết quả là N service nhưng phải deploy cùng lúc, gọi sync chằng chịt, dùng chung database. Đó là tệ nhất của cả hai thế giới. Dấu hiệu nhận biết sớm:

- Sửa một tính năng phải đổi >2 service
- Một request đi qua >3 hop sync
- Service nào đó chết là cả hệ thống chết

### Khi nào nên xem lại

- Nếu sau Phase 2 mà thấy mỗi tính năng đều phải sửa nhiều service → ranh giới sai, **gộp lại** trước khi đi tiếp. Gộp service sớm rẻ hơn nhiều so với sống chung với ranh giới sai
- Nếu mục tiêu quay về "hoàn thành sản phẩm" → ADR-001 vẫn còn nguyên giá trị, đọc lại nó
- Nếu tài nguyên máy không chịu nổi → gộp các service Phase 5 vào một `support-service` duy nhất
