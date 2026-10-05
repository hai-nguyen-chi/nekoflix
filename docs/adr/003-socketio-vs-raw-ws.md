# ADR-003: Socket.IO thay vì WebSocket thuần

**Trạng thái**: Accepted
**Ngày**: 2026-10-05

## Bối cảnh

Cần realtime cho Watch Party (đồng bộ playback, chat), presence, notification, và transcode progress. NestJS hỗ trợ cả hai qua `@nestjs/platform-socket.io` và `@nestjs/platform-ws`.

Yêu cầu cụ thể:

- **Room**: broadcast tới đúng nhóm người trong một party
- **Reconnect**: mạng chập chờn không được làm hỏng trải nghiệm xem
- **Ack**: client cần biết lệnh `party:join` thành công hay không
- **Scale ngang**: broadcast phải tới được client đang nối vào instance API khác

## Các lựa chọn

### A. WebSocket thuần (`ws`)

Nhẹ nhất, đúng chuẩn, không phụ thuộc protocol riêng.

### B. Socket.IO ← chọn

Có room, ack, auto-reconnect, Redis adapter sẵn.

### C. Server-Sent Events + REST

SSE cho server→client, REST cho client→server.

## Quyết định

Chọn **Socket.IO**.

Lý do cốt lõi: bốn thứ dự án cần — room, ack, reconnect với backoff, và adapter để scale ngang — đều là **những thứ sẽ phải tự viết nếu dùng `ws` thuần**, và viết đúng chúng không hề tầm thường.

Cụ thể, nếu chọn A thì phải tự xây:

| Cần                    | Tự viết nghĩa là                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| Room                   | Một `Map<roomId, Set<WebSocket>>`, tự dọn khi socket chết, tự xử lý memory leak                |
| Ack                    | Tự thêm `messageId` vào mọi message, tự quản lý promise đang chờ, tự timeout                   |
| Reconnect              | Exponential backoff + jitter ở client, tự phát hiện kết nối chết (`ws` không có heartbeat sẵn) |
| Scale ngang            | Tự pub/sub qua Redis, tự serialize, tự xử lý message tới chính mình                            |
| Phát hiện kết nối chết | Tự ping/pong, tự `terminate()` socket không phản hồi                                           |

Đó là vài trăm dòng code hạ tầng, mỗi dòng là một chỗ có thể sai, và chẳng dạy được gì về bài toán nghiệp vụ. Socket.IO đã giải chúng và được dùng trong production ở quy mô lớn.

Phương án C bị loại vì Watch Party cần giao tiếp **hai chiều, độ trễ thấp**. SSE một chiều; gửi `party:seek` qua REST thêm vài chục ms và không có thứ tự đảm bảo — với yêu cầu đồng bộ dưới 500ms thì không ổn.

## Hệ quả

### Tích cực

- Room, ack, reconnect, heartbeat có sẵn và đã được kiểm chứng
- `@socket.io/redis-adapter` giải quyết scale ngang bằng ~5 dòng code
- Tích hợp NestJS tốt: `@SubscribeMessage`, `@ConnectedSocket`, guard/pipe dùng được
- `emitWithAck()` cho phép viết code realtime theo kiểu async/await, dễ đọc và dễ test
- Client tự fallback sang HTTP long-polling nếu WebSocket bị firewall chặn

### Cái giá phải trả

- **Protocol riêng**: client bắt buộc dùng `socket.io-client`. Không kết nối được bằng `wscat`, `websocat`, hay thư viện WS chuẩn — gây phiền khi debug và khi làm client ở nền tảng khác
- Overhead payload: mỗi message có thêm metadata của protocol. Với chat thì không đáng kể, nhưng nếu sau này gửi nhiều message nhỏ tần suất cao thì phải đo lại
- Bundle frontend nặng thêm ~15KB gzip
- Phiên bản client và server phải tương thích (Socket.IO v4 client không nói chuyện được với v2 server)
- `transports: ['websocket']` được ép trong config để bỏ qua long-polling — nghĩa là mất khả năng fallback, nhưng đổi lại không cần sticky session và handshake nhanh hơn một vòng

### Khi nào nên xem lại

- Nếu cần client không phải JavaScript (app Swift/Kotlin native) — lúc đó WS thuần hoặc một protocol chuẩn sẽ hợp lý hơn
- Nếu tần suất message tăng mạnh và overhead protocol đo được là đáng kể
- Nếu tách realtime thành service riêng — lúc đó đánh giá lại cả stack, cân nhắc cả uWebSockets.js
