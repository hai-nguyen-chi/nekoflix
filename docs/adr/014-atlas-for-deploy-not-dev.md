# ADR-014: MongoDB Atlas cho deploy, Docker local cho dev

**Trạng thái**: Accepted
**Ngày**: 2026-10-05
**Đính chính**: [ADR-008](008-zero-cost-infrastructure.md)

## Đính chính trước đã

[ADR-008](008-zero-cost-infrastructure.md) loại MongoDB Atlas M0 với lý do:

> _"Miễn phí thật, nhưng 512MB và **không cho bật replica set theo ý mình**."_

**Vế sau sai.** Atlas M0 **là một replica set 3 node** và **có hỗ trợ transaction** đầy đủ. Nghĩa là nó chạy được Transactional Outbox — thứ mà ADR-008 ngầm cho rằng nó không làm được.

Kết luận của ADR-008 (dùng Docker local) vẫn giữ nguyên, nhưng **lý do thì phải viết lại**. Một ADR đúng kết luận vì lý do sai còn nguy hiểm hơn ADR sai hẳn: lần sau gặp tình huống tương tự sẽ suy luận theo cái lý do sai đó.

## Bối cảnh

Câu hỏi: tại sao không dùng Atlas luôn cho đỡ phải tự vận hành MongoDB?

Đây là câu hỏi hợp lý. Atlas M0 miễn phí vĩnh viễn, không cần thẻ, có backup, không phải lo `--auth` hay keyFile — đúng loại việc vặt vừa gây ra một lỗ hổng bảo mật thật ở Phase 0.

## Atlas M0 thực sự có gì

|                       | Atlas M0                    |
| --------------------- | --------------------------- |
| Replica set           | ✅ 3 node                   |
| Transaction           | ✅                          |
| Change stream         | ✅                          |
| Dung lượng            | 512MB                       |
| **Kết nối đồng thời** | **100**                     |
| Collection tối đa     | 500                         |
| Tự tạm dừng           | sau 60 ngày không dùng      |
| Chi phí               | 0đ vĩnh viễn, không cần thẻ |

## Đo thực tế

Số kết nối MongoDB mà kiến trúc này tiêu thụ, đo lúc **rảnh** trên Phase 0:

```
2 service có database (ping, pong) -> 15 kết nối
Trung bình mỗi service              -> ~7
Ước tính 9 service                  -> ~59
Giới hạn Atlas M0                   -> 100
```

Một người làm, lúc rảnh: **vừa đủ**. Nhưng:

- Mongoose tăng pool khi có tải — `maxPoolSize` mặc định là 100 **cho mỗi connection**
- Thêm một người nữa: ~118 → **vượt trần**
- Thêm CI chạy song song: vượt xa
- Thêm Mongo Express, công cụ quản trị: vượt thêm

Không phải "không chạy được", mà là **sống sát trần và sẽ vỡ đúng lúc không ngờ**.

## Quyết định

**Dev: Docker local. Deploy (Phase 6): Atlas là lựa chọn hợp lý.**

### Vì sao dev phải là local — ba lý do thật

**1. Test xoá sạch dữ liệu.**

Integration test chạy `deleteMany({})` trên mọi collection ở `afterEach`. Trên một cluster dùng chung, mỗi lần chạy test là xoá dữ liệu của người khác. Muốn tránh thì mỗi dev + mỗi CI runner cần một cluster riêng — Atlas free giới hạn 1 cluster M0 mỗi project, quản lý rất rối.

Đây là lý do nặng nhất, và nó mang tính kiến trúc chứ không phải hạn mức.

**2. Độ trễ nhân lên theo số service.**

Local ~1ms, Atlas (Singapore, từ Việt Nam) ~30–80ms. Nghe không nhiều, nhưng với microservices một request đi qua nhiều service, mỗi service lại nhiều truy vấn:

```
Local : POST /v1/ping/echo = 45ms   (đã đo)
Atlas : cùng request       ≈ 300–600ms
```

Vòng lặp sửa-chạy-xem chậm gấp 10 lần. Và smoke test có mốc thời gian (`event tới pong-service <15s`) sẽ trở nên bấp bênh.

**3. Không làm việc offline được.**

Mất mạng là mất database. Với dự án học tập làm vào buổi tối, trên tàu, ở quán cà phê — đây là ràng buộc thật.

### Vì sao Atlas lại HỢP LÝ cho deploy

Ở Phase 6, ba lý do trên biến mất: không chạy test trên production, độ trễ giữa app và DB trong cùng vùng là ~1ms, và server luôn có mạng.

Đổi lại được:

- Backup tự động, point-in-time recovery
- Không phải tự lo `--auth`, keyFile, vá bảo mật
- Không mất dữ liệu khi VPS hỏng

So với tự host trên Oracle Always Free:

|             | Atlas M0         | Tự host trên Oracle |
| ----------- | ---------------- | ------------------- |
| Vận hành    | Không phải lo    | Tự lo hết           |
| Backup      | Sẵn có           | Tự viết script      |
| Dung lượng  | 512MB            | 200GB               |
| Kết nối     | 100              | Không giới hạn      |
| Tự tạm dừng | sau 60 ngày idle | Không               |

512MB đủ cho metadata 50 phim (video nằm ở object storage, không ở MongoDB). Nhưng trần 100 kết nối vẫn là rủi ro với 9 service.

**Khuyến nghị cho Phase 6**: bắt đầu bằng Atlas M0 cho đỡ việc; nếu đụng trần kết nối thì chuyển sang tự host trên cùng VPS.

### Điểm then chốt: chuyển đổi gần như miễn phí

Code không có chỗ nào biết MongoDB nằm ở đâu. Toàn bộ nằm sau một biến môi trường:

```bash
# Dev
MONGO_HOST=localhost:27017

# Deploy — chỉ đổi dòng này
MONGO_URI=mongodb+srv://identity_svc:***@cluster0.xxx.mongodb.net/nekoflix_identity
```

`buildMongoUri()` trong `service-kit` đã ưu tiên `MONGO_URI` nếu có. Không phải sửa một dòng code nào.

Đây chính là lý do **không cần quyết định ngay bây giờ**. Quyết định này rẻ và hoãn được — nên hoãn tới khi có thông tin thật (Phase 6, biết rõ tải thực tế).

## Hệ quả

### Tích cực

- Dev nhanh, offline được, test xoá dữ liệu thoải mái
- Giữ nguyên đường mở sang Atlas, chi phí chuyển đổi gần bằng 0
- Học được cách vận hành MongoDB thật (auth, keyFile, replica set) — Phase 0 đã chứng minh giá trị: lỗi thiếu `--auth` là bài học không có nếu bấm nút trên Atlas

### Cái giá phải trả

- **Phải tự lo bảo mật MongoDB.** Phase 0 đã trả giá: chạy 4 tuần thiếu `--auth` mà không ai biết. Atlas sẽ không để điều đó xảy ra
- Phải tự viết script backup
- Dữ liệu dev không đi theo máy — phải `mongodump`/`mongorestore` khi đổi máy
- Mỗi dev tự dựng hạ tầng (đổi lại: `pnpm infra:up` là xong)

### Khi nào nên xem lại

- **Phase 6**: đánh giá lại nghiêm túc, lúc đó đã biết số service thật và tải thật
- Nếu có người thứ hai tham gia và việc đồng bộ dữ liệu dev trở nên phiền
- Nếu tự vận hành MongoDB gây ra thêm một sự cố bảo mật nữa — lúc đó chi phí "tự lo" đã vượt lợi ích
