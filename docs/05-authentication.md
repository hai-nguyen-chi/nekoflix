# 05 — Authentication & Authorization

## 1. Mô hình token

| Token                   | Loại                             | TTL     | Lưu ở đâu                                       | Mục đích                         |
| ----------------------- | -------------------------------- | ------- | ----------------------------------------------- | -------------------------------- |
| **Access token**        | JWT RS256                        | 15 phút | Memory của JS (Zustand, **không** localStorage) | Gọi API                          |
| **Refresh token**       | Opaque 32 byte random, base64url | 30 ngày | httpOnly cookie `nf_rt`                         | Lấy access token mới             |
| **MFA token**           | JWT                              | 5 phút  | Memory                                          | Bước trung gian khi bật 2FA      |
| **Playback token**      | JWT HS256                        | 6 giờ   | Memory + query string                           | Truy cập manifest/segment/key    |
| **OAuth exchange code** | Opaque, dùng 1 lần               | 60 giây | URL một lần                                     | Đổi lấy token sau OAuth callback |

### Tại sao access token để trong memory, không localStorage?

localStorage đọc được bằng JS → một lỗ XSS là mất token. Để trong memory thì mất khi reload tab, nhưng refresh token nằm trong httpOnly cookie sẽ khôi phục phiên tự động khi app khởi động. Đánh đổi này là tiêu chuẩn hiện nay.

### Tại sao refresh token là opaque, không phải JWT?

Refresh token cần **thu hồi được ngay lập tức**. JWT stateless không thu hồi được nếu không tra DB — mà đã phải tra DB thì JWT không còn lợi thế gì. Opaque + lưu hash trong Mongo đơn giản và đúng hơn.

### Cấu trúc access token

```jsonc
{
  "sub": "665f1a...", // userId
  "sid": "665f1b...", // sessionId — để revoke
  "pid": "665f1c...", // profileId (có thể null nếu chưa chọn profile)
  "role": "user",
  "plan": "standard",
  "ev": true, // emailVerified
  "iat": 1759636800,
  "exp": 1759637700,
  "iss": "nekoflix",
  "aud": "nekoflix-web",
}
```

Ký bằng **RS256**. Private key chỉ nằm ở API server; public key có thể phát qua JWKS (`/.well-known/jwks.json`) nếu sau này tách service. Key lưu dạng PEM trong env `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`.

---

## 2. Refresh token rotation + reuse detection

Đây là phần "khó" đáng để làm cho đúng. Mô hình **token family**.

### Khái niệm

- Mỗi lần **login** sinh ra một `familyId` mới
- Mỗi lần **refresh** tạo một session document mới cùng `familyId`, đánh dấu document cũ `status: 'rotated'`
- Nếu một token có `status: 'rotated'` hoặc `'revoked'` được dùng lại → **ai đó đang dùng token bị đánh cắp** → revoke toàn bộ family

### Luồng bình thường

```
Login       → tạo S1 (family=F, status=active)         cookie = T1
Refresh T1  → S1.status=rotated, tạo S2 (family=F)     cookie = T2
Refresh T2  → S2.status=rotated, tạo S3 (family=F)     cookie = T3
```

### Luồng bị tấn công

```
Kẻ tấn công copy được T2.
Nạn nhân refresh T2 → OK, nhận T3. S2 thành rotated.
Kẻ tấn công refresh T2 → S2 đã rotated!
   → revoke toàn bộ family F (S1, S2, S3 → revoked)
   → gửi email cảnh báo
   → cả hai bên đều phải đăng nhập lại — nạn nhân bị phiền một chút,
     nhưng kẻ tấn công mất quyền truy cập. Đánh đổi chấp nhận được.
```

### Pseudo-code

