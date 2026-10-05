# 16 — Cấu hình đăng nhập Google / GitHub

Code OAuth đã xong và có 19 test. Phần còn lại là **lấy credential** — việc này bạn phải tự làm vì nó gắn với tài khoản cá nhân.

Cả hai đều **miễn phí**, không cần thẻ.

---

## 1. Google

### Tạo credential

1. Vào https://console.cloud.google.com/
2. Tạo project mới (vd `nekoflix-dev`) — góc trên bên trái, cạnh logo Google Cloud
3. Menu trái → **APIs & Services** → **OAuth consent screen**
   - User Type: **External** → Create
   - App name: `Nekoflix`
   - User support email: email của bạn
   - Developer contact: email của bạn
   - Save and Continue → Scopes: bỏ qua → Save
   - **Test users**: thêm chính email Gmail của bạn ← _bắt buộc, nếu không sẽ bị chặn ở bước đăng nhập_
4. Menu trái → **Credentials** → **Create Credentials** → **OAuth client ID**
   - Application type: **Web application**
   - Name: `Nekoflix local`
   - **Authorized redirect URIs** → ADD URI:
     ```
     http://localhost:4000/v1/auth/oauth/google/callback
     ```
   - Create

5. Copy **Client ID** và **Client secret** vào `.env`:

```bash
GOOGLE_CLIENT_ID=123456789-abcdef.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
```

> **Redirect URI phải khớp TỪNG KÝ TỰ** với dòng trên. Thiếu `/callback`, thừa dấu `/` cuối, hay `https` thay vì `http` đều làm Google từ chối với lỗi `redirect_uri_mismatch`.

---

## 2. GitHub

1. Vào https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**
2. Điền:
   - Application name: `Nekoflix local`
   - Homepage URL: `http://localhost:5173`
   - **Authorization callback URL**:
     ```
     http://localhost:4000/v1/auth/oauth/github/callback
     ```
3. **Register application**
4. Copy **Client ID**, rồi bấm **Generate a new client secret** và copy secret

```bash
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> Secret chỉ hiện **một lần**. Mất thì tạo cái mới, không xem lại được.

---

## 3. Áp dụng

```bash
# Thêm 4 dòng vào .env, rồi khởi động lại service
pnpm dev:identity        # hoặc Ctrl+C rồi chạy lại
```

Kiểm tra nhanh:

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" \
  localhost:4000/v1/auth/oauth/google
```

- **Chưa cấu hình** → `503` kèm thông báo thiếu biến nào
- **Đã cấu hình** → `302` và URL trỏ tới `accounts.google.com`

Thử trọn luồng: mở trình duyệt vào

```
http://localhost:4000/v1/auth/oauth/google
```

Đăng nhập Google → bị chuyển về `http://localhost:5173/oauth/callback?code=...`.

Frontend chưa có nên trang sẽ lỗi — **đó là bình thường**. Copy giá trị `code` trên URL rồi đổi lấy token bằng tay:

```bash
curl -s -X POST localhost:4000/v1/auth/oauth/exchange \
  -H "Content-Type: application/json" \
  -d '{"code":"<dán code vào đây>"}'
```

Trả về user + accessToken là OAuth đã chạy trọn vẹn.

---

## 4. Luồng hoạt động

```
Trình duyệt          Gateway              identity-service        Google
    │                   │                        │                  │
    ├─GET /oauth/google─>│                        │                  │
    │                   ├─oauth.start───────────>│                  │
    │                   │        sinh state + PKCE verifier          │
    │                   │        lưu vào MongoDB (TTL 10 phút)       │
    │                   │<──authorizeUrl─────────┤                  │
    │<──302─────────────┤                        │                  │
    ├──────────────────────────────────────────────────────────────>│
    │                                   (người dùng đăng nhập)       │
    │<──302 /callback?code=...&state=...────────────────────────────┤
    ├──────────────────>│                        │                  │
    │                   ├─oauth.callback────────>│                  │
    │                   │        findOneAndDelete(state) ← dùng 1 lần│
    │                   │                        ├─đổi code + verifier──>│
    │                   │                        │<──id_token────────────┤
    │                   │        verify chữ ký qua JWKS của Google   │
    │                   │        áp dụng quy tắc liên kết tài khoản  │
    │                   │        cấp MÃ ĐỔI (TTL 60 giây)           │
    │<──302 web/oauth/callback?code=<mã đổi>─────┤                  │
    │                   │                        │                  │
    ├─POST /oauth/exchange {code}──────────────>│                  │
    │<──accessToken + Set-Cookie: refresh───────┤                  │
```

### Vì sao có bước "mã đổi"?

Nếu redirect thẳng về frontend kèm access token trong URL, token sẽ bị ghi vào:

- Lịch sử trình duyệt
- Header `Referer` gửi cho mọi ảnh/script trên trang đó
- Log của mọi proxy trên đường đi

