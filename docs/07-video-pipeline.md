# 07 — Video Pipeline

Từ file MP4 admin upload → HLS đa bitrate, mã hóa, phát được với adaptive bitrate.

## 1. Toàn cảnh

```
┌──────────┐   1. presign    ┌──────────┐
│ Admin UI │ ──────────────> │   API    │
└────┬─────┘ <────────────── └────┬─────┘
     │  2. PUT file (trực tiếp)   │ 3. ffprobe + enqueue
     ▼                            ▼
┌──────────────┐           ┌──────────┐
│ MinIO        │           │ BullMQ   │
│ /uploads     │           │ (Redis)  │
└──────┬───────┘           └────┬─────┘
       │  4. download           │ 4. nhận job
       └──────────┬─────────────┘
                  ▼
         ┌─────────────────┐
         │ Transcode Worker│
         │  FFmpeg         │ ── 5. progress ──> Redis pub/sub ──> WS ──> Admin UI
         └────────┬────────┘
                  │ 6. upload HLS
                  ▼
         ┌─────────────────┐
         │ MinIO /media    │
         │  master.m3u8    │
         │  360p/ 480p/    │
         │  720p/ 1080p/   │
         └─────────────────┘
```

## 2. Upload

### 2.1 Tại sao presigned URL?

Nếu upload qua API server: file 2GB đi qua Node → tốn RAM, chiếm connection, timeout. Presigned URL cho browser PUT thẳng lên MinIO — API server chỉ ký một chữ ký rồi đứng ngoài.

### 2.2 Luồng

```jsonc
// 1. POST /admin/media/upload-url
{ "fileName": "sintel.mp4", "sizeBytes": 1073741824, "mimeType": "video/mp4",
  "owner": { "kind": "movie", "titleId": "665f..." } }

// 201 — tạo asset với status 'uploading'
{ "data": {
  "assetId": "665fa...",
  "uploadId": "2~abc...",                      // multipart upload id
  "partSize": 16777216,                        // 16MB mỗi part
  "parts": [ { "partNumber": 1, "url": "https://minio.../?partNumber=1&..." }, ... ]
} }

// 2. Browser PUT từng part song song (3 luồng), thu thập ETag

// 3. POST /admin/media/:assetId/complete
{ "uploadId": "2~abc...",
  "parts": [ { "partNumber": 1, "etag": "\"a1b2...\"" }, ... ] }

// 202 Accepted
{ "data": { "assetId": "665fa...", "status": "probing" } }
```

Multipart cho phép **resume**: mất mạng giữa chừng, client chỉ upload lại part thiếu. Lưu `uploadId` + part đã xong vào IndexedDB.

### 2.3 Validate

| Kiểm tra        | Làm ở đâu              | Chi tiết                                     |
| --------------- | ---------------------- | -------------------------------------------- |
| Kích thước      | API, trước khi presign | Max 20GB                                     |
| Extension       | API                    | `.mp4 .mkv .mov .avi .webm`                  |
| MIME            | API                    | Chỉ để tham khảo — client giả được           |
| **Magic bytes** | Worker, sau khi tải về | `ftyp` cho MP4, `0x1A45DFA3` cho Matroska    |
| **ffprobe**     | Worker                 | Phải có ít nhất 1 video stream, duration > 0 |
| Thời lượng      | Worker                 | Max 6 giờ                                    |

Nếu validate fail ở worker → `asset.status = 'failed'`, xóa object gốc.

> MIME type và extension từ client **không đáng tin**. Nguồn sự thật là ffprobe.

---

## 3. Transcode

### 3.1 Bậc thang rendition

| Tên   | Độ phân giải | Video bitrate | Maxrate | Bufsize | Audio |
| ----- | ------------ | ------------- | ------- | ------- | ----- |
| 360p  | 640×360      | 800k          | 856k    | 1200k   | 96k   |
| 480p  | 854×480      | 1400k         | 1498k   | 2100k   | 128k  |
| 720p  | 1280×720     | 2800k         | 2996k   | 4200k   | 128k  |
| 1080p | 1920×1080    | 5000k         | 5350k   | 7500k   | 192k  |

Chỉ tạo rendition **không vượt quá** độ phân giải nguồn — upscale là lãng phí dung lượng mà không thêm chất lượng. Nguồn 720p → chỉ ra 360p/480p/720p.

