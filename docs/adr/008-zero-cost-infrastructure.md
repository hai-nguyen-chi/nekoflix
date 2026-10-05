# ADR-008: Hạ tầng chi phí 0đ, không dịch vụ trả phí

**Trạng thái**: Accepted
**Ngày**: 2026-10-05

## Bối cảnh

Bản tài liệu đầu tiên giả định một VPS Hetzner ~€4/tháng và dùng Cloudflare R2 làm object storage. Chủ dự án xác nhận lại ràng buộc: **đây là dự án học tập, không chi tiền.**

Đây không phải ràng buộc nhỏ cần vá qua loa — nó thay đổi lựa chọn hạ tầng ở nhiều chỗ, nên ghi lại thành quyết định riêng.

Ràng buộc đầy đủ:

1. Chi phí vận hành = **0đ**, không ngoại lệ
2. Ưu tiên mạnh: **không cần thẻ tín dụng**
3. Phải là **miễn phí vĩnh viễn**, không phải trial hay credit tặng
4. Mỗi dịch vụ bên ngoài phải có **đường thoát self-hosted** nếu họ đổi chính sách

Điều kiện 3 và 4 quan trọng không kém điều kiện 1: dự án sống 12 tuần phát triển rồi còn nằm trên CV vài năm. Một free tier hết hạn sau 12 tháng sẽ làm link demo chết đúng lúc cần nó nhất.

## Những phương án đã cân nhắc và loại

| Phương án                                  | Vì sao loại                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VPS Hetzner CX22 (€4/tháng)**            | Vi phạm ràng buộc 1                                                                                                                                           |
| **Cloudflare R2 / Backblaze B2** cho video | Free tier 10GB. Một phim 1080p sau transcode ~4GB → chứa được 2 phim. Vượt là tính tiền, và tính theo dung lượng lưu trữ nên **tốn tiền cả khi không ai xem** |
| **AWS Free Tier**                          | 12 tháng rồi hết. S3 tính **phí egress** — streaming chính là egress. Rủi ro hóa đơn bất ngờ cao nhất trong các lựa chọn                                      |
| **Fly.io / Railway / Render (paid tier)**  | Trial credit rồi chuyển sang trả phí                                                                                                                          |
| **Render free web service**                | Ngủ sau 15 phút không dùng, 512MB RAM. Không đủ cho transcode, và cold start làm demo trông như hỏng                                                          |
| **Vercel free**                            | Băng thông 100GB/tháng và **cấm dùng cho mục đích thương mại** — không vấn đề với dự án học, nhưng Cloudflare Pages không giới hạn băng thông nên tốt hơn hẳn |
| **ngrok free**                             | URL đổi mỗi lần khởi động, giới hạn kết nối đồng thời                                                                                                         |
| **MongoDB Atlas M0**                       | Miễn phí thật, nhưng 512MB và không cho bật replica set theo ý mình. Tự host bằng Docker vừa miễn phí vừa không giới hạn                                      |
| **Stripe test mode**                       | Không mất phí, nhưng cần tài khoản + Stripe hỗ trợ pháp nhân Việt Nam hạn chế. Xem [ADR-009](009-mock-payment-provider.md)                                    |
| **Sentry free**                            | 5.000 lỗi/tháng, miễn phí thật. Nhưng GlitchTip self-hosted tương thích SDK hoàn toàn → không có lý do phụ thuộc bên ngoài                                    |

## Quyết định

Hai cấp triển khai, cả hai đều 0đ:

### Cấp 1 — Local + Cloudflare Tunnel (mặc định)

Toàn bộ stack chạy trên máy phát triển. Cloudflare Tunnel phơi ra Internet qua HTTPS khi cần demo.

**Lý do đây là mặc định, không phải phương án dự phòng:**

Transcode video cần CPU và đĩa — hai thứ mà mọi free tier đều keo kiệt nhất. Một chiếc laptop bình thường mạnh hơn bất kỳ container free tier nào, và dung lượng ổ cứng thì gấp hàng chục lần. Chạy local không phải là "chấp nhận thiệt thòi", nó thực sự **tốt hơn** cho workload này.

Cái mất duy nhất là uptime — tắt máy thì web tắt. Với dự án học tập, đổi uptime lấy tài nguyên là đổi đúng chiều.

### Cấp 2 — Oracle Cloud Always Free (tùy chọn, khi cần 24/7)

4 ARM core + 24GB RAM + 200GB storage + 10TB egress/tháng, **miễn phí vĩnh viễn**. Đây là gói free còn tồn tại hào phóng nhất, và đủ chạy cả transcode.

Đánh dấu là **tùy chọn** vì nó vi phạm ràng buộc số 2: cần thẻ để xác minh danh tính (không bị trừ tiền). Ai không muốn đưa thẻ thì bỏ hẳn Cấp 2, dự án vẫn chạy đủ.

### Frontend — Cloudflare Pages

Băng thông không giới hạn ở gói free, không cần thẻ, deploy tự động từ GitHub. Vì đã chọn SPA tĩnh ([ADR-004](004-no-ssr.md)) nên không cần runtime Node — khớp hoàn hảo.

### Object storage — tự host, không dùng dịch vụ ngoài

