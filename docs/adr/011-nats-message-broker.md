# ADR-011: NATS JetStream làm message broker

**Trạng thái**: Accepted
**Ngày**: 2026-10-05

## Bối cảnh

[ADR-010](010-microservices.md) chọn giao tiếp event-driven. Cần một broker lo:

1. **Pub/sub bền bỉ** — event không được mất khi consumer đang chết
2. **Consumer group** — chạy 3 `transcode-worker` thì mỗi job chỉ một worker nhận
3. **Request/reply** — gateway hỏi `catalog-service` và chờ trả lời
4. **At-least-once** kèm ack thủ công — xử lý xong mới ack
5. **Dead letter** — message hỏng không được quay vòng vô hạn

Ràng buộc từ [ADR-008](008-zero-cost-infrastructure.md): miễn phí, self-host được, và **tiết kiệm RAM** — vì đã có 9 service Node cùng chạy trên một máy.

## Các lựa chọn

|                    | RAM tối thiểu      | Persistence | Request/Reply        | NestJS transporter |
| ------------------ | ------------------ | ----------- | -------------------- | ------------------ |
| **NATS JetStream** | ~20MB              | Có          | **Có, native**       | Có                 |
| RabbitMQ           | ~120MB (Erlang VM) | Có          | Qua reply-to queue   | Có                 |
| Kafka (KRaft)      | ~1GB (JVM)         | Có          | Không — phải tự dựng | Có                 |
| Redis Streams      | Đã có sẵn Redis    | Yếu         | Không                | Một phần           |
| BullMQ (đang dùng) | Đã có sẵn Redis    | Có          | Không                | —                  |

## Quyết định

Chọn **NATS JetStream** cho giao tiếp giữa các service. Giữ **BullMQ** cho job transcode nội bộ của media-service.

### Vì sao NATS

**1. Một transport cho cả hai pattern.** NATS làm được cả pub/sub bền bỉ _và_ request/reply. Những lựa chọn khác buộc phải chạy hai thứ: một broker cho event + HTTP/gRPC cho sync. Bớt một protocol là bớt một bộ client, một kiểu lỗi, một thứ phải monitor.

**2. Không cần service discovery.** Đây là lý do mạnh nhất, và hay bị bỏ qua.

Với gRPC hoặc HTTP, gateway phải biết `catalog-service` đang ở đâu → cần DNS nội bộ, Consul, hoặc k8s Service. Với NATS, mọi thứ nối tới broker và nói chuyện qua **subject**. Chạy 3 instance `catalog-service` cùng subscribe một queue group → broker tự chia tải. Không có file config nào liệt kê địa chỉ, không có health check để gỡ node chết.

Với ràng buộc zero-cost single-host, việc loại bỏ hẳn một hạng mục hạ tầng là thắng lợi lớn.

**3. RAM.** NATS ~20MB so với Kafka ~1GB. Khi đang chạy 13 container trên laptop, 1GB cho riêng broker là không chấp nhận được.

**4. Vận hành đơn giản.** Một binary tĩnh, một file config ~15 dòng. Kafka cần hiểu partition, replication factor, ISR, consumer group rebalancing — đáng học, nhưng không phải thứ dự án này cần học _trước_.

### Vì sao không Kafka

Kafka là lựa chọn đúng khi cần: lưu trữ event lâu dài để replay, throughput hàng triệu message/giây, hoặc stream processing. Nekoflix không cần cái nào.

Đổi lại phải trả: 1GB RAM, độ phức tạp vận hành, và thời gian học cơ chế partition — thời gian lẽ ra nên dành cho saga và outbox, là thứ thật sự cần.

JetStream cũng có replay và persistence, đủ cho nhu cầu ở đây.

### Vì sao vẫn giữ BullMQ cho transcode

Job transcode **không phải** event giữa service. Nó là hàng đợi nội bộ của media context:

- Cần progress chi tiết (`job.updateProgress`)
- Cần retry với backoff theo job
- Cần `lockDuration` 10 phút cho job chạy lâu
- Cần Bull Board để nhìn hàng đợi

JetStream làm được phần lớn, nhưng BullMQ làm tốt hơn cho **job dài, có trạng thái, cần theo dõi**. Redis đã có sẵn nên không thêm hạ tầng.

Ranh giới rõ ràng:

- **NATS** — giao tiếp _giữa_ các service
- **BullMQ** — hàng đợi _bên trong_ một service

### Cấu hình

```
Stream           Subject                      Retention      Max age   Replicas
EVENTS           nekoflix.events.>            limits         7 ngày    1
DLQ              nekoflix.dlq.>               limits         30 ngày   1
```

Subject: `nekoflix.events.<service>.<aggregate>.<event>`
Ví dụ: `nekoflix.events.billing.subscription.activated`

```ts
// Consumer — mỗi service một durable consumer riêng
{
  durable_name: 'notification-service',
  filter_subject: 'nekoflix.events.>',
  deliver_policy: 'all',
  ack_policy: 'explicit',        // ack thủ công sau khi xử lý xong
  ack_wait: 30_000,              // không ack trong 30s → gửi lại
  max_deliver: 5,                // 5 lần thất bại → đẩy sang DLQ
  max_ack_pending: 100,          // chống một consumer chậm ôm hết message
}
```

`ack_policy: explicit` là bắt buộc. Ack tự động nghĩa là service crash giữa lúc xử lý thì event mất luôn.

## Hệ quả

### Tích cực

- Một transport, một client library, một chỗ monitor
- Không cần service discovery — thêm instance là xong
- Nhẹ: broker tốn RAM ít hơn một service Node
- Queue group cho load balancing, fan-out cho broadcast — cùng một cơ chế subject
- NestJS có transporter sẵn: `@MessagePattern` (request/reply) và `@EventPattern` (pub/sub)
- `nats` CLI đủ để xem stream, consumer, và message đang kẹt

### Cái giá phải trả

- **Hệ sinh thái nhỏ hơn Kafka rất nhiều.** Ít tài liệu, ít bài viết khi gặp sự cố, gần như không có tài liệu tiếng Việt. Phải đọc docs gốc
- **Không có Kafka Connect / Streams.** Muốn đẩy event sang nơi khác phải tự viết
- **Ít giá trị trên CV hơn Kafka.** Tin tuyển dụng hay ghi "Kafka", hiếm khi ghi "NATS". Đây là mất mát thật — bù lại bằng việc hiểu _pattern_ (consumer group, at-least-once, DLQ) vốn chuyển được sang Kafka trong vài ngày
- **At-least-once nghĩa là mọi consumer phải idempotent.** Không phải nhược điểm của NATS mà là của mô hình — nhưng phải nói rõ vì nó là nguồn bug âm thầm nhất
- **Thứ tự chỉ đảm bảo trong một subject.** Event từ hai subject khác nhau có thể đến sai thứ tự → consumer phải so timestamp, không được giả định thứ tự
- JetStream 1 replica ở local → broker chết là mất message chưa tiêu thụ. Chấp nhận ở môi trường học tập

### Khi nào nên xem lại

- Nếu mục tiêu học cụ thể đổi thành Kafka → đổi được, vì code đã tách qua một lớp `EventBus` abstraction. NestJS transporter cũng cho phép đổi transport mà ít chạm handler
- Nếu cần replay event quá 7 ngày hoặc event sourcing thật sự → Kafka hoặc EventStoreDB
- Nếu throughput vượt ~100k msg/giây (sẽ không xảy ra ở dự án này)