Codec: **H.264 High profile** (`libx264`) + **AAC-LC**. Lý do: tương thích mọi thiết bị. H.265/AV1 tiết kiệm băng thông hơn nhưng Safari/Firefox hỗ trợ không đồng đều và encode chậm hơn nhiều — ghi vào [ADR-006](adr/006-codec-choice.md) làm hướng mở rộng.

### 3.2 Tham số then chốt

```bash
ffmpeg -i source.mp4 \
  -filter_complex "[0:v]split=4[v1][v2][v3][v4]; \
     [v1]scale=w=640:h=360 [v1out];  [v2]scale=w=854:h=480 [v2out]; \
     [v3]scale=w=1280:h=720[v3out];  [v4]scale=w=1920:h=1080[v4out]" \
  \
  -map "[v1out]" -c:v:0 libx264 -b:v:0 800k  -maxrate:v:0 856k  -bufsize:v:0 1200k \
  -map "[v2out]" -c:v:1 libx264 -b:v:1 1400k -maxrate:v:1 1498k -bufsize:v:1 2100k \
  -map "[v3out]" -c:v:2 libx264 -b:v:2 2800k -maxrate:v:2 2996k -bufsize:v:2 4200k \
  -map "[v4out]" -c:v:3 libx264 -b:v:3 5000k -maxrate:v:3 5350k -bufsize:v:3 7500k \
  \
  -preset veryfast -crf 23 -profile:v high -level 4.1 -pix_fmt yuv420p \
  -g 48 -keyint_min 48 -sc_threshold 0 \
  \
  -map a:0 -c:a aac -b:a:0 96k  -ac 2 \
  -map a:0 -c:a aac -b:a:1 128k -ac 2 \
  -map a:0 -c:a aac -b:a:2 128k -ac 2 \
  -map a:0 -c:a aac -b:a:3 192k -ac 2 \
  \
  -f hls -hls_time 6 -hls_playlist_type vod \
  -hls_segment_type fmp4 -hls_fmp4_init_filename "init_%v.mp4" \
  -hls_segment_filename "out/%v/seg_%04d.m4s" \
  -hls_key_info_file keyinfo.txt \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0,name:360p v:1,a:1,name:480p v:2,a:2,name:720p v:3,a:3,name:1080p" \
  "out/%v/index.m3u8"
```

**Các tham số quan trọng và tại sao:**

| Tham số                                | Giá trị                                   | Lý do                                                                                                                         |
| -------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `-g 48 -keyint_min 48 -sc_threshold 0` | keyframe cố định mỗi 48 frame (2s @24fps) | **Bắt buộc** cho ABR. Mọi rendition phải có keyframe ở cùng mốc thời gian, nếu không player không chuyển chất lượng mượt được |
| `-hls_time 6`                          | segment 6 giây                            | Cân bằng: ngắn hơn → chuyển bitrate nhanh nhưng nhiều request; dài hơn → ngược lại. 6s là mức Apple khuyến nghị               |
| `-hls_segment_type fmp4`               | fragmented MP4                            | Thay vì MPEG-TS: nhỏ hơn ~10%, dùng chung init segment, là định dạng của CMAF                                                 |
| `-preset veryfast`                     |                                           | Dự án học tập — ưu tiên thời gian encode. Production dùng `slow` để file nhỏ hơn ~25%                                         |
| `-profile:v high -level 4.1`           |                                           | Tương thích tới iPhone 6 trở lên, hầu hết smart TV                                                                            |
| `-pix_fmt yuv420p`                     |                                           | Không có dòng này, một số nguồn ra yuv444p → Safari không phát được                                                           |
| `-maxrate` + `-bufsize`                |                                           | Chặn bitrate đột biến ở cảnh phức tạp, giữ đúng bậc thang ABR                                                                 |

`-hls_time 6` kết hợp `-g 48` nghĩa là mỗi segment bắt đầu đúng tại một keyframe (6s = 3 × 2s GOP).

### 3.3 Mã hóa AES-128

`keyinfo.txt`:

```
https://api.nekoflix.local/v1/media/key/<keyId>
/tmp/<assetId>/enc.key
<16-byte-IV-hex>
```

Dòng 1 là URL ghi vào playlist. Dòng 2 là file key thật (chỉ worker có). Dòng 3 là IV.

