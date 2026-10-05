# ADR-012: Database per service, tách logic trên một replica set

**Trạng thái**: Accepted
**Ngày**: 2026-10-05

## Bối cảnh

Nguyên tắc nền của microservices: **mỗi service sở hữu dữ liệu của mình, không ai đọc thẳng DB của ai.** Nếu hai service dùng chung một collection thì chúng không độc lập — đổi schema là phải deploy cả hai. Đó là distributed monolith.

Câu hỏi là tách tới mức nào, dưới ràng buộc zero-cost ([ADR-008](008-zero-cost-infrastructure.md)) và 9 service cùng chạy trên một máy.

## Các lựa chọn

### A. Mỗi service một MongoDB instance riêng

### B. Một replica set, mỗi service một **database** riêng, user riêng ← chọn

### C. Một database, mỗi service một tiền tố collection

### D. Dùng chung tất cả

## Quyết định

Chọn **B**: một MongoDB replica set, mỗi service một database độc lập, **mỗi service một DB user chỉ có quyền trên database của mình**.

```
mongodb://identity_svc:***@mongo:27017/nekoflix_identity?replicaSet=rs0
mongodb://catalog_svc:***@mongo:27017/nekoflix_catalog?replicaSet=rs0
mongodb://media_svc:***@mongo:27017/nekoflix_media?replicaSet=rs0
mongodb://activity_svc:***@mongo:27017/nekoflix_activity?replicaSet=rs0
mongodb://billing_svc:***@mongo:27017/nekoflix_billing?replicaSet=rs0
...
```

```js
// infra/mongo/init-users.js
db.getSiblingDB('admin').createUser({
  user: 'identity_svc',
  pwd: process.env.IDENTITY_DB_PASSWORD,
  roles: [{ role: 'readWrite', db: 'nekoflix_identity' }], // CHỈ db này
});
```

### Vì sao phân quyền ở tầng DB, không chỉ "thỏa thuận không đụng vào"

Đây là điểm quan trọng nhất của quyết định này.

Nếu chỉ tách database mà mọi service dùng chung một credential admin, thì ranh giới chỉ tồn tại trên giấy. Một lập trình viên vội — hoặc chính mình lúc 11h đêm — sẽ viết một query đọc thẳng `nekoflix_catalog` từ `activity-service` vì "nhanh hơn gọi API". Code đó chạy, test xanh, và kiến trúc chết âm thầm.

User riêng cho mỗi database biến vi phạm thành **lỗi runtime ngay lập tức**: `not authorized on nekoflix_catalog to execute command find`. Không thể lỡ tay.

MongoDB cho phép transaction **xuyên database** trong cùng replica set — đây chính là cái bẫy mà phân quyền đóng lại.

### Vì sao không chọn A

Mỗi `mongod` tốn ~300–500MB RAM. Nhân 9 service = 3–4.5GB chỉ riêng database, trên một máy đã chạy 13 container. Vi phạm ràng buộc tài nguyên.

Và nó **không mua thêm được gì về mặt kiến trúc**: phương án B đã chặn cross-service query ở tầng quyền. Cái A thêm vào là cô lập lỗi (một mongod chết không ảnh hưởng service khác) và scale riêng — hai thứ chưa cần ở quy mô này.

### Vì sao không chọn C

Cùng một database nghĩa là cùng một quyền. Không có cách nào chặn `activity-service` đọc `catalog_titles`. Ranh giới trở lại thành kỷ luật thuần túy — đúng thứ mà microservices lẽ ra phải loại bỏ.

### Dữ liệu được sở hữu bởi ai

| Database                | Service        | Collections                                              |
| ----------------------- | -------------- | -------------------------------------------------------- |
| `nekoflix_identity`     | identity       | users, profiles, sessions, verificationTokens            |
| `nekoflix_catalog`      | catalog        | titles, episodes, genres, people                         |
| `nekoflix_media`        | media          | assets, mediaKeys                                        |
| `nekoflix_activity`     | activity       | progress, watchHistory, watchlist, ratings               |
| `nekoflix_realtime`     | realtime       | watchParties                                             |
| `nekoflix_billing`      | billing        | subscriptions, payments, paymentEvents, checkoutSessions |
| `nekoflix_notification` | notification   | notifications, emailOutbox                               |
| `nekoflix_reco`         | recommendation | titleSimilarity, tasteVectors                            |

