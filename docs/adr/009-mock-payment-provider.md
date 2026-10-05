# ADR-009: Mock payment provider tự viết thay vì Stripe

**Trạng thái**: Accepted
**Ngày**: 2026-10-05
**Thay thế**: quyết định "dùng Stripe test mode" trong bản tài liệu đầu

## Bối cảnh

Nekoflix có tính năng subscription 4 gói, ảnh hưởng tới chất lượng video tối đa và số luồng đồng thời. Cần một cơ chế thanh toán để hoàn thiện luồng nghiệp vụ.

Bản tài liệu đầu chọn Stripe test mode. Sau khi chốt ràng buộc chi phí 0đ ([ADR-008](008-zero-cost-infrastructure.md)), cần xem lại.

**Cần nói rõ một điều**: Stripe test mode **không mất phí**. Nếu lý do duy nhất là tiền thì Stripe vẫn hợp lệ. Nhưng khi xem xét lại, có những lý do khác mạnh hơn.

## Các lựa chọn

### A. Stripe test mode

### B. VNPay / MoMo sandbox

### C. Mock payment provider tự viết ← chọn

### D. Bỏ hẳn billing, hardcode gói cho mỗi user

## Quyết định

Chọn **C**: tự viết một cổng thanh toán mô phỏng chạy trong chính codebase, bắt chước mô hình của Stripe (checkout session → webhook có chữ ký → cập nhật trạng thái).

### Vì sao không phải Stripe (A)

1. **Cần tài khoản và xác minh.** Stripe hỗ trợ pháp nhân Việt Nam rất hạn chế. Đăng ký test-only vẫn đòi thông tin doanh nghiệp, và tài khoản có thể bị khóa sau một thời gian không hoạt động — lúc đó demo chết.
2. **Khó test nhánh thất bại.** Đây mới là lý do kỹ thuật thật. Stripe có thẻ test cho vài tình huống, nhưng để dựng được chuỗi "thanh toán hỏng 3 kỳ liên tiếp → `past_due` → `canceled`" thì phải thao tác qua dashboard, chờ đợi, hoặc dùng clock simulation API khá rườm rà. Với mock provider, đó là một nút bấm.
3. **Webhook ở local cần tunnel.** Phải chạy `stripe listen --forward-to` hay ngrok mới nhận được webhook. Thêm một thứ nữa phải bật mỗi lần code.
4. **Phụ thuộc bên ngoài cho tính năng không phải trọng tâm.** Billing không phải thứ làm Nekoflix thú vị. Video pipeline và realtime mới là.

### Vì sao không phải VNPay/MoMo (B)

Sandbox của cả hai đều yêu cầu đăng ký doanh nghiệp, tài liệu thay đổi thường xuyên, và mô hình của họ là **thanh toán một lần** chứ không có subscription recurring — tức là phải tự xây phần recurring đằng nào cũng vậy.

### Vì sao không phải D

Bỏ hẳn billing thì mất luôn những bài học giá trị nhất của mảng này: idempotency, xử lý webhook out-of-order, state machine của subscription, reconciliation. Đây là các vấn đề **phân tán** kinh điển, gặp ở mọi hệ thống tích hợp bên thứ ba — đáng học hơn bản thân việc gọi API Stripe.

### Mock provider làm gì

Mô phỏng đúng mô hình của Stripe, không đơn giản hóa những chỗ quan trọng:

