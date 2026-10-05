# 06 — Realtime / WebSocket

Dùng **Socket.IO** (`@nestjs/websockets` + `@nestjs/platform-socket.io`). Lý do chọn Socket.IO thay vì WS thuần: [ADR-003](adr/003-socketio-vs-raw-ws.md).

## 1. Kết nối

```
wss://api.nekoflix.local/rt
```

### Handshake

```ts
// Client
const socket = io('wss://api.nekoflix.local/rt', {
  auth: { token: accessToken, profileId },
  transports: ['websocket'], // bỏ qua long-polling, giảm một vòng upgrade
  reconnection: true,
  reconnectionDelay: 1_000,
  reconnectionDelayMax: 10_000,
  randomizationFactor: 0.5, // jitter, chống thundering herd
});
```

Token đi trong `auth` payload, **không** trong query string (query bị ghi vào access log của proxy).

### Xác thực ở server

```ts
@WebSocketGateway({ namespace: '/rt', cors: { origin: ALLOWED_ORIGINS, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  async handleConnection(client: Socket) {
    try {
      const { token, profileId } = client.handshake.auth;
      const payload = await this.jwt.verifyAccessToken(token);
      const profile = await this.profiles.assertOwnedBy(profileId, payload.sub);

      client.data.userId = payload.sub;
      client.data.profileId = profile.id;
      client.data.role = payload.role;
      client.data.sessionId = payload.sid;

      // Room cá nhân để push notification
      await client.join(`user:${payload.sub}`);
      await client.join(`profile:${profile.id}`);

      await this.presence.markOnline(profile.id, client.id);
    } catch {
      client.emit('error', { code: 'WS_UNAUTHORIZED' });
      client.disconnect(true);
    }
  }
}
```

### Access token hết hạn giữa chừng

Access token sống 15 phút, kết nối WS có thể sống hàng giờ. Giải pháp: client gửi token mới sau mỗi lần refresh HTTP.

```
client → 'auth:refresh' { token }
server → verify, cập nhật client.data, trả 'auth:refreshed' { expiresAt }
```

Server chạy interval 60s quét các socket có token quá hạn > 5 phút mà chưa refresh → disconnect với lý do `TOKEN_EXPIRED`. Client bắt sự kiện này, refresh HTTP rồi reconnect.

---

## 2. Danh sách event

Quy ước đặt tên: `<domain>:<action>`. Event client→server dùng động từ mệnh lệnh; server→client dùng quá khứ / trạng thái.

### 2.1 Watch Party

| Hướng | Event                 | Payload                                      | Ghi chú                           |
| ----- | --------------------- | -------------------------------------------- | --------------------------------- |
| C→S   | `party:join`          | `{ code }`                                   | Ack trả state đầy đủ              |
| C→S   | `party:leave`         | `{ code }`                                   |                                   |
| C→S   | `party:play`          | `{ code, positionSec }`                      | **Chỉ host**                      |
| C→S   | `party:pause`         | `{ code, positionSec }`                      | **Chỉ host**                      |
| C→S   | `party:seek`          | `{ code, positionSec }`                      | **Chỉ host**                      |
| C→S   | `party:sync-request`  | `{ code }`                                   | Client tự thấy lệch, xin sync lại |
| C→S   | `party:chat`          | `{ code, text }`                             | Max 500 ký tự                     |
| C→S   | `party:reaction`      | `{ code, emoji }`                            | Throttle 1/giây                   |
| C→S   | `party:transfer-host` | `{ code, toProfileId }`                      | Chỉ host                          |
| S→C   | `party:state`         | State đầy đủ                                 | Gửi khi join hoặc sync            |
| S→C   | `party:member-joined` | `{ profileId, displayName, avatarKey }`      |                                   |
| S→C   | `party:member-left`   | `{ profileId, reason }`                      |                                   |
| S→C   | `party:playback`      | `{ isPlaying, positionSec, serverTime, by }` | Lệnh điều khiển                   |
| S→C   | `party:chat`          | `{ id, profileId, displayName, text, at }`   |                                   |
| S→C   | `party:reaction`      | `{ profileId, emoji, at }`                   |                                   |
| S→C   | `party:host-changed`  | `{ newHostProfileId }`                       |                                   |
| S→C   | `party:ended`         | `{ reason }`                                 |                                   |

### 2.2 Presence

| Hướng | Event                | Payload                                                  |
| ----- | -------------------- | -------------------------------------------------------- |
| C→S   | `presence:subscribe` | `{ profileIds: string[] }` — danh sách bạn bè            |
| C→S   | `presence:update`    | `{ status: 'online' \| 'watching' \| 'idle', titleId? }` |
| S→C   | `presence:changed`   | `{ profileId, status, title? }`                          |

### 2.3 Notification

| Hướng | Event               | Payload                               |
| ----- | ------------------- | ------------------------------------- |
| S→C   | `notification:new`  | `{ id, type, title, body, data, at }` |
| C→S   | `notification:read` | `{ id }`                              |

