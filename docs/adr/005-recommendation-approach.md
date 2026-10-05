# ADR-005: Recommendation lai content-based + item-item CF, không dùng ML

**Trạng thái**: Accepted
**Ngày**: 2026-10-05

## Bối cảnh

Trang chủ cần các row "Dành cho bạn", "Vì bạn đã xem X", "More Like This". Đây là tính năng dễ bị over-engineer nhất của dự án.

Thực tế về dữ liệu ở quy mô Nekoflix:

- ~50 title
- Vài trăm user, mỗi người xem vài chục phim
- Ma trận user × item cực kỳ thưa và nhỏ

## Các lựa chọn

### A. Hardcode — tất cả mọi người thấy cùng danh sách Trending

### B. Content-based thuần — gợi ý theo độ tương đồng về genre/cast/keyword

### C. Content-based + item-item collaborative filtering ← chọn

### D. Matrix factorization (ALS/SVD) hoặc neural network

## Quyết định

Chọn **C**: content-based làm nền, item-item CF chồng lên khi đủ dữ liệu.

Lý do cốt lõi: **ở quy mô vài trăm user và 50 phim, mô hình ML sẽ cho kết quả tệ hơn một heuristic tốt**, vì không có đủ dữ liệu để học. Matrix factorization cần ma trận tương tác dày; với dữ liệu thưa như thế này nó sẽ overfit hoặc cho ra kết quả ngẫu nhiên — chỉ phức tạp hơn mà không tốt hơn.

Phương án A quá nghèo nàn — không thể hiện được gì. Phương án D là over-engineering rõ ràng: thêm Python service, thêm pipeline training, thêm model versioning, để phục vụ một bài toán mà dữ liệu còn chưa đủ.

### Tầng 1 — Content-based

Mỗi title có vector đặc trưng; mỗi profile có vector sở thích tích lũy từ hành vi.

```ts
// Vector title: genre (one-hot) + top cast + keyword, chuẩn hóa L2
function titleVector(t: Title): Vector {
  return normalize({
    ...Object.fromEntries(t.genreIds.map((g) => [`g:${g}`, 1])),
    ...Object.fromEntries(t.credits.cast.slice(0, 5).map((c) => [`p:${c.personId}`, 0.5])),
    ...Object.fromEntries(t.keywords.slice(0, 10).map((k) => [`k:${k}`, 0.3])),
  });
}

// Vector profile: cập nhật tăng dần theo sự kiện, có suy giảm theo thời gian
const SIGNAL_WEIGHT = {
  completed: 1.0, // xem hết
  watched_half: 0.5,
  love: 1.5,
  like: 1.0,
  dislike: -1.0,
  added_to_list: 0.8,
  abandoned_early: -0.3, // bỏ dở dưới 10%
};

// Mỗi tuần nhân toàn bộ vector với 0.95 — sở thích cũ nhạt dần
```

Gợi ý = cosine similarity giữa vector profile và vector title, loại bỏ title đã xem.

### Tầng 2 — Item-item collaborative filtering

Chạy cron hàng đêm, tính ma trận tương đồng giữa các title dựa trên đồng xuất hiện trong lịch sử xem:

```
sim(A, B) = |users đã xem cả A và B| / sqrt(|xem A| × |xem B|)
```

Lưu top 20 title tương đồng cho mỗi title vào collection `titleSimilarity`. Chỉ tính khi một cặp có ít nhất **5 user đồng xem** — dưới ngưỡng đó là nhiễu.

### Kết hợp

```
score(profile, title) = 0.6 × contentScore + 0.4 × cfScore + 0.1 × popularityBoost

Nếu profile có < 5 title đã xem  → chỉ dùng content + popularity (cold start)
Nếu cặp title chưa đủ 5 đồng xem → cfScore = 0
```

Trọng số bắt đầu từ các giá trị trên, điều chỉnh bằng cảm quan sau khi xem kết quả thật. Không có ground truth để tối ưu, nên đừng giả vờ là có.

### Đa dạng hóa

Sau khi xếp hạng, áp một bước đơn giản: không để quá 3 title cùng genre liên tiếp trong một row. Không có bước này, "Dành cho bạn" sẽ toàn phim hành động và trông như hỏng.

## Hệ quả

### Tích cực

- Không thêm dependency, không thêm service, không thêm ngôn ngữ
- Giải thích được tại sao một phim được gợi ý — làm được tính năng "Vì bạn đã xem X"
- Content-based hoạt động ngay cả khi chỉ có 1 user (cold start của hệ thống, không chỉ của user)
- Tính CF hàng đêm nên không ảnh hưởng latency của request
- Debug được bằng cách in ra vector và điểm số

### Cái giá phải trả

- **Không khám phá được sở thích bất ngờ.** Content-based có xu hướng tạo "bong bóng lọc" — thích phim hành động thì mãi chỉ thấy phim hành động. Giảm nhẹ bằng bước đa dạng hóa và trộn 10–20% title ngẫu nhiên từ Trending
- Trọng số chỉnh bằng cảm tính, không có cơ sở định lượng
- CF cần dữ liệu tích lũy — vài tuần đầu gần như vô dụng
- Vector sở thích lưu trong document profile → có trần ~30 key, không mở rộng tùy ý được
- Chất lượng gợi ý sẽ không bằng Netflix thật. Đây là sự thật chấp nhận được, không phải lỗi

### Khi nào nên xem lại

- Khi có > 10.000 user và > 1.000 title — lúc đó matrix factorization bắt đầu có nghĩa
- Khi có đủ traffic để chạy A/B test — không có A/B test thì không biết mô hình phức tạp hơn có thực sự tốt hơn không
- Khi tính CF hàng đêm vượt quá 10 phút — lúc đó cần thuật toán tăng dần thay vì tính lại từ đầu

Trước khi chuyển sang D, bước hợp lý tiếp theo là **learning-to-rank đơn giản** (logistic regression trên vài chục feature), không phải nhảy thẳng sang deep learning.