```ts
async function refresh(rawToken: string, ctx: RequestContext) {
  const tokenHash = sha256(rawToken);

  return withTransaction(async (session) => {
    const doc = await Sessions.findOne({ tokenHash }).session(session);

    if (!doc) throw new UnauthorizedError('TOKEN_INVALID');

    if (doc.status !== 'active') {
      // Reuse! Token này đã rotate hoặc bị revoke rồi.
      await Sessions.updateMany(
        { familyId: doc.familyId, status: { $ne: 'revoked' } },
        { $set: { status: 'revoked' } },
      ).session(session);

      await auditLog('auth.token_reuse_detected', doc.userId, ctx);
      queueEmail('security-alert', doc.userId, ctx); // ngoài transaction, qua outbox
      throw new UnauthorizedError('TOKEN_REUSE_DETECTED');
    }

    if (doc.expiresAt < new Date()) throw new UnauthorizedError('TOKEN_EXPIRED');

    const user = await Users.findById(doc.userId).session(session);
    if (!user || user.status !== 'active') throw new UnauthorizedError('TOKEN_INVALID');

    const newRaw = randomBytes(32).toString('base64url');
    const newDoc = await Sessions.create(
      [
        {
          userId: doc.userId,
          familyId: doc.familyId, // giữ nguyên family
          tokenHash: sha256(newRaw),
          previousTokenHash: tokenHash,
          status: 'active',
          userAgent: ctx.userAgent,
          ip: ctx.ip,
          deviceLabel: doc.deviceLabel,
          expiresAt: addDays(new Date(), 30),
          lastUsedAt: new Date(),
        },
      ],
      { session },
    );

    doc.status = 'rotated';
    doc.lastUsedAt = new Date();
    await doc.save({ session });

    return { accessToken: signAccessToken(user, newDoc[0]), refreshToken: newRaw };
  });
}
```

### Xử lý race ở client

Nhiều request 401 cùng lúc → nhiều lần gọi refresh song song → lần thứ hai gặp token đã rotated → **tự revoke oan cả family**. Phải chặn ở client:

```ts
// apps/web/src/lib/api/refresh-queue.ts
let refreshing: Promise<string> | null = null;

export function refreshOnce(): Promise<string> {
  // Mọi caller cùng chờ chung MỘT promise
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}
```

Và chặn thêm ở server: cho phép token `rotated` được dùng lại trong **grace period 10 giây** kể từ `updatedAt`, trả về đúng token mới đã sinh (idempotent) thay vì revoke. Chỉ coi là tấn công khi vượt quá grace period.

> Chi tiết cài đặt: lưu `nextTokenHash` trên document cũ để trả lại đúng cặp token trong grace window.

---

## 3. Luồng đăng ký & xác thực email

```
1. POST /auth/register
   → tạo user (emailVerifiedAt = null)
   → sinh token ngẫu nhiên 32 byte, lưu sha256 vào verificationTokens (TTL 24h)
   → gửi mail link: https://app.nekoflix.local/verify?token=<raw>
   → trả access + refresh token (user vào được app, chỉ không xem video)

2. POST /auth/verify-email { token }
   → tra sha256(token), check consumedAt == null && expiresAt > now
   → set user.emailVerifiedAt, set token.consumedAt
   → client gọi /auth/refresh để lấy access token có claim ev=true
```

**Bảo mật**: không bao giờ lưu token thô. Link verify chỉ gửi qua email. Rate limit resend.

---

## 4. OAuth2 (Authorization Code + PKCE)

### Luồng

```
Browser                 API                      Google
   │                     │                         │
   ├─GET /auth/oauth/google?redirect=/browse       │
   │                     ├─sinh state + codeVerifier
   │                     ├─lưu vào Redis (TTL 10 phút, key = state)
   │<──302 tới Google────┤                         │
   ├──────────────────────────────────────────────>│
   │                                        (user đăng nhập + đồng ý)
   │<──302 /auth/oauth/google/callback?code=&state=┤
   ├────────────────────>│                         │
   │                     ├─đọc Redis theo state, xóa ngay (one-time)
   │                     ├─POST token endpoint (code + code_verifier)──>│
   │                     │<──{ access_token, id_token }─────────────────┤
   │                     ├─verify id_token (JWKS của Google, aud, iss, exp)
   │                     ├─findOrLink user
   │                     ├─tạo session + sinh exchangeCode (TTL 60s, dùng 1 lần)
   │<─302 app.../oauth/callback?code=<exchangeCode>┤
   │                     │
   ├─POST /auth/oauth/exchange { code }──────────>│
   │<─{ accessToken } + Set-Cookie: nf_rt─────────┤
```

### Tại sao có bước `exchange`?

Nếu redirect thẳng về frontend kèm access token trong URL thì token bị ghi vào browser history, Referer header, log của proxy. Dùng one-time code TTL 60 giây đổi lấy token qua POST là an toàn hơn hẳn.

### Quy tắc link tài khoản

```
email từ provider tồn tại trong users?
├── Không  → tạo user mới, emailVerifiedAt = now (tin provider đã verify)
│                           passwordHash = null
└── Có
    ├── user.emailVerifiedAt != null → LINK provider vào user này
    └── user.emailVerifiedAt == null → TỪ CHỐI
         → "Email này đã đăng ký nhưng chưa xác thực. Vui lòng xác thực
            email trước khi liên kết tài khoản Google."
```