Playlist kết quả:

```m3u8
#EXT-X-KEY:METHOD=AES-128,URI="https://api.../v1/media/key/665fb...",IV=0x9c2f...
```

Player sẽ GET URL đó để lấy key. Endpoint `/media/key/:keyId` verify playback token trước khi trả 16 byte raw.

**Đây không phải DRM.** Người dùng đã đăng nhập hợp lệ vẫn có thể lấy key và tải phim về. Nó chỉ chặn truy cập trực tiếp vào segment và scraping ẩn danh. DRM thật cần Widevine/FairPlay — ngoài phạm vi dự án ([00 — Non-goals](00-overview.md#2-non-goals--những-thứ-không-làm)).

### 3.4 Thumbnail sprite (seek preview)

```bash
# Lấy 1 frame mỗi 10 giây, ghép thành lưới 10×10
ffmpeg -i source.mp4 -vf "fps=1/10,scale=160:90,tile=10x10" -q:v 4 sprite_%03d.jpg
```

Kèm file WebVTT định vị:

```vtt
WEBVTT

00:00:00.000 --> 00:00:10.000
sprite_001.jpg#xywh=0,0,160,90

00:00:10.000 --> 00:00:20.000
sprite_001.jpg#xywh=160,0,160,90
```

### 3.5 Poster tự động

```bash
# Frame ở 10% thời lượng — tránh logo studio và màn đen đầu phim
ffmpeg -ss <duration*0.1> -i source.mp4 -frames:v 1 -q:v 2 poster.jpg
```

### 3.6 Phụ đề

- Nguồn có sub nhúng → extract: `ffmpeg -i src.mkv -map 0:s:0 -c:s webvtt out.vtt`
- Admin upload `.srt` → convert sang WebVTT
- WebVTT lưu trên MinIO, phục vụ qua API (có CORS header), khai báo trong master playlist:

```m3u8
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Tiếng Việt",LANGUAGE="vi",AUTOSELECT=YES,DEFAULT=YES,URI="subs/vi.m3u8"
```

---

## 4. Job queue

### 4.1 Định nghĩa job

```ts
// queue: 'transcode'
interface TranscodeJob {
  assetId: string;
  sourceBucket: string;
  sourceKey: string;
  renditions: RenditionName[]; // tính từ độ phân giải nguồn
  generateSprite: boolean;
  generatePoster: boolean;
  extractSubtitles: boolean;
}
```

### 4.2 Cấu hình BullMQ

```ts
new Queue('transcode', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 }, // 30s, 60s, 120s
    removeOnComplete: { age: 86_400, count: 100 },
    removeOnFail: { age: 604_800 }, // giữ 7 ngày để debug
  },
});

new Worker('transcode', processor, {
  connection: redis,
  concurrency: Number(env.TRANSCODE_CONCURRENCY ?? 1), // 1 — FFmpeg đã ăn hết CPU
  lockDuration: 600_000, // 10 phút
  lockRenewTime: 300_000, // gia hạn mỗi 5 phút
  stalledInterval: 60_000,
  maxStalledCount: 2,
});
```

`lockDuration` phải đủ lớn: transcode một phim 2 tiếng mất hàng chục phút. Nếu lock hết hạn giữa chừng, BullMQ coi job là stalled và chạy lại → tốn gấp đôi. Worker gọi `job.extendLock()` định kỳ.

### 4.3 Các bước xử lý và trọng số progress

| Stage         | %      | Việc                             |
| ------------- | ------ | -------------------------------- |
| `downloading` | 0–10   | Tải file gốc từ MinIO về đĩa tạm |
| `validating`  | 10–12  | Magic bytes + ffprobe            |
| `transcoding` | 12–80  | FFmpeg (phần lâu nhất)           |
| `thumbnails`  | 80–85  | Sprite + poster                  |
| `subtitles`   | 85–88  | Extract/convert                  |
| `uploading`   | 88–98  | Đẩy HLS lên MinIO                |
| `finalizing`  | 98–100 | Cập nhật DB, dọn file tạm        |

Parse progress của FFmpeg từ `-progress pipe:1`:

```ts
// FFmpeg in ra 'out_time_us=12345678' — chia cho tổng duration
const match = line.match(/out_time_us=(\d+)/);
if (match) {
  const sec = Number(match[1]) / 1_000_000;
  const pct = 12 + (sec / probe.durationSec) * 68; // map vào dải 12–80
  await reportProgress(assetId, pct, 'transcoding');
}
```

`reportProgress` throttle 2 giây/lần — publish lên Redis channel `transcode:progress`, và chỉ ghi Mongo mỗi 10%.

### 4.4 Idempotency & cleanup

- Job chạy lại (retry hoặc stalled) phải **xóa output cũ trước** — nếu không sẽ lẫn segment của lần chạy trước
- Thư mục tạm: `/tmp/nekoflix/<assetId>`, luôn xóa trong `finally`
- Worker nhận `SIGTERM` → dừng nhận job mới, kill process FFmpeg, để BullMQ trả job về queue
- Job fail hết 3 lần → `asset.status = 'failed'`, lưu stderr của FFmpeg (giới hạn 4KB) vào `asset.error`, emit `transcode:failed`

```ts
async function process(job: Job<TranscodeJob>) {
  const tmp = `/tmp/nekoflix/${job.data.assetId}`;
  try {
    await cleanupPreviousOutput(job.data.assetId); // idempotent
    await fs.mkdir(tmp, { recursive: true });
    await download(job, tmp);
    const probe = await validate(job, tmp);
    await transcode(job, tmp, probe);
    await generateThumbnails(job, tmp, probe);
    await uploadResults(job, tmp);
    await finalize(job, probe);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
```

### 4.5 Ước lượng thời gian

Đo thực tế trên 4 vCPU, preset `veryfast`, ra 4 rendition:

| Nguồn | Thời lượng | Transcode | Tỉ lệ |
| ----- | ---------- | --------- | ----- |
| 1080p | 10 phút    | ~6 phút   | 0.6×  |
| 1080p | 2 giờ      | ~70 phút  | 0.58× |
| 720p  | 2 giờ      | ~45 phút  | 0.37× |

Dung lượng output ≈ 1.6× dung lượng gốc (tổng 4 rendition).

Nếu cần nhanh hơn: chia video thành chunk theo keyframe, transcode song song, rồi `concat` — phức tạp đáng kể, chỉ làm nếu thực sự cần (ghi vào roadmap P2).

---

## 5. Phục vụ playback

### 5.1 Master playlist động

Không phục vụ file `master.m3u8` tĩnh từ MinIO. API **sinh lại** theo quyền của người dùng:

```ts
@Get('manifest/:assetId/master.m3u8')
async master(@Param('assetId') assetId: string, @Query('token') token: string) {
  const claims = this.verifyPlaybackToken(token, assetId);
  const asset = await this.assets.findReady(assetId);

  const allowed = asset.hls.renditions.filter(
    r => QUALITY_ORDER[r.name] <= QUALITY_ORDER[claims.q],
  );

  const lines = ['#EXTM3U', '#EXT-X-VERSION:7'];
  for (const r of allowed) {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${r.bitrateKbps * 1000},` +
      `RESOLUTION=${r.width}x${r.height},CODECS="avc1.64001f,mp4a.40.2"`,
      `${r.name}/index.m3u8?token=${token}`,
    );
  }
  return lines.join('\n');
}
```

Header: `Content-Type: application/vnd.apple.mpegurl`, `Cache-Control: no-store`.

### 5.2 Variant playlist

Cũng sinh động, vì phải chèn `token` vào URL mọi segment. Nội dung segment list đọc từ MinIO một lần rồi cache ở Redis 1 giờ (danh sách segment là bất biến).

### 5.3 Segment

Hai lựa chọn:

**A. Redirect sang presigned URL (chọn phương án này)**

```
GET /media/seg/:assetId/:rendition/:file?token=...
  → verify token
  → 302 tới presigned MinIO URL (TTL 2 phút)