### 2.4 Transcode (admin)

| Hướng | Event                 | Payload                                                     |
| ----- | --------------------- | ----------------------------------------------------------- |
| C→S   | `transcode:watch`     | `{ assetId }` — join room `asset:<id>`, cần role moderator+ |
| S→C   | `transcode:progress`  | `{ assetId, percent, stage, currentRendition }`             |
| S→C   | `transcode:completed` | `{ assetId, renditions }`                                   |
| S→C   | `transcode:failed`    | `{ assetId, code, message }`                                |

### 2.5 Hệ thống

| Hướng | Event             | Payload                                                               |
| ----- | ----------------- | --------------------------------------------------------------------- |
| C→S   | `ping`            | — (Socket.IO có heartbeat riêng; event này để đo RTT ở tầng ứng dụng) |
| S→C   | `pong`            | `{ serverTime }`                                                      |
| S→C   | `session:revoked` | `{ reason }` — buộc client logout                                     |
| S→C   | `error`           | `{ code, message }`                                                   |

---

## 3. Watch Party — thiết kế chi tiết

### 3.1 Lưu trữ state

Hot state ở Redis (đọc/ghi liên tục), snapshot xuống Mongo mỗi 30 giây và khi room kết thúc.

```
Redis key                        Type    Nội dung
rt:party:<code>                  HASH    hostProfileId, titleId, episodeId,
                                         isPlaying, positionSec, updatedAt, status
rt:party:<code>:members          HASH    profileId → JSON { displayName, avatarKey, joinedAt }
rt:party:<code>:chat             LIST    50 tin nhắn gần nhất (LTRIM)
rt:profile:<id>:party            STRING  code — profile đang ở room nào
```

TTL 6 giờ cho mọi key, refresh mỗi khi có hoạt động.

### 3.2 Đồng bộ thời gian

Vấn đề: độ trễ mạng mỗi người khác nhau. Nếu host phát ở giây 100 và gửi `{ positionSec: 100 }`, người có RTT 300ms sẽ nhận và seek tới 100 trong khi host đã ở 100.3.

Giải pháp: gửi kèm **mốc thời gian server**, client tự bù trừ.

```ts
// Server khi broadcast
{
  isPlaying: true,
  positionSec: 100,
  serverTime: 1759636800123,     // Date.now() tại lúc broadcast
  by: '<hostProfileId>'
}

// Client khi nhận
const clockOffset = estimateClockOffset();        // đo bằng ping/pong, xem 3.3
const elapsed = (Date.now() - clockOffset - msg.serverTime) / 1000;
const target = msg.isPlaying ? msg.positionSec + elapsed : msg.positionSec;
const drift = target - video.currentTime;

if (Math.abs(drift) > 2) {
  video.currentTime = target;                     // lệch nhiều → seek thẳng
} else if (Math.abs(drift) > 0.3) {
  // Lệch ít → chỉnh tốc độ phát, mượt hơn nhiều so với seek giật
  video.playbackRate = drift > 0 ? 1.05 : 0.95;
  setTimeout(() => { video.playbackRate = 1; }, Math.min(Math.abs(drift) / 0.05 * 1000, 3000));
} // lệch < 0.3s → kệ
```

Ngưỡng 0.3s chọn vì dưới mức này mắt người gần như không nhận ra khi xem chung qua chat/voice.

### 3.3 Ước lượng lệch đồng hồ

```ts
// NTP đơn giản hóa — lấy median của 5 mẫu để loại outlier
async function estimateClockOffset(socket: Socket): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const { serverTime } = await socket.emitWithAck('ping');
    const t1 = Date.now();
    const rtt = t1 - t0;
    samples.push(t0 + rtt / 2 - serverTime); // offset = thời gian local - thời gian server
    await sleep(200);
  }
  samples.sort((a, b) => a - b);
  return samples[2];
}
```

Chạy lại mỗi 5 phút và sau mỗi lần reconnect.

### 3.4 Drift correction tự động

Client chạy interval 5 giây so `video.currentTime` với vị trí dự đoán từ state cuối. Lệch > 3 giây → gửi `party:sync-request`, server trả `party:state`. Chống trường hợp client bị buffer lâu hoặc tab bị throttle khi ở background.

### 3.5 Chuyển quyền host

```
Host disconnect
  → chờ 10 giây (có thể chỉ là mạng chập chờn)
  → host reconnect?  → giữ nguyên
  → không            → chọn member có joinedAt sớm nhất làm host mới
                     → broadcast 'party:host-changed'
  → không còn ai     → status = 'ended', snapshot xuống Mongo, xóa Redis key
```

### 3.6 Authorization trong room

Mọi event điều khiển playback phải verify `client.data.profileId === party.hostProfileId`. Verify ở **server**, không tin UI đã ẩn nút.

