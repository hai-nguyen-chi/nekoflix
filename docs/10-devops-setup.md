# 10 — Local Setup & DevOps

## 1. Yêu cầu

| Phần mềm | Phiên bản | Ghi chú                                                                                                                                                                               |
| -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js  | >= 22 LTS |                                                                                                                                                                                       |
| pnpm     | >= 9      | `corepack enable`                                                                                                                                                                     |
| Docker   | mới nhất  | Docker Desktop miễn phí cho cá nhân/học tập. Nếu vướng điều khoản (công ty > 250 người), dùng **Rancher Desktop** hoặc **Podman Desktop** — cùng miễn phí, chạy được `docker compose` |
| FFmpeg   | >= 6.1    | Chỉ cần nếu chạy worker ngoài Docker                                                                                                                                                  |
| Git      |           |                                                                                                                                                                                       |

Toàn bộ phần mềm trên đều miễn phí. Dự án không dùng bất kỳ dịch vụ trả phí nào — xem [ADR-008](adr/008-zero-cost-infrastructure.md).

Tài nguyên tối thiểu cho Docker: **4 CPU, 8GB RAM, 40GB đĩa trống**. Khuyến nghị **16GB RAM** — kiến trúc microservices chạy ~15 container.

### Ước tính RAM lúc rảnh

| Thành phần       | Số lượng | RAM mỗi cái   | Tổng       |
| ---------------- | -------- | ------------- | ---------- |
| Service Node     | 9        | ~120MB        | ~1.1GB     |
| transcode-worker | 1        | ~200MB (rảnh) | 200MB      |
| MongoDB          | 1        | ~500MB        | 500MB      |
| Redis            | 1        | ~50MB         | 50MB       |
| NATS             | 1        | ~30MB         | 30MB       |
| MinIO            | 1        | ~200MB        | 200MB      |
| Jaeger           | 1        | ~150MB        | 150MB      |
| **Tổng**         |          |               | **~2.3GB** |

Lúc transcode, worker có thể lên vài GB. Vẫn nằm trong giới hạn laptop 16GB và Oracle Always Free 24GB ([ADR-008](adr/008-zero-cost-infrastructure.md)) — nhưng không còn dư dả như kiến trúc monolith.