```

API server không đụng vào byte nào của video. Nhược: thêm một round trip cho mỗi segment.

**B. Proxy stream qua API**
Đơn giản cho client nhưng API server gánh toàn bộ băng thông — không chấp nhận được.

Khi deploy thật, đặt CDN trước MinIO và dùng **signed cookie** thay presigned URL để tránh redirect.

### 5.4 Header cache

| Tài nguyên                  | Cache-Control                         |
| --------------------------- | ------------------------------------- |
| `master.m3u8`, `index.m3u8` | `no-store` (chứa token)               |
| `init.mp4`, `seg_*.m4s`     | `public, max-age=31536000, immutable` |
| Sprite, poster              | `public, max-age=31536000, immutable` |
| WebVTT                      | `public, max-age=3600`                |
| `/media/key/:id`            | `no-store`                            |

---

## 6. Client — hls.js

```ts
const hls = new Hls({
  maxBufferLength: 30, // giây video giữ trong buffer
  maxMaxBufferLength: 60,
  startLevel: -1, // -1 = để ABR tự chọn level đầu
  abrEwmaDefaultEstimate: 1_000_000, // đoán 1Mbps khi chưa có dữ liệu
  abrBandWidthFactor: 0.95, // dùng 95% băng thông đo được, chừa biên an toàn
  abrBandWidthUpFactor: 0.7, // bảo thủ khi nâng chất lượng
  enableWorker: true, // demux trong Web Worker, không chặn main thread
  lowLatencyMode: false, // VOD, không cần
  fragLoadPolicy: {
    default: {
      maxTimeToFirstByteMs: 10_000,
      maxLoadTimeMs: 120_000,
      timeoutRetry: { maxNumRetry: 2 },
      errorRetry: { maxNumRetry: 4 },
    },
  },
});