Nhánh từ chối là bắt buộc: nếu không, kẻ tấn công đăng ký trước bằng email của nạn nhân (chưa verify), sau đó nạn nhân login Google và bị merge vào tài khoản của kẻ tấn công.

Chỉ chấp nhận provider trả `email_verified: true`. Google có field này; GitHub phải gọi `/user/emails` và lọc `verified === true` + `primary === true`.

### Unlink

Không cho unlink provider cuối cùng nếu `passwordHash == null` — người dùng sẽ mất đường vào tài khoản.

---

## 5. Two-Factor Authentication (TOTP)

```
Bật:
  POST /auth/2fa/setup   → sinh secret base32 (20 byte), lưu TẠM vào Redis (TTL 10 phút)
                         → trả otpauth:// URI + QR data URL
  POST /auth/2fa/enable  → { code } → verify → mã hóa secret bằng AES-256-GCM
                         → lưu vào users.twoFactor.secret
                         → sinh 10 recovery code, lưu hash (argon2id), trả raw MỘT LẦN

Login khi đã bật:
  POST /auth/login       → đúng password nhưng 2FA on
                         → trả { mfaRequired: true, mfaToken }  (KHÔNG trả refresh token)
  POST /auth/2fa/verify  → { mfaToken, code } → đúng → trả access + refresh token
```

Tham số: SHA-1, 6 số, step 30s, window ±1 (chấp nhận lệch đồng hồ 30 giây mỗi chiều).
Rate limit `2fa/verify`: 5 lần sai / 15 phút → vô hiệu `mfaToken`.
Chống replay: lưu `(userId, counter)` đã dùng vào Redis TTL 90s, từ chối nếu trùng.

Secret mã hóa bằng `APP_ENCRYPTION_KEY` (32 byte, AES-256-GCM, lưu `iv` + `authTag` cùng ciphertext). Lý do: nếu DB bị dump, secret TOTP vẫn không dùng được.

---

## 6. Password

- Hash: **argon2id**, `memoryCost: 19456 KiB (19MB)`, `timeCost: 2`, `parallelism: 1` — theo khuyến nghị OWASP
- Policy: >= 8 ký tự, phải có chữ và số; kiểm tra với danh sách 10.000 password phổ biến (`zxcvbn` hoặc list tĩnh); **không** bắt ký tự đặc biệt (gây password yếu + khó nhớ)
- Đổi password → revoke mọi session trừ session hiện tại (có tùy chọn revoke tất cả)
- Login sai: **luôn** chạy argon2 verify với một hash giả ngay cả khi email không tồn tại → chống **user enumeration** qua chênh lệch thời gian phản hồi

```ts
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$...'; // hash của chuỗi ngẫu nhiên

const user = await Users.findOne({ email });
const ok = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, password);
if (!user || !ok) throw new UnauthorizedError('INVALID_CREDENTIALS');
```

---

## 7. Authorization

### 7.1 Ba tầng

```
Tầng 1 — Guard:      Có đăng nhập không? Role đủ không?
Tầng 2 — Guard:      Profile này có thuộc user trong token không? Đã nhập PIN chưa?
Tầng 3 — Service:    Entitlement nghiệp vụ — subscription, maturity rating, stream limit
```

Tầng 3 **không** nằm ở guard vì nó cần dữ liệu domain (title, asset) mà guard không nên biết.

### 7.2 Decorator

```ts
@Controller('admin/titles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
export class AdminTitlesController { }

@Get('continue')
@UseGuards(JwtAuthGuard, ProfileGuard)
@RequireProfile()                      // bắt buộc có X-Profile-Id hợp lệ
getContinueWatching(@CurrentProfile() profile: ProfileContext) { }

@Post('verify-email')
@Public()                              // bỏ qua JwtAuthGuard
verifyEmail() { }
```

### 7.3 Ma trận quyền

| Hành động           | Guest | User | User (chưa verify) | Moderator | Admin |
| ------------------- | :---: | :--: | :----------------: | :-------: | :---: |
| Xem catalog, search |  ✅   |  ✅  |         ✅         |    ✅     |  ✅   |
| Xem trailer         |  ✅   |  ✅  |         ✅         |    ✅     |  ✅   |
| **Phát phim**       |  ❌   |  ✅  |         ❌         |    ✅     |  ✅   |
| Quản lý profile     |  ❌   |  ✅  |         ✅         |    ✅     |  ✅   |
| Watchlist, rating   |  ❌   |  ✅  |         ✅         |    ✅     |  ✅   |
| Watch Party         |  ❌   |  ✅  |         ❌         |    ✅     |  ✅   |
| CRUD catalog        |  ❌   |  ❌  |         ❌         |    ✅     |  ✅   |
| Upload video        |  ❌   |  ❌  |         ❌         |    ✅     |  ✅   |
| Quản lý user        |  ❌   |  ❌  |         ❌         |    ❌     |  ✅   |
| Analytics           |  ❌   |  ❌  |         ❌         |    ❌     |  ✅   |