```
POST /billing/checkout
  → tạo checkoutSession (status: open, TTL 30 phút)
  → trả checkoutUrl = /mock-pay/:sessionId

GET /mock-pay/:sessionId
  → trang HTML mô phỏng cổng thanh toán
  → 5 nút: Thành công | Thẻ bị từ chối | Không đủ số dư | Hết hạn | Hủy

POST /mock-pay/:sessionId/complete { choice }
  → KHÔNG cập nhật subscription
  → đẩy một job vào queue, delay 1–3 giây (mô phỏng độ trễ mạng)
  → redirect user về /account/billing?status=processing

[Worker] gửi HTTP POST tới /webhooks/payments
  → header X-Payment-Signature: t=<ts>,v1=<hmac-sha256>
  → retry 5 lần, backoff 1s → 5s → 25s → 125s → 625s nếu nhận khác 2xx

POST /webhooks/payments
  → verify HMAC trên RAW body, timingSafeEqual
  → từ chối nếu timestamp lệch > 5 phút (chống replay)
  → INSERT paymentEvents (unique providerEventId) → trùng thì trả 200 và dừng
  → so eventCreatedAt với subscription.updatedAt → cũ hơn thì trả 409 và bỏ qua
  → transaction: cập nhật subscriptions + ghi payments + denormalize users.subscription
```

Ba điểm cố ý giữ **khó hơn mức cần thiết**, vì đó chính là chỗ học:

| Điểm                                                   | Vì sao không làm tắt                                           |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| Webhook bất đồng bộ, không cập nhật ngay trong request | Buộc FE phải xử lý trạng thái `processing` — đúng như đời thật |
| Có độ trễ 1–3 giây và retry                            | Lộ ra race condition mà cập nhật đồng bộ sẽ che mất            |
| Chữ ký HMAC trên raw body                              | Dạy đúng cái bẫy `JSON.stringify(req.body)` ≠ raw body         |

Thêm một cron mô phỏng vòng đời (tua nhanh được trong dev): tới `currentPeriodEnd` thì phát `invoice.paid`; cấu hình được tỉ lệ thất bại để dựng chuỗi `past_due` → `canceled`.

## Hệ quả

### Tích cực

- Không cần tài khoản, không cần thẻ, không cần tunnel để nhận webhook
- **Test được mọi nhánh thất bại bằng một nút bấm** — thứ khó nhất khi dùng sandbox thật
- Toàn bộ test suite chạy offline, không gọi mạng ra ngoài, không flaky vì dịch vụ bên thứ ba
- Mô phỏng được vòng đời 12 tháng trong vài phút
- Schema và service được thiết kế trung lập với provider (`providerCustomerId`, `provider: 'mock'`) → gắn gateway thật sau này là thêm một adapter, không phải migrate
- Những bài học thật (idempotency, out-of-order, signature, state machine) vẫn nguyên vẹn

### Cái giá phải trả

- **Trên CV không ghi được "đã tích hợp Stripe".** Đây là mất mát thật nếu vị trí ứng tuyển quan tâm điều đó. Bù lại bằng cách viết rõ trong README rằng đây là mock có chủ đích, kèm link ADR này — một người phỏng vấn tinh ý sẽ thấy điều đó giá trị hơn việc copy 20 dòng từ tài liệu Stripe
- Tự viết thêm code: trang checkout mô phỏng, bộ phát webhook có retry, cron vòng đời. Khoảng 300–400 dòng
- **Mock có thể dễ dãi hơn thực tế.** Nếu tự viết provider và tự viết handler, dễ vô thức làm cho chúng khớp nhau. Phải chủ động thêm những tình huống khó chịu: gửi trùng, gửi sai thứ tự, gửi chữ ký sai, gửi event cho user không tồn tại
- Không học được các đặc thù riêng của Stripe (SCA, 3D Secure, Payment Intent lifecycle)
- Phải bảo đảm `/mock-pay/*` **không bao giờ** bật ở môi trường thật — guard theo env, và test cho chính cái guard đó

### Khi nào nên xem lại

- Khi dự án nhận tiền thật → bắt buộc dùng gateway có giấy phép
- Khi mục tiêu cụ thể là chứng minh kinh nghiệm tích hợp Stripe cho một vị trí
- Nếu Stripe mở hỗ trợ đầy đủ cho cá nhân ở Việt Nam và chi phí đăng ký bằng 0

Khi đó, phần đã làm giữ nguyên gần hết: schema trung lập provider, webhook handler với idempotency và xử lý out-of-order, state machine của subscription đều dùng lại được. Chỉ thay lớp adapter gọi API và cách verify chữ ký.
