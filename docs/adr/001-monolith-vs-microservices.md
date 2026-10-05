# ADR-001: Monolith modular thay vì microservices

**Trạng thái**: ⛔ **Superseded by [ADR-010](010-microservices.md)** (2026-10-05)
**Ngày**: 2026-10-05

> **Ghi chú khi supersede** — giữ nguyên nội dung bên dưới làm lịch sử.
>
> ADR này lập luận đúng **với giả định đã nêu trong phần Bối cảnh**: mục tiêu là hoàn thành sản phẩm trong ~12 tuần. Giả định đó sau này được chủ dự án đính chính: mục tiêu thật là **học kiến trúc phân tán**, sản phẩm chỉ là phương tiện.
>
> Khi hàm mục tiêu đổi, kết luận đổi theo. Phần phân tích "chi phí của microservices" bên dưới vẫn chính xác — chỉ là ở ADR-010, những chi phí đó được xếp vào cột _lợi ích_ (chúng chính là thứ cần học), chứ không phải cột _thiệt hại_.

## Bối cảnh

Nekoflix có nhiều domain khá tách bạch: auth, catalog, media processing, realtime, billing. Nhìn vào danh sách này, phản xạ đầu tiên là tách microservices — mỗi domain một service. Netflix thật chạy hàng trăm microservices.

Ràng buộc thực tế của dự án:

- **Một người làm**, part-time, ~12 tuần
- Chạy toàn bộ trên một máy local phải dễ dàng
- Mục tiêu là học và demo, không phải phục vụ triệu người dùng
- Có một workload **thực sự khác biệt**: transcode video ăn 100% CPU trong hàng chục phút

## Các lựa chọn

### A. Microservices đầy đủ

Mỗi domain một service riêng, giao tiếp qua message broker hoặc gRPC, mỗi service một database.

### B. Monolith thuần

Tất cả trong một process, kể cả transcode.

### C. Monolith modular + worker tách riêng ← chọn

Một API process chia thành NestJS module với ranh giới rõ ràng, cộng một worker process riêng cho transcode.

## Quyết định

Chọn **C**.

Lý do cốt lõi: **chi phí của microservices là có thật và trả ngay, còn lợi ích thì chỉ xuất hiện ở quy mô mà dự án này không có.**

Microservices ở đây sẽ phải trả giá bằng: service discovery, distributed tracing, saga cho transaction liên service, N lần CI/CD pipeline, N lần Dockerfile, debug qua nhiều service, và data consistency trở thành bài toán phân tán. Đổi lại được gì? Khả năng scale từng domain độc lập — thứ không cần ở 50 phim và vài trăm người dùng.

Phương án B bị loại vì một lý do kỹ thuật cụ thể: FFmpeg chạy đồng bộ sẽ chặn event loop của Node. Một job transcode làm toàn bộ API đứng hình trong 40 phút. Đây không phải vấn đề scale — đây là lỗi chức năng. Nên worker **bắt buộc** tách.

Ranh giới module trong monolith được giữ nghiêm bằng ESLint (`import/no-restricted-paths`) để nếu sau này thật sự cần tách service, đường cắt đã sẵn.

## Hệ quả

### Tích cực

- Một `pnpm dev` là chạy được tất cả
- Transaction trong một database — không cần saga, không cần eventual consistency
- Debug bằng một debugger, một stack trace
- Deploy đơn giản: 3 container (web, api, worker)
- Refactor ranh giới module rẻ — chỉ là di chuyển file, không phải thay đổi API contract giữa service

### Cái giá phải trả

- API server là single point of failure cho mọi tính năng HTTP/WS
- Không scale riêng được từng domain. Nếu search ăn hết CPU thì cả auth cũng chậm theo
- Deploy phải deploy cả API, không thể release riêng module billing
- Ranh giới module chỉ được giữ bằng kỷ luật + lint, không có rào chắn vật lý như network boundary. Dễ bị phá nếu lười
- Codebase API sẽ lớn dần, build time tăng

### Khi nào nên xem lại

- Khi một domain cụ thể cần scale khác hẳn phần còn lại (vd: search service cần nhiều RAM)
- Khi có nhiều hơn 3–4 người làm cùng lúc và liên tục đụng độ merge
- Khi build time của API vượt 2 phút
- Khi cần deploy độc lập vì lý do nghiệp vụ (billing không được downtime khi deploy catalog)

Ứng viên tách đầu tiên nếu đến lúc đó: **realtime gateway** (stateful, kết nối dài, pattern scale khác hẳn REST API).
