# ADR-006: H.264 + AAC, đóng gói HLS fMP4

**Trạng thái**: Accepted
**Ngày**: 2026-10-05

## Bối cảnh

Phải chọn ba thứ, liên quan nhưng độc lập nhau:

1. **Video codec** — nén hình
2. **Streaming protocol** — HLS hay DASH
3. **Container/segment format** — MPEG-TS hay fMP4

Ràng buộc: chạy được trên Chrome, Firefox, Safari, Edge, và điện thoại; transcode trên VPS 4 vCPU không mất cả ngày.

## 1. Video codec

### Các lựa chọn

| Codec         | Tiết kiệm bitrate vs H.264 | Hỗ trợ browser                                     | Tốc độ encode                             |
| ------------- | -------------------------- | -------------------------------------------------- | ----------------------------------------- |
| **H.264/AVC** | — (mốc)                    | Mọi nơi, kể cả thiết bị 2010                       | Nhanh nhất                                |
| H.265/HEVC    | ~40%                       | Safari có; Chrome/Firefox **không** (vướng patent) | Chậm hơn ~3x                              |
| VP9           | ~35%                       | Chrome/Firefox/Edge; Safari hạn chế                | Chậm hơn ~5x                              |
| AV1           | ~50%                       | Chrome/Firefox mới; Safari 17+ (có phần cứng)      | Chậm hơn ~20x với libaom, ~5x với SVT-AV1 |

### Quyết định: **H.264 High profile, level 4.1**

Lý do cốt lõi: **không có codec nào ngoài H.264 phát được trên mọi browser mà không cần làm nhiều bản.**

HEVC bị loại vì Chrome và Firefox không hỗ trợ — đó là phần lớn người dùng. VP9 bị loại vì Safari hỗ trợ không trọn vẹn, và Safari là browser bắt buộc phải chạy (iPhone). AV1 nén tốt nhất nhưng encode chậm tới mức không chấp nhận được cho dự án này: một phim 2 tiếng sẽ mất hàng chục giờ trên 4 vCPU.

Nếu muốn hỗ trợ nhiều codec thì phải transcode **nhiều bộ rendition** và khai báo đa codec trong master playlist — nhân đôi/ba thời gian transcode và dung lượng lưu trữ. Với mục tiêu dự án, đổi lấy tiết kiệm băng thông là không đáng.

`-profile:v high -level 4.1` tương thích từ iPhone 6 trở lên và hầu hết smart TV. `-pix_fmt yuv420p` là bắt buộc — nếu không, một số nguồn ra `yuv444p` và Safari từ chối phát mà không báo lỗi rõ ràng.

**Preset `veryfast`** cho dự án này. Preset `slow` cho file nhỏ hơn ~25% ở cùng chất lượng, nhưng encode lâu gấp 3 lần. Khi nào băng thông thành vấn đề thì đổi — nó chỉ là một flag.

## 2. Streaming protocol

### Các lựa chọn

**HLS** (Apple) — `.m3u8`. Hỗ trợ native trên Safari và iOS.
**MPEG-DASH** — `.mpd`. Chuẩn quốc tế, linh hoạt hơn. **Safari không hỗ trợ native.**

### Quyết định: **HLS**

Safari/iOS phát HLS native, không cần JavaScript. Với DASH thì phải dùng `dash.js` trên mọi browser, kể cả Safari — thêm một lớp phụ thuộc cho nền tảng lẽ ra đơn giản nhất.

Trên các browser khác, `hls.js` chạy ổn định và trưởng thành (dùng trong production ở nhiều nền tảng lớn). Vậy HLS phủ được tất cả, DASH thì không.

DASH linh hoạt hơn ở một số điểm (multi-period, hỗ trợ nhiều DRM cùng lúc) — nhưng những điểm đó đều ngoài phạm vi dự án.

## 3. Segment format

### Các lựa chọn

**MPEG-TS** (`.ts`) — định dạng gốc của HLS, kế thừa từ truyền hình số
**fMP4 / CMAF** (`.m4s`) — HLS hỗ trợ từ iOS 10 (2016)

### Quyết định: **fMP4**

| Tiêu chí                    | MPEG-TS                        | fMP4                |
| --------------------------- | ------------------------------ | ------------------- |
| Overhead                    | ~10% (padding 188-byte packet) | Thấp                |
| Dùng chung init segment     | Không                          | Có                  |
| Dùng chung segment với DASH | Không                          | Có (CMAF)           |
| Hỗ trợ                      | Mọi phiên bản HLS              | iOS 10+, Android 5+ |

fMP4 nhỏ hơn và là nền tảng của CMAF — nếu sau này muốn thêm DASH, có thể **dùng chung segment**, chỉ cần sinh thêm manifest. Đó là một đường mở miễn phí.

Cái mất: thiết bị trước 2016 không phát được. Chấp nhận.

## 4. Audio

**AAC-LC, stereo**, bitrate theo rendition (96k → 192k).

AAC là codec audio duy nhất được hỗ trợ phổ quát trong ngữ cảnh HLS. Opus nén tốt hơn đáng kể nhưng không nằm trong spec HLS chính thống và Safari không phát trong HLS.

Downmix mọi thứ về stereo. Surround 5.1 cần nhiều audio track, nhiều bitrate, và phần lớn người dùng web nghe bằng tai nghe hoặc loa laptop — không đáng độ phức tạp.

## Hệ quả

### Tích cực

- Một bộ rendition duy nhất phát được mọi nơi
- Encode nhanh, iterate nhanh trong lúc phát triển
- Safari/iOS hoạt động không cần JavaScript
- fMP4 để ngỏ đường thêm DASH sau này mà không phải transcode lại

### Cái giá phải trả

- **Tốn băng thông hơn rõ rệt.** So với AV1, cùng chất lượng cảm nhận thì H.264 tốn gần gấp đôi bitrate. Với streaming video, băng thông chính là chi phí vận hành lớn nhất — đây là cái giá thật, không nhỏ
- Dung lượng lưu trữ lớn hơn
- Không khai thác được phần cứng decode AV1/HEVC trên thiết bị mới
- Không có 5.1 surround
- Thiết bị trước 2016 không phát được (do fMP4)

### Khi nào nên xem lại

- Khi chi phí băng thông đo được và đáng kể → thêm một bộ rendition AV1 cho browser hỗ trợ, giữ H.264 làm fallback. Master playlist khai báo cả hai, player tự chọn
- Khi SVT-AV1 đủ nhanh trên phần cứng đang dùng (đo lại định kỳ — mảng này tiến bộ nhanh)
- Nếu có GPU encode (NVENC) → thử HEVC cho Safari, vì encode không còn là nút thắt

Thứ tự ưu tiên nếu mở rộng: **AV1 trước HEVC**, vì AV1 miễn phí bản quyền và đang được hỗ trợ ngày càng rộng, trong khi HEVC vướng patent pool phức tạp.