hls.loadSource(manifestUrl);
hls.attachMedia(video);

// Safari hỗ trợ HLS native — không dùng hls.js
if (!Hls.isSupported() && video.canPlayType('application/vnd.apple.mpegurl')) {
  video.src = manifestUrl;
}
```

### Xử lý lỗi

```ts
hls.on(Hls.Events.ERROR, (_, data) => {
  if (!data.fatal) return; // lỗi không fatal → hls.js tự xử lý

  switch (data.type) {
    case Hls.ErrorTypes.NETWORK_ERROR:
      if (data.response?.code === 401 || data.response?.code === 403) {
        // Playback token hết hạn → xin token mới rồi load lại
        return renewPlaybackTokenAndReload();
      }
      return hls.startLoad(); // lỗi mạng tạm thời

    case Hls.ErrorTypes.MEDIA_ERROR:
      hls.recoverMediaError(); // thử phục hồi
      return;

    default:
      hls.destroy();
      showFatalError();
  }
});
```

Token TTL 6 giờ nhưng phim có thể dài hơn hoặc user để tab mở lâu — phải xử lý trường hợp token hết hạn giữa chừng, giữ nguyên `currentTime` khi load lại.

---

## 7. Dọn dẹp & lưu trữ

| Đối tượng             | Chính sách                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| File gốc (`uploads/`) | Giữ 30 ngày sau khi transcode xong, rồi lifecycle rule tự xóa. Giữ để re-transcode khi đổi tham số |
| Asset `failed`        | Giữ 7 ngày để debug, rồi xóa                                                                       |
| HLS output            | Giữ đến khi asset bị xóa thủ công                                                                  |
| Xóa title             | Xóa cascade asset + mọi object trên MinIO (chạy qua job `media-cleanup`)                           |

Cron hàng ngày đối chiếu DB ↔ MinIO, báo cáo **orphan object** (có trên MinIO mà không có trong DB) — không tự xóa, chỉ log để admin xem.

---

## 8. Checklist khi làm phần này

- [ ] Multipart upload resume được sau khi mất mạng
- [ ] ffprobe từ chối file không phải video (thử đổi tên `.exe` thành `.mp4`)
- [ ] Nguồn 720p chỉ ra 3 rendition, không upscale
- [ ] Keyframe thẳng hàng giữa các rendition (kiểm bằng `ffprobe -show_frames`)
- [ ] Chuyển chất lượng mượt khi bóp băng thông (Chrome DevTools → Network throttling)
- [ ] Segment không truy cập được nếu không có token
- [ ] Key endpoint từ chối token của asset khác
- [ ] Gói Basic không thấy variant 1080p trong master playlist
- [ ] Kill worker giữa chừng → job được chạy lại sạch sẽ, không lẫn output cũ
- [ ] Progress bar realtime chạy mượt từ 0 đến 100

---

**Tiếp theo**: [08 — Frontend Architecture](08-frontend-architecture.md)