```ts
@SubscribeMessage('party:seek')
async onSeek(@ConnectedSocket() client: Socket, @MessageBody() dto: SeekDto) {
  const party = await this.parties.getState(dto.code);
  if (!party)                                      throw new WsException('PARTY_NOT_FOUND');
  if (party.hostProfileId !== client.data.profileId) throw new WsException('NOT_HOST');
  if (!await this.parties.isMember(dto.code, client.data.profileId))
                                                   throw new WsException('NOT_MEMBER');

  await this.parties.setPlayback(dto.code, { positionSec: dto.positionSec });
  this.server.to(`party:${dto.code}`).emit('party:playback', {
    isPlaying: party.isPlaying,
    positionSec: dto.positionSec,
    serverTime: Date.now(),
    by: client.data.profileId,
  });
}
```

Ngoài ra mỗi thành viên vẫn phải tự có entitlement xem title đó (gói cước, maturity) — kiểm tra lúc `party:join`, không phải chỉ lúc tạo room.

---

## 4. Scale ngang

Socket.IO mặc định giữ room trong memory của từng process → 2 instance thì broadcast không tới nhau. Dùng **Redis adapter**:

```ts
// main.ts
import { createAdapter } from '@socket.io/redis-adapter';

const pubClient = new Redis(REDIS_URL);
const subClient = pubClient.duplicate();
app.useWebSocketAdapter(new RedisIoAdapter(app, createAdapter(pubClient, subClient)));
```

Load balancer phải bật **sticky session** (`ip_hash` ở nginx) nếu cho phép transport polling. Vì ta ép `transports: ['websocket']` nên sticky không bắt buộc — nhưng vẫn nên bật để an toàn khi fallback.

Worker báo transcode progress qua Redis pub/sub channel `transcode:progress`; mọi API instance subscribe và forward vào room `asset:<id>`.

---

## 5. Giới hạn & chống lạm dụng

| Event                | Giới hạn                  | Vượt thì                         |
| -------------------- | ------------------------- | -------------------------------- |
| `party:chat`         | 5 tin / 10 giây / profile | Drop + emit `error RATE_LIMITED` |
| `party:reaction`     | 1 / giây                  | Drop im lặng                     |
| `party:seek`         | 10 / 10 giây              | Drop                             |
| `party:sync-request` | 1 / 5 giây                | Drop                             |
| Kết nối              | 5 socket / user           | Đóng socket cũ nhất              |
| Payload              | 8KB                       | Disconnect                       |

Rate limit lưu ở Redis (`rl:ws:<event>:<profileId>`), thuật toán sliding window.

Chat message đi qua: trim → giới hạn 500 ký tự → escape HTML → lọc từ cấm (danh sách cấu hình được).

---

## 6. Xử lý reconnect

```
disconnect
  → UI hiện banner "Đang kết nối lại..."
  → video KHÔNG tự pause (tránh làm gián đoạn khi mạng chỉ chớp)
  → Socket.IO tự reconnect với exponential backoff + jitter

reconnect thành công
  → gửi lại 'auth:refresh' nếu token đã đổi
  → nếu đang trong party: gửi 'party:join' lại → nhận 'party:state' → sync
  → gửi lại 'presence:subscribe'
  → ẩn banner

reconnect thất bại > 2 phút
  → UI hiện "Mất kết nối. Tải lại trang?"
  → rời khỏi party ở phía UI
```

Server giữ member trong room thêm **30 giây** sau khi socket disconnect, để reconnect nhanh không làm cả room thấy "X đã rời đi" rồi "X đã tham gia" liên tục.

---

## 7. Cấu trúc module

```
modules/realtime/
├── realtime.module.ts
├── realtime.gateway.ts           # connection lifecycle, auth, routing
├── guards/
│   ├── ws-auth.guard.ts
│   └── ws-throttle.guard.ts
├── watch-party/
│   ├── watch-party.gateway.ts    # @SubscribeMessage cho party:*
│   ├── watch-party.service.ts    # business logic
│   └── watch-party.store.ts      # Redis read/write
├── presence/
│   ├── presence.gateway.ts
│   └── presence.service.ts
├── notifications/
│   └── notifications.gateway.ts
└── transcode/
    └── transcode.gateway.ts      # subscribe Redis pub/sub, forward
```

---

## 8. Test

| Loại        | Cách làm                                                                             |
| ----------- | ------------------------------------------------------------------------------------ |
| Unit        | Mock socket, test service logic (chuyển host, drift calc)                            |
| Integration | `socket.io-client` thật kết nối vào Nest test app + Redis trong Testcontainers       |
| E2E         | Playwright mở 2 browser context, join cùng party, assert video sync                  |
| Load        | `artillery` với engine socketio — 100 socket đồng thời, đo p95 latency của broadcast |

Case bắt buộc phải có test:

- Non-host gửi `party:seek` → bị từ chối
- Host disconnect → host mới được chọn sau 10 giây
- Member join giữa chừng → nhận đúng `positionSec` hiện tại
- Token hết hạn → disconnect, reconnect thành công sau refresh
- Hai API instance (Redis adapter) → broadcast tới cả hai

---

**Tiếp theo**: [07 — Video Pipeline](07-video-pipeline.md)