**Không cần chạy hết.** Xem [mục 3.1 — Docker Compose profiles](#31-chạy-một-phần-hệ-thống) để chỉ bật phần đang làm việc.

## 2. Khởi động lần đầu

```bash
git clone <repo> nekoflix && cd nekoflix

cp .env.example .env
pnpm run gen:secrets          # sinh JWT keypair + các secret, ghi đè vào .env

pnpm install

docker compose -f infra/docker-compose.yml up -d   # mongo, redis, minio, mailhog
pnpm db:migrate
pnpm db:seed                  # 20 title mẫu + tài khoản admin

bash scripts/download-sample-videos.sh             # tải video CC từ Blender (~500MB)

pnpm dev                      # chạy song song web + api + worker
```

Sau khi xong:

| Dịch vụ                          | URL                                | Thông tin đăng nhập                   |
| -------------------------------- | ---------------------------------- | ------------------------------------- |
| Web                              | http://localhost:5173              | `admin@nekoflix.local` / `Admin12345` |
| API                              | http://localhost:4000/v1           |                                       |
| Swagger                          | http://localhost:4000/docs         |                                       |
| MinIO Console                    | http://localhost:9001              | `minioadmin` / `minioadmin`           |
| Mailhog (xem email)              | http://localhost:8025              |                                       |
| Mongo Express                    | http://localhost:8081              |                                       |
| Bull Board (xem queue)           | http://localhost:4000/admin/queues | cần đăng nhập admin                   |
| **Jaeger** (distributed tracing) | http://localhost:16686             |                                       |
| **NATS monitoring**              | http://localhost:8222              |                                       |

### 3.1 Chạy một phần hệ thống

Chạy cả 15 container mỗi lần code là lãng phí. Dùng Docker Compose profile:

```bash
pnpm infra:up                    # chỉ hạ tầng: mongo, redis, nats, minio, jaeger

# Rồi chạy đúng service đang làm việc, bằng Turborepo
pnpm dev --filter gateway --filter identity-service --filter web
```

Các tổ hợp hay dùng:

| Đang làm gì | Lệnh                                                             |
| ----------- | ---------------------------------------------------------------- |
| Auth        | `pnpm dev:auth` → gateway + identity + web                       |
| Catalog     | `pnpm dev:catalog` → gateway + catalog + web                     |
| Video       | `pnpm dev:media` → gateway + media + worker + identity + web     |
| Watch party | `pnpm dev:realtime` → gateway + realtime + catalog + media + web |
| Tất cả      | `pnpm dev`                                                       |

```jsonc
// package.json gốc
{
  "scripts": {
    "dev:auth": "turbo run dev --filter=gateway --filter=identity-service --filter=web",
    "dev:catalog": "turbo run dev --filter=gateway --filter=catalog-service --filter=web",
    "dev:media": "turbo run dev --filter=gateway --filter=media-service --filter=transcode-worker --filter=identity-service --filter=web",
  },
}
```

> Service thiếu thì NATS request sẽ timeout sau 2 giây và gateway trả fallback. Nhờ thiết kế chịu lỗi ở [02 §7.1](02-architecture.md#71-phân-loại-dependency), thiếu service không thiết yếu không làm sập trang — điều này cũng khiến dev experience dễ chịu hơn nhiều.

## 3. `docker-compose.yml`

```yaml
services:
  mongo:
    image: mongo:7
    command: ['--replSet', 'rs0', '--bind_ip_all']
    ports: ['27017:27017']
    volumes:
      - mongo-data:/data/db
      - ./mongo/rs-init.js:/docker-entrypoint-initdb.d/rs-init.js:ro
    healthcheck:
      test: mongosh --quiet --eval "rs.status().ok" || mongosh --quiet --eval "rs.initiate()"
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s

  redis:
    image: redis:7-alpine
    command:
      [
        'redis-server',
        '--appendonly',
        'yes',
        '--maxmemory',
        '512mb',
        '--maxmemory-policy',
        'allkeys-lru',
      ]
    ports: ['6379:6379']
    volumes: [redis-data:/data]
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ['9000:9000', '9001:9001']
    volumes: [minio-data:/data]
    healthcheck:
      test: ['CMD', 'mc', 'ready', 'local']
      interval: 10s

  minio-init:
    image: minio/mc:latest
    depends_on:
      minio: { condition: service_healthy }
    entrypoint: /bin/sh
    command: /scripts/init-buckets.sh
    volumes: ['./minio:/scripts:ro']

  mailhog:
    image: axllent/mailpit:latest
    ports: ['1025:1025', '8025:8025']

  nats:
    image: nats:2-alpine
    command: ['-js', '-sd', '/data', '-m', '8222', '-c', '/etc/nats/nats.conf']
    ports: ['4222:4222', '8222:8222'] # 8222 = trang monitoring
    volumes:
      - nats-data:/data
      - ./nats/nats.conf:/etc/nats/nats.conf:ro
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:8222/healthz']
      interval: 10s

  jaeger:
    image: jaegertracing/all-in-one:latest
    environment:
      COLLECTOR_OTLP_ENABLED: 'true'
    ports: ['16686:16686', '4318:4318'] # 16686 = UI, 4318 = OTLP HTTP

  mongo-express:
    image: mongo-express:latest
    depends_on: [mongo]
    environment:
      ME_CONFIG_MONGODB_URL: mongodb://root:root@mongo:27017/?replicaSet=rs0
      ME_CONFIG_BASICAUTH: 'false'
    ports: ['8081:8081']

volumes:
  mongo-data:
  redis-data:
  minio-data:
  nats-data:
```

> **Replica set là bắt buộc**, không phải tùy chọn — MongoDB chỉ cho dùng transaction và change stream khi chạy replica set. Một node vẫn đủ ở local. Với microservices, nhu cầu này còn cấp thiết hơn: outbox pattern bắt buộc phải có transaction.

### `infra/mongo/init-users.js`

Tạo 8 DB user, mỗi user chỉ truy cập được database của service mình. Đây là cơ chế **ép ranh giới ở tầng hạ tầng** ([ADR-012](adr/012-database-per-service.md)).

```js
const services = [
  'identity',
  'catalog',
  'media',
  'activity',
  'realtime',
  'billing',
  'notification',
  'reco',
];

const admin = db.getSiblingDB('admin');
for (const svc of services) {
  admin.createUser({
    user: `${svc}_svc`,
    pwd: process.env[`${svc.toUpperCase()}_DB_PASSWORD`],
    roles: [{ role: 'readWrite', db: `nekoflix_${svc}` }], // CHỈ database này
  });
}
```

Sau bước này, `activity-service` đọc `nekoflix_catalog` sẽ nhận `not authorized on nekoflix_catalog to execute command find` — vi phạm ranh giới trở thành lỗi runtime ngay lập tức, không thể lỡ tay.

### `infra/nats/nats.conf`

```
jetstream {
  store_dir: "/data"
  max_memory_store: 256MB
  max_file_store: 2GB
}
max_payload: 2MB
```

Stream và consumer được tạo bằng code lúc service khởi động (`service-kit` lo), không khai báo trong file config — để mỗi service tự quản consumer của mình.

### `infra/minio/init-buckets.sh`

```sh
#!/bin/sh
set -e
mc alias set local http://minio:9000 minioadmin minioadmin

mc mb --ignore-existing local/nekoflix-uploads
mc mb --ignore-existing local/nekoflix-media
mc mb --ignore-existing local/nekoflix-public

mc anonymous set download local/nekoflix-public       # chỉ bucket này public

# File gốc tự xóa sau 30 ngày
mc ilm rule add --expire-days 30 local/nekoflix-uploads

# CORS cho browser PUT trực tiếp
mc cors set local/nekoflix-uploads /scripts/cors.json

echo "Buckets đã sẵn sàng."
```

## 4. Dockerfile

### API

```dockerfile
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json       apps/api/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter contracts build && pnpm --filter api build

FROM base AS runtime
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/apps/api/dist ./dist
COPY --from=build --chown=app:app /app/node_modules  ./node_modules
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://localhost:4000/health/live').then(r=>process.exit(r.ok?0:1))"
CMD ["node", "dist/main.js"]
```

### Worker — cần FFmpeg

```dockerfile
FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# ... (các stage deps/build tương tự API)
CMD ["node", "dist/main.js"]
```

Dùng `bookworm-slim` thay `alpine` cho worker: FFmpeg trên Alpine build bằng musl, thiếu một số codec và từng gặp lỗi lạ khi xử lý file lớn. Image nặng hơn ~150MB — đổi lại đỡ mất thời gian debug.

### Web

```dockerfile
FROM node:22-alpine AS build
# ... build ...
RUN pnpm --filter web build

FROM nginx:alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
```

`spa.conf` cần `try_files $uri $uri/ /index.html;` cho client-side routing.

## 5. Biến môi trường (`.env.example`)

```bash
NODE_ENV=development
PORT=4000
WEB_ORIGIN=http://localhost:5173

MONGO_URI=mongodb://localhost:27017/nekoflix?replicaSet=rs0
REDIS_URL=redis://localhost:6379

# pnpm run gen:secrets sẽ điền 4 dòng dưới
JWT_PRIVATE_KEY=
JWT_PUBLIC_KEY=
PLAYBACK_TOKEN_SECRET=
APP_ENCRYPTION_KEY=

ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=30d
PLAYBACK_TOKEN_TTL=6h

S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
S3_BUCKET_UPLOADS=nekoflix-uploads
S3_BUCKET_MEDIA=nekoflix-media
S3_BUCKET_PUBLIC=nekoflix-public

# https://console.cloud.google.com/apis/credentials
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# https://github.com/settings/developers
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
OAUTH_CALLBACK_BASE=http://localhost:4000/v1/auth/oauth

SMTP_URL=smtp://localhost:1025
MAIL_FROM=no-reply@nekoflix.local

TRANSCODE_CONCURRENCY=1
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
TRANSCODE_TMP_DIR=/tmp/nekoflix

# Billing mô phỏng — không có gateway thật
BILLING_PROVIDER=mock
BILLING_WEBHOOK_SECRET=            # gen:secrets điền
BILLING_MOCK_BASE=http://localhost:5173/mock-pay

# Tùy chọn — đều miễn phí, bỏ trống vẫn chạy được
TMDB_API_KEY=                      # miễn phí, đăng ký ở themoviedb.org
GLITCHTIP_DSN=                     # self-hosted, tương thích SDK Sentry
LOG_LEVEL=debug
```

### Sinh secret

```bash
# scripts/gen-secrets.sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /tmp/jwt.key
openssl rsa -in /tmp/jwt.key -pubout -out /tmp/jwt.pub
# ghi vào .env dạng một dòng, \n được escape
```

### Cấu hình OAuth ở local

**Google**: Authorized redirect URI = `http://localhost:4000/v1/auth/oauth/google/callback`
**GitHub**: Authorization callback URL = `http://localhost:4000/v1/auth/oauth/github/callback`

Cả hai provider đều chấp nhận `localhost` qua HTTP — không cần ngrok.

## 6. Seed data

`scripts/seed.ts` tạo:

- 1 admin (`admin@nekoflix.local` / `Admin12345`), 1 moderator, 3 user thường
- 2 profile cho user đầu tiên (1 người lớn, 1 kids)
- 18 genre
- 20 title (15 movie, 5 series với tổng 40 episode) — metadata lấy từ file JSON tĩnh, không gọi TMDB để seed chạy offline được
- 3 title gắn với video mẫu đã tải về (Big Buck Bunny, Sintel, Tears of Steel) — đã transcode sẵn hoặc tự enqueue job
- Progress mẫu để Continue Watching có dữ liệu ngay

```bash
pnpm db:seed              # thêm vào DB hiện có
pnpm db:seed --reset      # xóa sạch rồi seed lại
```

## 7. CI/CD (GitHub Actions)

```yaml
name: CI
on:
  pull_request:
  push: { branches: [main] }

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm run check:env # .env.example đồng bộ với envSchema

  test:
    runs-on: ubuntu-latest
    services:
      mongo:
        {
          image: mongo:7,
          ports: ['27017:27017'],
          options: --health-cmd "mongosh --eval 'db.runCommand(\"ping\")'",
        }
      redis: { image: redis:7, ports: ['6379:6379'] }
      minio: { image: minio/minio:latest, ports: ['9000:9000'] }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: sudo apt-get update && sudo apt-get install -y ffmpeg
      # Ngưỡng coverage ép ngay trong vitest.config.ts — không cần dịch vụ ngoài
      - run: pnpm test -- --coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: coverage, path: coverage/ }

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker compose -f infra/docker-compose.yml up -d --wait
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm build && pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report/ }

  build-images:
    needs: [check, test]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: docker/build-push-action@v6
        with:
          file: infra/docker/api.Dockerfile
          push: true
          tags: ghcr.io/${{ github.repository }}/api:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### Branch protection trên `main`

- PR bắt buộc, cần 1 approval (hoặc self-review nếu làm một mình)
- `check` và `test` phải xanh
- Không cho force push

## 8. Deploy — chi phí 0đ

Ràng buộc: **không trả tiền, không cần thẻ tín dụng**. Xem [ADR-008](adr/008-zero-cost-infrastructure.md) cho lý do và các phương án đã loại.

Có hai cấp, chọn theo nhu cầu:

### Cấp 1 — Local + Cloudflare Tunnel (mặc định)

Toàn bộ stack chạy trên máy mình; Cloudflare Tunnel phơi ra Internet qua HTTPS. Dùng khi cần demo, phỏng vấn, gửi link cho người khác xem.

```bash
# Cài một lần
winget install Cloudflare.cloudflared      # hoặc: brew install cloudflared

# Chạy nhanh — URL ngẫu nhiên dạng https://<random>.trycloudflare.com
cloudflared tunnel --url http://localhost:4000
```

Muốn URL cố định (vẫn miễn phí, cần một domain — xem mục 8.3):

```bash
cloudflared tunnel login
cloudflared tunnel create nekoflix
cloudflared tunnel route dns nekoflix nekoflix.<domain-cua-ban>
cloudflared tunnel run --config infra/cloudflared/config.yml nekoflix
```

```yaml
# infra/cloudflared/config.yml
tunnel: nekoflix
credentials-file: ~/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: nekoflix.example.dev
    service: http://localhost:5173
  - hostname: api.nekoflix.example.dev
    service: http://localhost:4000
  - service: http_status:404
```

| Ưu                                              | Nhược                         |
| ----------------------------------------------- | ----------------------------- |
| Miễn phí tuyệt đối, không cần thẻ               | Tắt máy là tắt web            |
| Dùng đúng tài nguyên máy mình — transcode nhanh | Không phù hợp để "chạy thật"  |
| Có HTTPS thật, không cần mở port router         | Băng thông phụ thuộc mạng nhà |
| Không lộ IP nhà (Cloudflare đứng giữa)          |                               |

> Cloudflare Tunnel **không tính phí băng thông** và không yêu cầu thẻ. Đây là điểm khác biệt so với ngrok (free tier giới hạn và URL đổi liên tục).

### Cấp 2 — Oracle Cloud Always Free (nếu cần 24/7)

Gói Always Free của Oracle là thứ hào phóng nhất còn tồn tại: **4 ARM Ampere core + 24GB RAM + 200GB block storage + 10TB egress/tháng**, miễn phí vĩnh viễn (không phải trial).

Đủ sức chạy **toàn bộ** stack kể cả transcode trên một máy.

```
VM.Standard.A1.Flex — 4 OCPU, 24GB RAM, Ubuntu 24.04 (arm64)
├── Caddy            (reverse proxy + TLS tự động)
├── web (nginx)
├── api
├── worker           (FFmpeg)
├── mongo            (replica set 1 node)
├── redis
└── minio            (dùng block storage 200GB)
```

**Những điều phải biết trước khi chọn:**

| Điều                             | Chi tiết                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Cần thẻ để xác minh danh tính    | **Không bị trừ tiền**, nhưng nếu không muốn đưa thẻ thì dùng Cấp 1                                                                             |
| Kiến trúc là **ARM64**           | Mọi Docker image phải có bản arm64. `node`, `mongo`, `redis`, `minio`, `nginx`, `caddy` đều có. FFmpeg trên Debian arm64 hoạt động bình thường |
| Khó lấy máy ở region đông        | Thường báo "out of capacity". Chọn region ít người, hoặc thử lại nhiều lần                                                                     |
| Tài khoản idle có thể bị thu hồi | Giữ máy có hoạt động; backup đều đặn                                                                                                           |

Build image đa kiến trúc trong CI:

```yaml
- uses: docker/setup-qemu-action@v3
- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v6
  with:
    platforms: linux/amd64,linux/arm64 # arm64 cho Oracle
    file: infra/docker/api.Dockerfile
    push: true
    tags: ghcr.io/${{ github.repository }}/api:${{ github.sha }}
```

Deploy qua SSH trong GitHub Actions:

```yaml
- uses: appleboy/ssh-action@v1
  with:
    host: ${{ secrets.DEPLOY_HOST }}
    key: ${{ secrets.DEPLOY_SSH_KEY }}
    script: |
      cd /opt/nekoflix
      docker compose -f docker-compose.prod.yml pull
      docker compose -f docker-compose.prod.yml up -d --remove-orphans
      docker image prune -f
```

### 8.1 Frontend — Cloudflare Pages

Miễn phí, **băng thông không giới hạn**, không cần thẻ. Build từ GitHub, deploy tự động mỗi lần push.

```
Build command:        pnpm install && pnpm --filter web build
Build output:         apps/web/dist
Environment variable: VITE_API_URL=https://api.<domain>
```

Cloudflare Pages không giới hạn băng thông ở gói free — đây là lý do chọn nó thay vì Vercel (Vercel free giới hạn 100GB/tháng và cấm dùng thương mại).

### 8.2 Lưu trữ video

**Tự host MinIO**, không dùng dịch vụ object storage bên ngoài.

Lý do: video ăn dung lượng rất nhanh. Cloudflare R2 cho 10GB free — một bộ phim 1080p sau transcode đã ~4GB (tổng 4 rendition). Nghĩa là **free tier chứa được 2–3 phim**. Vượt qua là tính tiền.

| Phương án                       | Dung lượng free     | Chứa được |
| ------------------------------- | ------------------- | --------- |
| Cloudflare R2                   | 10GB                | ~2 phim   |
| Backblaze B2                    | 10GB                | ~2 phim   |
| MinIO trên Oracle block storage | **200GB**           | ~50 phim  |
| MinIO trên máy local            | Bằng ổ cứng của bạn | Tùy       |

MinIO tự host thắng tuyệt đối ở đây, và không phải lo bị tính phí bất ngờ.

> Nếu dùng Cấp 1 (local), đặt `S3_ENDPOINT` trỏ về MinIO local. Cloudflare Tunnel phơi luôn cả endpoint media. Egress qua Tunnel miễn phí.

### 8.3 Domain miễn phí

| Nguồn                 | Dạng                         | Ghi chú                                                                  |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| **`is-a.dev`**        | `nekoflix.is-a.dev`          | Mở PR vào repo GitHub của họ, duyệt trong 1–2 ngày. Dành cho dev, uy tín |
| **`js.org`**          | `nekoflix.js.org`            | Tương tự, cho dự án JavaScript                                           |
| **DuckDNS**           | `nekoflix.duckdns.org`       | Đăng ký tức thì, có API cập nhật IP động                                 |
| **Cloudflare Tunnel** | `<random>.trycloudflare.com` | Không cần gì cả, nhưng URL đổi mỗi lần chạy                              |

TLS luôn miễn phí: Cloudflare cấp sẵn, hoặc Caddy tự xin Let's Encrypt.

### 8.4 Email

| Môi trường     | Giải pháp                         | Giới hạn                       |
| -------------- | --------------------------------- | ------------------------------ |
| Dev            | **Mailpit** (đã có trong compose) | Không, chạy local              |
| Demo công khai | **Brevo** free                    | 300 email/ngày, không cần thẻ  |
| Thay thế       | **Resend** free                   | 3.000/tháng, 100/ngày          |
| Thay thế       | Gmail SMTP + App Password         | ~500/ngày, dễ bị đánh dấu spam |

Mặc định cứ dùng Mailpit. Chỉ đổi khi thật sự cần gửi mail ra ngoài.

### 8.5 Giám sát lỗi

Thay Sentry bằng **GlitchTip** — mã nguồn mở, **tương thích SDK của Sentry** nên code không đổi một dòng nào, chỉ đổi DSN.

```yaml
# thêm vào docker-compose.prod.yml
glitchtip:
  image: glitchtip/glitchtip:latest
  environment:
    DATABASE_URL: postgres://...
    SECRET_KEY: ${GLITCHTIP_SECRET}
  ports: ['8000:8080']
```

Cần thêm một Postgres nhỏ. Nếu thấy nặng, bỏ qua hoàn toàn — pino log ra file + `docker logs` là đủ cho dự án học tập.

### 8.6 Bảng tổng kết chi phí

| Thành phần         | Giải pháp                         | Cần thẻ?     | Chi phí |
| ------------------ | --------------------------------- | ------------ | ------- |
| Frontend           | Cloudflare Pages                  | Không        | 0đ      |
| API + Worker       | Local, hoặc Oracle Always Free    | Local: không | 0đ      |
| MongoDB            | Tự host (Docker)                  | Không        | 0đ      |
| Redis              | Tự host (Docker)                  | Không        | 0đ      |
| Object storage     | MinIO tự host                     | Không        | 0đ      |
| CDN + TLS + Tunnel | Cloudflare                        | Không        | 0đ      |
| Domain             | is-a.dev / DuckDNS                | Không        | 0đ      |
| Email              | Mailpit → Brevo free              | Không        | 0đ      |
| Giám sát           | GlitchTip tự host                 | Không        | 0đ      |
| CI/CD              | GitHub Actions (2.000 phút/tháng) | Không        | 0đ      |
| Registry           | GitHub Container Registry         | Không        | 0đ      |
| Thanh toán         | Mock provider tự viết             | Không        | 0đ      |
| Metadata phim      | TMDB API                          | Không        | 0đ      |
| **Tổng**           |                                   |              | **0đ**  |

Chỉ Oracle Cloud cần thẻ để xác minh (không trừ tiền). Bỏ Oracle đi thì **không cần thẻ ở bất kỳ đâu**.

## 9. Backup

| Dữ liệu | Cách                                                                                       | Tần suất       | Giữ                                   |
| ------- | ------------------------------------------------------------------------------------------ | -------------- | ------------------------------------- |
| MongoDB | `mongodump` → `gzip` → đẩy lên **Backblaze B2 free (10GB)** hoặc Google Drive qua `rclone` | Hàng ngày 3:00 | 7 bản ngày, 4 bản tuần                |
| MinIO   | Bật versioning; `mc mirror` sang ổ ngoài / máy khác                                        | Hàng tuần      | 2 bản                                 |
| Redis   | Không backup                                                                               | —              | Chỉ chứa cache và state tạm, mất được |

Dump metadata của 50 phim chỉ vài MB — thừa sức nằm trong mọi free tier. **Không backup file video** lên cloud (quá lớn); video gốc giữ bản copy trên ổ cứng ngoài.

```bash
# scripts/backup.sh — chạy bằng cron
STAMP=$(date +%F)
docker exec mongo mongodump --archive --gzip --db=nekoflix > "/backup/mongo-$STAMP.gz"
rclone copy "/backup/mongo-$STAMP.gz" remote:nekoflix-backup/
find /backup -name 'mongo-*.gz' -mtime +7 -delete
```

**Phải diễn tập restore ít nhất một lần.** Backup chưa restore thử thì chưa gọi là backup.

## 10. Xử lý sự cố thường gặp

| Triệu chứng                                                               | Nguyên nhân                                  | Cách sửa                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| `MongoServerError: Transaction numbers are only allowed on a replica set` | Mongo chạy standalone                        | Đảm bảo `--replSet rs0` và đã chạy `rs.initiate()`               |
| Upload lên MinIO bị CORS                                                  | Chưa set CORS cho bucket                     | Chạy lại `minio-init`                                            |
| Video không phát, console báo `manifestLoadError`                         | Playback token hết hạn hoặc sai asset        | Kiểm tra TTL token, xem log của `/media/manifest`                |
| Transcode treo ở 12%                                                      | FFmpeg chờ input (file hỏng)                 | Kiểm tra `docker logs worker`; thêm `-nostdin` vào command       |
| WebSocket connect rồi disconnect ngay                                     | Access token hết hạn                         | Refresh trước khi mở socket; kiểm tra handler `handleConnection` |
| `EADDRINUSE :4000` trên Windows                                           | Process cũ chưa chết                         | `netstat -ano \| findstr :4000` rồi `taskkill /PID <pid> /F`     |
| Docker chạy chậm trên Windows                                             | File nằm trên ổ Windows, bind mount qua WSL2 | Đặt repo trong filesystem của WSL2 (`\\wsl$\...`)                |
| Hết dung lượng đĩa                                                        | Transcode để lại file tạm                    | `docker system prune -a` + kiểm tra `TRANSCODE_TMP_DIR`          |

---

**Tiếp theo**: [11 — Roadmap](11-roadmap.md)
