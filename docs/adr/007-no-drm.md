# ADR-007: AES-128 + signed URL thay vì DRM thương mại

**Trạng thái**: Accepted
**Ngày**: 2026-10-05

## Bối cảnh

Netflix và mọi nền tảng streaming thương mại dùng DRM (Widevine của Google, FairPlay của Apple, PlayReady của Microsoft) để chống sao chép nội dung. Câu hỏi: Nekoflix có cần không, và có làm được không?

## Các lựa chọn

### A. Không bảo vệ gì — segment public trên CDN

### B. Signed URL + AES-128 HLS encryption ← chọn

### C. Widevine L3 + FairPlay qua một DRM service (vd EZDRM, Axinom)

### D. Tự dựng license server

## Quyết định

Chọn **B**.

### Tại sao không chọn C hay D

Rào cản của DRM thương mại không phải kỹ thuật, mà là **thủ tục và pháp lý**:

- **Widevine**: phải đăng ký với Google, ký thỏa thuận, được cấp credential. Google xét duyệt theo từng tổ chức, không cấp cho dự án cá nhân học tập.
- **FairPlay**: cần tài khoản Apple Developer và phải nộp đơn xin Deployment Package riêng. Quy trình xét duyệt dành cho doanh nghiệp có nội dung hợp pháp.
- **DRM service bên thứ ba**: EZDRM, Axinom, BuyDRM đều có phí tối thiểu hàng tháng, thường từ vài trăm USD.
- **Tự dựng license server (D)**: về mặt kỹ thuật là không khả thi — CDM (Content Decryption Module) nằm trong browser và chỉ nói chuyện với license server được cấp phép. Không có đường tự làm.

Thêm nữa, DRM chỉ có ý nghĩa khi có **nội dung có bản quyền cần bảo vệ**. Nekoflix dùng video Creative Commons và public domain ([00 — Pháp lý](../00-overview.md#5-pháp-lý--nội-dung)). Bảo vệ bằng DRM thứ mà giấy phép cho phép phân phối tự do là vô nghĩa.

### Những gì phương án B thực sự làm được

```
1. Playback token (JWT, TTL 6h, bind với assetId + deviceId)
   → không có token, không lấy được manifest

2. Master playlist sinh động theo quyền
   → gói Basic không bao giờ thấy URL của rendition 1080p

3. Segment chỉ truy cập qua presigned URL TTL 2 phút
   → URL copy ra ngoài sẽ chết sau 2 phút

4. HLS AES-128: mỗi segment được mã hóa, key nằm sau endpoint có authz
   → tải segment về cũng không phát được nếu không có key

5. Stream limit theo Redis
   → chia sẻ tài khoản bị giới hạn
```

## Hệ quả

### Tích cực

- Không cần giấy phép, không chi phí, triển khai được ngay
- Chặn hoàn toàn truy cập ẩn danh và hotlinking
- Chặn scraping tự động ở mức cơ bản
- Phân tầng chất lượng theo gói cước hoạt động thật
- Học được cơ chế nền tảng của bảo vệ nội dung — chính là lớp mà DRM xây lên trên

### Cái giá phải trả — phải nói thẳng

**Đây không phải DRM và không chống được người dùng có chủ đích.**

Một người đã đăng nhập hợp lệ có thể:

- Mở DevTools, đọc playback token
- Gọi `/media/key/:keyId` lấy khóa AES-128 (họ có quyền — token của họ hợp lệ)
- Dùng `ffmpeg` hoặc `yt-dlp` tải toàn bộ segment và giải mã
- Có file MP4 hoàn chỉnh trong vài phút

Khóa AES-128 trong HLS **bắt buộc phải gửi tới client dưới dạng plaintext** để player giải mã được. Không có cách nào quanh điều này nếu không có CDM — và CDM chính là thứ DRM cung cấp.

Nói cách khác: phương án B chặn người ngoài, không chặn người trong. Nó nâng chi phí sao chép từ "0 công sức" lên "cần biết dùng công cụ" — có giá trị thực tế, nhưng đừng nhầm nó với bảo vệ bản quyền.

Những cái mất khác:

- Chi phí tính toán cho mã hóa/giải mã (nhỏ, nhưng có)
- Thêm một round trip để lấy key ở đầu mỗi phiên phát
- Nếu key endpoint chết, video không phát được dù segment vẫn còn

### Nguyên tắc triển khai bắt buộc

- Khóa AES lưu **mã hóa** trong Mongo (AES-256-GCM với `APP_ENCRYPTION_KEY`), không lưu plaintext
- Endpoint `/media/key/:keyId` phải verify playback token **và** kiểm tra token đó đúng với asset sở hữu key — nếu không, một token hợp lệ của phim A sẽ mở được khóa của phim B
- Không bao giờ log nội dung khóa
- `Cache-Control: no-store` trên response trả key

### Khi nào nên xem lại

- Nếu dự án chuyển sang phân phối nội dung có bản quyền thật — lúc đó DRM là **bắt buộc về mặt pháp lý**, không phải lựa chọn kỹ thuật
- Nếu có ngân sách và pháp nhân để làm việc với Widevine/FairPlay

Khi đó, phần đã làm không bị bỏ đi: kiến trúc playback token, master playlist động, và stream limit vẫn giữ nguyên. Chỉ thay lớp mã hóa AES-128 bằng CENC + license server.