### 7.4 Entitlement check khi phát video

```ts
async function assertCanPlay(ctx: PlaybackContext) {
  const { user, profile, title, asset, deviceId } = ctx;

  if (!user.emailVerifiedAt) throw new ForbiddenError('EMAIL_NOT_VERIFIED');
  if (asset.status !== 'ready') throw new ConflictError('ASSET_NOT_READY');
  if (title.status !== 'published') throw new NotFoundError('NOT_FOUND');

  // Maturity: so sánh theo thang bậc, không so sánh chuỗi
  if (RATING_ORDER[title.maturityRating] > RATING_ORDER[profile.maturityLimit])
    throw new ForbiddenError('MATURITY_BLOCKED');

  // Giới hạn luồng đồng thời — Redis sorted set, score = timestamp heartbeat
  const key = `rt:streams:${user._id}`;
  await redis.zremrangebyscore(key, 0, Date.now() - 60_000); // dọn stale
  const active = await redis.zrange(key, 0, -1);

  if (!active.includes(deviceId) && active.length >= user.subscription.maxStreams)
    throw new ConflictError('STREAM_LIMIT_EXCEEDED', await describeDevices(active));

  await redis.zadd(key, Date.now(), deviceId);
  await redis.expire(key, 120);

  return { maxQuality: user.subscription.maxQuality };
}
```

Client gửi `POST /playback/heartbeat` mỗi 30 giây để làm mới score. Đóng tab → `POST /playback/end` qua `sendBeacon`; nếu không kịp gửi, entry tự hết hạn sau 60 giây.

---

## 8. Playback token

JWT riêng, HS256 (đối xứng, vì chỉ API server tự verify — nhanh hơn RS256 và request segment rất nhiều).

```jsonc
{
  "sub": "<userId>",
  "pid": "<profileId>",
  "aid": "<assetId>", // bind với đúng asset
  "did": "<deviceId>",
  "q": "1080p", // chất lượng tối đa được phép
  "exp": 1759658400, // +6h
}
```

Verify ở mọi request manifest / segment / key:

1. Chữ ký hợp lệ, chưa hết hạn
2. `aid` khớp asset đang xin
3. `did` khớp `X-Device-Id` (nếu có; segment request thì bỏ qua vì hls.js không set được header)

Master playlist được **generate động** theo `q` — chỉ liệt kê rendition <= chất lượng cho phép. Người dùng gói Basic không bao giờ thấy variant 1080p trong playlist.

---

## 9. Cookie

```
Set-Cookie: nf_rt=<token>;
            HttpOnly;
            Secure;                      # bỏ ở local HTTP
            SameSite=Lax;
            Path=/v1/auth;               # chỉ gửi tới endpoint auth
            Max-Age=2592000;
            Domain=.nekoflix.local
```

`SameSite=Lax` đủ vì refresh luôn là POST từ cùng site. `Path` hẹp giảm bề mặt tấn công — cookie không bị gửi kèm mọi request API.

CSRF: refresh endpoint chỉ nhận POST + yêu cầu header `X-Requested-With: XMLHttpRequest` (form HTML không set được custom header) + check `Origin` nằm trong allowlist.

---

## 10. Checklist bảo mật

- [ ] Password hash argon2id, tham số theo OWASP
- [ ] Refresh token lưu dạng hash, không bao giờ lưu thô
- [ ] Rotation + reuse detection + grace period chống race
- [ ] Access token TTL 15 phút, trong memory
- [ ] Verify / reset token: dùng 1 lần, có TTL, lưu hash
- [ ] OAuth: PKCE + state one-time + verify `id_token` qua JWKS
- [ ] OAuth: chặn link vào tài khoản chưa verify
- [ ] TOTP secret mã hóa at-rest, chống replay
- [ ] Chống user enumeration ở login, register, forgot-password
- [ ] Rate limit riêng cho mọi endpoint auth
- [ ] Audit log mọi sự kiện bảo mật
- [ ] Không log token, password, TOTP secret
- [ ] Email cảnh báo: đăng nhập thiết bị mới, đổi password, reuse detection, bật/tắt 2FA

---

**Tiếp theo**: [06 — Realtime / WebSocket](06-realtime-websocket.md)