Mỗi database có thêm một collection `outbox` cho [Transactional Outbox](../14-inter-service-communication.md#3-transactional-outbox).

### Hệ quả trực tiếp: không còn join

Trước đây Continue Watching là một `$lookup` từ `progress` sang `titles`. Giờ hai collection nằm ở hai database của hai service.

Ba cách xử lý, dùng theo tình huống:

**1. API composition ở gateway** — mặc định

```
gateway → activity.getProgress(profileId)      → [{ titleId, positionSec }]
gateway → catalog.getTitlesByIds([...])        → [{ id, title, posterUrl }]
gateway → ghép lại, trả về client
```

Đơn giản, luôn đọc dữ liệu mới nhất. Tốn 2 round trip.

**2. Read model (CQRS)** — khi composition quá chậm hoặc quá nhiều hop

`activity-service` giữ một bản sao **tối thiểu** của title, cập nhật qua event:

```ts
// nekoflix_activity.titleProjections — read model, KHÔNG phải nguồn sự thật
{
  (titleId, title, posterUrl, runtimeSec, maturityRating, updatedAt, version);
}
```

Nghe `catalog.title.updated` để cập nhật. Quy tắc bắt buộc: **chỉ sao chép field thực sự cần để hiển thị**. Sao chép cả document là tự tạo ra hai nguồn sự thật.

**3. Denormalize lúc ghi** — cho dữ liệu bất biến

`payments.amount` chép giá tại thời điểm thanh toán. Giá gói đổi sau này không được làm đổi hóa đơn cũ. Đây không phải cache — đây là dữ liệu đúng về mặt nghiệp vụ.

## Hệ quả

### Tích cực

- Ranh giới được **ép ở tầng hạ tầng**, không thể lách
- Một mongod duy nhất → tiết kiệm RAM, một chỗ backup, một chỗ monitor
- Mỗi service đổi schema tự do, không ảnh hưởng ai
- Migration chạy độc lập theo service
- Đường nâng cấp sang phương án A rõ ràng: đổi connection string, dump/restore một database. Không cần sửa code

### Cái giá phải trả

- **Không cô lập lỗi ở tầng DB.** Một service viết query nặng làm chậm mongod → mọi service chậm theo. Đây là nhược điểm thật, và là lý do chính để sau này chuyển sang A
- **Không scale riêng được.** `activity` ghi nhiều nhất (progress mỗi 10 giây) nhưng không tách ra instance riêng được
- **Mất join hoàn toàn.** Mọi truy vấn tổng hợp phải tự ghép. Trang chủ từ một pipeline thành 3 lời gọi + logic ghép ở gateway
- **Read model phải tự lo đồng bộ.** Event trễ hoặc mất → projection sai. Cần job đối soát định kỳ (reconciliation) so projection với nguồn sự thật
- **Backup/restore phức tạp hơn.** Restore một database về thời điểm cũ sẽ làm nó lệch với các database khác. Phải restore cả cụm, hoặc chấp nhận chạy reconciliation sau khi restore
- Thêm việc vận hành: 8 DB user, 8 bộ credential, 8 bộ migration

### Quy tắc bất khả xâm phạm

1. Một collection có **đúng một** service ghi
2. Không service nào mở connection tới database của service khác — kể cả read-only
3. Read model **không bao giờ** là nguồn sự thật; nó có thể bị xóa và dựng lại từ event bất cứ lúc nào
4. Không transaction xuyên database — nếu thấy cần, nghĩa là ranh giới service đang sai

### Khi nào nên xem lại

- Khi một service làm chậm các service khác qua mongod chung → tách instance riêng cho service đó (phương án A, từng phần)
- Khi `activity` hoặc `media` cần scale ghi độc lập
- Khi một service hợp với database khác hẳn: `recommendation` có thể hợp hơn với Postgres + pgvector; `catalog` search có thể chuyển sang Meilisearch
