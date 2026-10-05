# ADR-002: argon2id thay vì bcrypt

**Trạng thái**: Accepted
**Ngày**: 2026-10-05

## Bối cảnh

Cần chọn thuật toán hash password. bcrypt là lựa chọn mặc định của phần lớn tutorial Node.js, `bcrypt` và `bcryptjs` có hàng triệu lượt tải mỗi tuần.

## Các lựa chọn

### A. bcrypt

Ra đời 1999. Chống brute-force bằng cost factor (số vòng lặp). Giới hạn input 72 byte.

### B. scrypt

Có sẵn trong `crypto` của Node, không cần dependency. Memory-hard.

### C. argon2id ← chọn

Thắng Password Hashing Competition 2015. Biến thể `id` kết hợp chống GPU (argon2d) và chống side-channel (argon2i).

## Quyết định

Chọn **argon2id** với tham số theo khuyến nghị OWASP:

```ts
{ type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }
```

Lý do cốt lõi: bcrypt chỉ **CPU-hard**, còn argon2id là **memory-hard**. Một GPU hiện đại có hàng nghìn core nhưng băng thông bộ nhớ hạn chế — argon2id với 19MB mỗi lần hash làm giảm mạnh số phép thử song song mà kẻ tấn công thực hiện được trên cùng phần cứng. Đây là khác biệt thực chất, không phải "mới hơn nên tốt hơn".

Ngoài ra bcrypt có một cạm bẫy ít người biết: **im lặng cắt input ở 72 byte**. Password dài hơn 72 ký tự, hoặc password đã qua pre-hash base64, sẽ bị cắt mà không báo lỗi. Người dùng đặt passphrase dài tưởng mình an toàn hơn — thực tế không.

scrypt (B) cũng memory-hard và có sẵn trong Node, nhưng tuning tham số khó hơn và không có khuyến nghị chuẩn hóa rõ như argon2id trong OWASP Cheat Sheet.

## Hệ quả

### Tích cực

- Kháng tấn công GPU/ASIC tốt hơn đáng kể
- Không có giới hạn độ dài input
- Tham số điều chỉnh được theo 3 chiều (memory, time, parallelism)
- Là khuyến nghị số 1 của OWASP tính tới thời điểm viết

### Cái giá phải trả

- Cần native module `argon2` → cần build toolchain khi cài, image Docker phải có `python3`, `make`, `g++` ở stage build
- **Mỗi lần login tốn ~19MB RAM tạm thời.** Đây là con số phải tính: 50 login đồng thời = ~1GB RAM spike. Phải giới hạn concurrency ở tầng rate limit, và cân nhắc giảm `memoryCost` nếu VPS chỉ 2GB
- Chậm hơn bcrypt ở cùng mức bảo mật danh nghĩa (~50-100ms/hash) — nhưng đó chính là mục đích
- Ít tài liệu tiếng Việt hơn bcrypt khi debug

### Ghi chú triển khai

Luôn chạy verify với hash giả khi email không tồn tại, để thời gian phản hồi không tiết lộ thông tin:

```ts
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$...';
const ok = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, password);
```

Lưu tham số trong chính chuỗi hash (argon2 làm sẵn) → nâng tham số sau này chỉ cần re-hash khi user login thành công:

```ts
if (argon2.needsRehash(user.passwordHash, CURRENT_OPTIONS)) {
  user.passwordHash = await argon2.hash(password, CURRENT_OPTIONS);
  await user.save();
}
```

### Khi nào nên xem lại

- Nếu RAM của server trở thành nút thắt → giảm `memoryCost` xuống 9216 (vẫn trong khuyến nghị OWASP, bù bằng `timeCost: 3`)
- Nếu native build gây quá nhiều phiền ở CI → cân nhắc `@node-rs/argon2` (Rust, prebuilt binary)