Mã đổi sống 60 giây, dùng được đúng một lần, và chỉ đổi lấy token qua **POST** — không nằm trong URL.

### Vì sao có PKCE?

`code` mà Google trả về đi qua URL redirect của trình duyệt — cùng những chỗ rò rỉ kể trên. PKCE thêm một bí mật mà **chỉ server biết**:

```
1. Server sinh code_verifier ngẫu nhiên, GIỮ LẠI
2. Gửi đi code_challenge = SHA256(verifier)   ← không đảo ngược được
3. Khi đổi code, gửi kèm verifier
4. Google tự tính SHA256(verifier) và so với challenge đã nhận
```

Kẻ chặn được `code` không có `verifier`, nên không đổi được thành token.

---

## 5. Quy tắc liên kết tài khoản

Đây là chỗ dễ tạo lỗ hổng chiếm tài khoản nhất.

```
Email từ Google đã có trong hệ thống chưa?
│
├── CHƯA           → tạo tài khoản mới, coi như đã xác thực email
│                    (tin Google đã xác thực), không có mật khẩu
│
└── CÓ RỒI
    ├── đã xác thực email  → LIÊN KẾT Google vào tài khoản đó
    │                        (mật khẩu cũ vẫn dùng được)
    │
    └── CHƯA xác thực      → TỪ CHỐI
```

**Nhánh cuối là bắt buộc.** Kịch bản tấn công nếu thiếu:

1. Kẻ tấn công đăng ký Nekoflix bằng email của bạn — _không cần xác thực được email_
2. Bạn đăng nhập bằng Google với chính email đó
3. Nếu hệ thống gộp hai tài khoản, bạn rơi vào tài khoản mà **kẻ tấn công biết mật khẩu**
4. Chúng đăng nhập bằng mật khẩu đó và thấy hết dữ liệu của bạn

Ngoài ra chỉ chấp nhận email mà **nhà cung cấp đã xác thực** (`email_verified` của Google, `verified` của GitHub). Nếu không, kẻ tấn công tạo tài khoản Google với email của bạn (chưa xác thực) và chiếm tài khoản theo đường khác.

---

## 6. Khác biệt giữa Google và GitHub

|                    | Google                     | GitHub                                     |
| ------------------ | -------------------------- | ------------------------------------------ |
| Lấy email ở đâu    | `id_token` (JWT)           | Gọi riêng `/user/emails`                   |
| Xác minh thế nào   | **Verify chữ ký qua JWKS** | Tin API (đã dùng access token)             |
| Email có thể thiếu | Hiếm                       | **Thường xuyên** — nhiều người để riêng tư |

GitHub **không** trả email trong `/user` nếu người dùng đặt riêng tư. Phải gọi `/user/emails` và tự lọc lấy cái `primary` + `verified`. Nếu người dùng chưa xác thực email nào trên GitHub, hệ thống từ chối với thông báo rõ.

Với Google, `id_token` **phải được verify chữ ký** qua JWKS, không bao giờ chỉ decode. Chỉ decode thì ai cũng tự tạo được một `id_token` và đăng nhập thành bất kỳ ai.

---

## 7. Khi gặp lỗi

| Lỗi                                            | Nguyên nhân                                      | Cách sửa                                            |
| ---------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| `redirect_uri_mismatch`                        | URI trong console khác với `OAUTH_CALLBACK_BASE` | So từng ký tự, kể cả `http`/`https` và dấu `/` cuối |
| `403: access_denied` (Google)                  | Email chưa nằm trong **Test users**              | OAuth consent screen → Test users → thêm email      |
| `SERVICE_UNAVAILABLE` kèm "chưa được cấu hình" | Thiếu biến trong `.env`                          | Thêm 4 biến, khởi động lại service                  |
| `EMAIL_NOT_VERIFIED`                           | Email đã đăng ký local nhưng chưa xác thực       | Xác thực email local trước, hoặc dùng email khác    |
| `TOKEN_INVALID` ở callback                     | State hết hạn (>10 phút) hoặc đã dùng            | Bắt đầu lại từ `/v1/auth/oauth/google`              |
| `invalid_client` (GitHub)                      | Sai client secret                                | Tạo secret mới, secret cũ không xem lại được        |

---

## 8. Lưu ý khi deploy

- `OAUTH_CALLBACK_BASE` phải đổi sang domain thật, và **thêm URI đó vào console** của Google/GitHub (giữ cả URI localhost để vẫn dev được)
- Google OAuth consent screen đang ở chế độ **Testing** — chỉ Test users đăng nhập được. Muốn mở cho mọi người phải submit verification (mất vài ngày). Với dự án portfolio thì để Testing là đủ
- Client secret **không bao giờ** commit lên Git. `.env` đã được gitignore

---

**Liên quan**: [05 — Authentication](05-authentication.md) · [COMMANDS.md](../COMMANDS.md)