> **Cập nhật 2026-10-05**: phần này ban đầu chọn **MinIO**. Khi dựng hạ tầng thật mới
> phát hiện image MinIO không còn pull tự do được nữa (401 trên cả Docker Hub lẫn
> quay.io). Đã chuyển sang **SeaweedFS** — xem [ADR-013](013-seaweedfs-replaces-minio.md).
> Lập luận bên dưới vẫn đúng nguyên; chỉ phần mềm cụ thể là đổi.

Đây là thay đổi lớn nhất so với bản tài liệu đầu.

| Phương án                       | Free tier | Chứa được | Rủi ro            |
| ------------------------------- | --------- | --------- | ----------------- |
| Cloudflare R2                   | 10GB      | ~2 phim   | Vượt là tính tiền |
| Backblaze B2                    | 10GB      | ~2 phim   | Vượt là tính tiền |
| **MinIO trên ổ local / Oracle** | 200GB+    | ~50 phim  | Không             |

Mọi object storage free tier đều tính theo **dung lượng lưu trữ**, nghĩa là tốn tiền ngay cả khi không ai xem. Với video — loại dữ liệu nặng nhất có thể — free tier 10GB không phải là giải pháp mà là cái bẫy.

MinIO đằng nào cũng đã dùng cho local dev. Dùng luôn nó cho mọi môi trường còn giảm được một nguồn khác biệt giữa dev và production.

### Các mảnh còn lại

| Nhu cầu       | Chọn                               | Đường thoát nếu đổi chính sách         |
| ------------- | ---------------------------------- | -------------------------------------- |
| Domain        | `is-a.dev` (PR vào GitHub)         | DuckDNS, hoặc `*.trycloudflare.com`    |
| TLS           | Cloudflare / Caddy + Let's Encrypt | Hai nguồn độc lập                      |
| Email dev     | Mailpit (Docker)                   | Đã self-host                           |
| Email thật    | Brevo free 300/ngày                | Đổi `SMTP_URL`, không đụng code        |
| Giám sát lỗi  | GlitchTip self-host                | Đã self-host; hoặc bỏ, dùng pino log   |
| Metrics       | Prometheus + Grafana self-host     | Đã self-host                           |
| CI/CD         | GitHub Actions 2.000 phút/tháng    | Đủ xa ngưỡng; có thể chạy runner local |
| Registry      | GitHub Container Registry          | Miễn phí cho public repo               |
| Thanh toán    | Mock provider tự viết              | Không phụ thuộc ai                     |
| Metadata phim | TMDB API free                      | Có sẵn seed JSON tĩnh để chạy offline  |

Mọi dòng trong bảng đều thỏa ràng buộc 4 — nếu nhà cung cấp đổi chính sách, có đường đi tiếp.

## Hệ quả

### Tích cực

- Tổng chi phí thật sự là 0đ, không có "0đ nếu không vượt ngưỡng"
- **Không có rủi ro hóa đơn bất ngờ** — đây là rủi ro thật với video: một con bot cào hết thư viện trên S3 có thể tạo hóa đơn vài trăm USD qua đêm
- Chạy local nghĩa là **tài nguyên transcode tốt hơn** mọi free tier
- Ít phụ thuộc bên ngoài hơn → ít thứ hỏng khi nhà cung cấp đổi chính sách
- Self-host Mongo/Redis/MinIO ở mọi môi trường → dev và production giống nhau hơn, ít bug "chỉ xảy ra trên production"
- Học được nhiều hơn: tự vận hành Mongo replica set và MinIO dạy nhiều thứ mà bấm nút trên Atlas không dạy

### Cái giá phải trả

Phải nói thẳng, đây không phải lựa chọn không mất gì:

- **Không có uptime 24/7 ở Cấp 1.** Nhà tuyển dụng mở link demo lúc máy tắt sẽ thấy trang lỗi. Giảm nhẹ bằng: quay sẵn GIF demo trong README, và bật máy trước khi gửi link
- **Tự vận hành mọi thứ.** Không có ai lo backup, patch bảo mật, hay khôi phục khi Mongo hỏng. Với dự án học thì đó là tính năng, nhưng vẫn là công sức thật
- **Băng thông phụ thuộc mạng nhà.** Mạng Việt Nam upload thường yếu hơn download nhiều lần — 3 người cùng xem 1080p có thể làm nghẽn
- **Không học được vận hành cloud thật.** Nếu mục tiêu nghề nghiệp nhắm vào DevOps/SRE thì thiếu hụt này đáng kể — bù bằng cách đọc và làm lab riêng
- **Oracle có rủi ro riêng**: khó lấy máy ARM ở region đông, tài khoản idle có thể bị thu hồi, và kiến trúc ARM64 đòi hỏi build image đa nền tảng
- Thêm việc: build multi-arch trong CI, cấu hình Cloudflare Tunnel, tự viết script backup

### Khi nào nên xem lại

- Khi dự án có người dùng thật và uptime trở thành yêu cầu → một VPS €4/tháng lúc đó là khoản chi hợp lý, và kiến trúc không cần đổi gì (vẫn là Docker Compose)
- Khi mục tiêu chuyển từ "học" sang "sản phẩm"
- Khi cần chứng minh kinh nghiệm vận hành cloud cho một vị trí cụ thể

Kiến trúc được giữ **trung lập với nơi đặt**: mọi thứ chạy trong Docker Compose, cấu hình qua biến môi trường. Chuyển từ laptop sang Oracle sang VPS trả phí chỉ là đổi nơi chạy `docker compose up`, không phải viết lại gì.
