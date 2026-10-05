# 09 — Project Structure & Conventions

## 1. Monorepo

pnpm workspaces + Turborepo.

```
nekoflix/
├── apps/
│   ├── web/                      # React SPA
│   ├── gateway/                  # api-gateway
│   ├── identity-service/
│   ├── catalog-service/
│   ├── media-service/
│   ├── transcode-worker/
│   ├── activity-service/
│   ├── realtime-service/
│   ├── billing-service/          # Phase 5
│   ├── notification-service/     # Phase 5
│   └── recommendation-service/   # Phase 5
├── packages/
│   ├── contracts/            # Zod schema: event + request/reply + HTTP DTO
│   ├── service-kit/          # ⭐ khung chung cho mọi service
│   ├── config-eslint/
│   ├── config-ts/
│   └── ui/                   # (tùy chọn) component dùng chung web + admin
├── infra/
│   ├── docker/
│   │   ├── service.Dockerfile      # dùng chung, truyền SERVICE build-arg
│   │   ├── worker.Dockerfile       # riêng vì cần FFmpeg
│   │   └── web.Dockerfile
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   ├── nats/nats.conf
│   ├── mongo/init-users.js         # tạo 8 DB user
│   └── minio/init-buckets.sh
├── docs/
├── scripts/
│   ├── seed.ts
│   ├── new-service.ts        # scaffold một service mới từ template
│   └── download-sample-videos.sh
├── .github/workflows/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── .env.example
```

### `packages/service-kit` — khung chung

Với 9 service, mỗi service tự dựng lại bootstrap, logger, tracing, outbox, health check là 9 lần lặp — và 9 chỗ để lệch nhau. Gom vào một package:

```
packages/service-kit/src/
├── bootstrap.ts          # createService(): NATS transport + OTel + graceful shutdown
├── outbox/               # OutboxModule, OutboxService, OutboxRelay
├── idempotency/          # ProcessedEventsModule, @Idempotent decorator
├── nats/                 # client typed theo contracts, request có timeout + breaker
├── observability/        # pino + OTel + prom-client, cấu hình sẵn
├── health/               # /health/live, /health/ready
├── errors/               # AppError, map sang NATS error response
└── testing/              # test harness dùng chung
```

```ts
// apps/catalog-service/src/main.ts — mọi service trông giống nhau
import { createService } from '@nekoflix/service-kit';
import { AppModule } from './app.module';

await createService({
  name: 'catalog-service',
  module: AppModule,
  database: 'nekoflix_catalog',
  outbox: true,
  healthPort: 4002,
});
```

> Đây là chỗ đáng đầu tư nhất khi làm microservices một mình. Không có nó, mỗi service mới tốn một ngày dựng hạ tầng lặp lại, và sau 9 service thì có 9 phiên bản logger khác nhau.

**Cạm bẫy phải tránh**: `service-kit` chỉ được chứa **hạ tầng kỹ thuật**. Ngay khi logic nghiệp vụ lọt vào đây, mọi service lại phải deploy cùng nhau — distributed monolith qua đường thư viện dùng chung. Quy tắc: nếu một thay đổi trong `service-kit` buộc phải deploy đồng thời nhiều service, nó không thuộc về đó.

### Tại sao monorepo?

Lợi ích cụ thể ở dự án này: `packages/contracts` cho phép định nghĩa Zod schema **một lần**, dùng ở cả validate DTO phía Nest lẫn validate form phía React. Đổi field ở backend → TypeScript báo lỗi ngay ở frontend. Đó là giá trị thật, không phải vì monorepo "hiện đại".

### `packages/contracts`

```ts
// packages/contracts/src/auth.ts
import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z
    .string()
    .min(8)
    .regex(/[a-zA-Z]/)
    .regex(/[0-9]/),
  displayName: z.string().min(2).max(50),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
  user: userSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
```

```ts
// apps/api — dùng làm DTO
@Post('register')
register(@Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto) { }

// apps/web — dùng làm form resolver
const form = useForm<RegisterDto>({ resolver: zodResolver(registerSchema) });
```

---

## 2. Cấu trúc một service

Mọi service dùng chung khuôn này — nhất quán quan trọng hơn tối ưu riêng lẻ.

```
apps/<name>-service/
├── src/
│   ├── main.ts                    # gọi createService() từ service-kit
│   ├── app.module.ts
│   ├── config/env.schema.ts       # env riêng của service này
│   ├── api/                       # @MessagePattern — biên vào của service
│   │   ├── <aggregate>.controller.ts
│   │   └── dto/
│   ├── events/
│   │   ├── handlers/              # @EventPattern — consume event
│   │   └── publishers/            # helper gói outbox.publish
│   ├── domain/                    # business logic thuần, KHÔNG I/O
│   │   ├── <aggregate>.service.ts
│   │   └── __tests__/
│   ├── persistence/
│   │   ├── schemas/
│   │   └── <aggregate>.repository.ts
│   ├── clients/                   # gọi service khác (typed, có breaker)
│   │   └── identity.client.ts
│   └── sagas/                     # nếu service này điều phối saga
├── migrations/
├── test/
│   ├── contract/                  # producer + consumer contract test
│   └── integration/
└── package.json
```

### Phân lớp

```
api/          → biên NATS: parse payload, gọi domain, map lỗi.
                KHÔNG chứa business logic.

events/       → biên event: idempotency, ack, gọi domain.
                KHÔNG chứa business logic.

domain/       → toàn bộ business logic. KHÔNG biết NATS, KHÔNG biết Mongoose.
                Đây là nơi chứa giá trị thật và là nơi dễ test nhất.

persistence/  → truy cập DB. Chỉ nơi này import Mongoose model.

clients/      → gọi service khác. Mỗi client bọc sẵn timeout + circuit breaker
                + fallback. Domain gọi interface, không gọi NATS trực tiếp.
```

`domain/` không được import gì từ `api/`, `events/`, hay `clients/` cụ thể — chỉ import **interface** của client. Nhờ đó test domain không cần NATS, không cần Mongo.

### Quy tắc phụ thuộc (enforce bằng ESLint)

```js
'import/no-restricted-paths': ['error', { zones: [
  { target: './src/domain', from: './src/api' },
  { target: './src/domain', from: './src/events' },
  { target: './src/domain', from: './src/persistence' },   // domain dùng interface, không dùng repo cụ thể
  { target: './src/persistence', from: './src/api' },
]}],
```

### Ranh giới quan trọng nhất: không service nào import service khác

```js
// Cấm tuyệt đối trong mọi apps/*-service
'no-restricted-imports': ['error', { patterns: [{
  group: ['@nekoflix/*-service', '../../*-service/**'],
  message: 'Service không được import service khác. Dùng NATS client hoặc event.',
}]}],
```

Chỉ được import `@nekoflix/contracts` và `@nekoflix/service-kit`. Vi phạm quy tắc này là bước đầu tiên dẫn tới distributed monolith.

### Phân lớp — mỗi lớp một việc

```
Controller  → HTTP: parse request, gọi service, trả response.
              KHÔNG chứa business logic. KHÔNG đụng vào Mongoose model.

Service     → Business logic, orchestration, transaction.
              KHÔNG biết gì về HTTP (không có req/res).

Repository  → Truy cập dữ liệu. Chỉ nơi này import Mongoose model.
              Trả về domain object, không trả document Mongoose thô.

Schema      → Định nghĩa Mongoose schema + index.
```

Lý do có Repository dù Mongoose đã là một lớp abstraction: service viết test được bằng cách mock repository (không cần DB), và khi cần đổi query (vd thêm index hint, đổi sang aggregation) thì chỉ sửa một chỗ.

```ts
// titles.repository.ts
@Injectable()
export class TitlesRepository {
  constructor(@InjectModel(Title.name) private model: Model<TitleDocument>) {}

  async findPublishedBySlug(slug: string): Promise<Title | null> {
    const doc = await this.model
      .findOne({ slug, status: 'published', deletedAt: null })
      .lean() // trả plain object, nhanh hơn ~3x
      .exec();
    return doc ? toTitle(doc) : null;
  }
}
```

---

## 3. `apps/worker`

```
apps/worker/
├── src/
│   ├── main.ts                    # khởi tạo BullMQ Worker
│   ├── config/
│   ├── processors/
│   │   ├── transcode.processor.ts
│   │   ├── media-cleanup.processor.ts
│   │   └── recommendation.processor.ts
│   ├── ffmpeg/
│   │   ├── ffmpeg-runner.ts       # spawn, parse progress, xử lý lỗi
│   │   ├── ffprobe.ts
│   │   ├── hls-builder.ts         # dựng command line
│   │   └── thumbnail.ts
│   └── lib/
│       ├── storage.ts             # tải xuống / tải lên MinIO
│       └── progress-reporter.ts   # publish Redis
└── package.json
```

Worker **không** import code từ `apps/api`. Nếu cần dùng chung (vd Mongoose schema), đưa vào `packages/contracts` hoặc một package `packages/data` riêng.

---

## 4. Quy ước đặt tên

### File

| Loại            | Quy ước                             | Ví dụ                     |
| --------------- | ----------------------------------- | ------------------------- |
| React component | PascalCase                          | `TitleCard.tsx`           |
| Hook            | camelCase, prefix `use`             | `useProgressSync.ts`      |
| Nest file       | kebab-case + hậu tố                 | `watch-party.service.ts`  |
| Test            | `*.spec.ts` (unit), `*.e2e-spec.ts` | `auth.service.spec.ts`    |
| Type thuần      | kebab-case                          | `playback-token.types.ts` |
| Thư mục         | kebab-case                          | `watch-party/`            |

### Code

```ts
// Hằng số: SCREAMING_SNAKE_CASE
const MAX_PROFILES_PER_USER = 5;

// Type/Interface/Class: PascalCase. KHÔNG prefix `I`
interface PlaybackContext {}

// Enum: dùng union type thay enum của TS (enum sinh runtime code thừa)
type MaturityRating = 'G' | 'PG' | 'PG-13' | 'R' | 'NC-17';

// Boolean: prefix is/has/should/can
const isHost = true;
const hasActiveSubscription = false;

// Hàm async trả Promise: tên là động từ
async function createWatchParty() {}

// Event name: <domain>:<action> hoặc <domain>.<action> (EventEmitter2)
socket.emit('party:seek', {});
eventEmitter.emit('playback.progress.updated', {});
```

### Git branch & commit

```
Branch:  feat/watch-party-sync
         fix/refresh-token-race
         docs/api-spec
         chore/upgrade-nest-11

Commit (Conventional Commits):
         feat(auth): add refresh token rotation with reuse detection
         fix(player): keep currentTime when playback token is renewed
         docs(api): document stream limit error shape
         refactor(catalog): extract home row builder
         test(party): cover host transfer after disconnect
```

---

## 5. TypeScript config

```jsonc
// packages/config-ts/base.json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true, // arr[0] có type T | undefined
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
  },
}
```

`noUncheckedIndexedAccess` gây phiền lúc đầu nhưng bắt được đúng loại bug hay gặp khi xử lý mảng rendition, segment, parts.

NestJS cần thêm `"emitDecoratorMetadata": true`, `"experimentalDecorators": true`.

---

## 6. ESLint

Các rule đáng chú ý ngoài preset:

```js
// packages/config-eslint/index.js
rules: {
  '@typescript-eslint/no-floating-promises': 'error',    // quên await = bug âm thầm
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/consistent-type-imports': 'error',
  'no-restricted-imports': ['error', {
    patterns: [
      { group: ['../../*'], message: 'Dùng alias @/ thay vì đi ngược nhiều cấp.' },
    ],
  }],
  'import/no-restricted-paths': ['error', {
    zones: [
      { target: './src/infra', from: './src/modules',
        message: 'infra/ không được phụ thuộc modules/.' },
      { target: './src/shared', from: './src/features',
        message: 'shared/ không được phụ thuộc features/.' },
    ],
  }],
}
```

---

## 7. Biến môi trường

Validate bằng Zod lúc khởi động — **fail fast**, không để app chạy với config thiếu.

```ts
// apps/api/src/config/env.schema.ts
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().default(4000),

  MONGO_URI: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  PLAYBACK_TOKEN_SECRET: z.string().min(32),
  APP_ENCRYPTION_KEY: z.string().length(64), // 32 byte hex

  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET_UPLOADS: z.string(),
  S3_BUCKET_MEDIA: z.string(),
  S3_BUCKET_PUBLIC: z.string(),

  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  GITHUB_CLIENT_ID: z.string(),
  GITHUB_CLIENT_SECRET: z.string(),
  OAUTH_CALLBACK_BASE: z.string().url(),

  SMTP_URL: z.string(),
  MAIL_FROM: z.string().email(),

  // Billing mô phỏng — không có gateway thật (ADR-009)
  BILLING_PROVIDER: z.literal('mock').default('mock'),
  BILLING_WEBHOOK_SECRET: z.string().min(32),
  BILLING_MOCK_BASE: z.string().url(),

  WEB_ORIGIN: z.string().url(),
  TMDB_API_KEY: z.string().optional(),
  GLITCHTIP_DSN: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;
```

`.env.example` phải luôn đồng bộ — CI có bước kiểm tra mọi key trong `envSchema` đều xuất hiện trong `.env.example`.

---

## 8. Script

```jsonc
// package.json gốc
{
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "test:e2e": "turbo run test:e2e",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "format": "prettier --write .",
    "db:seed": "tsx scripts/seed.ts",
    "db:migrate": "pnpm --filter api migrate:up",
    "infra:up": "docker compose -f infra/docker-compose.yml up -d",
    "infra:down": "docker compose -f infra/docker-compose.yml down",
  },
}
```

---

## 9. Git hooks (husky + lint-staged)

```jsonc
// pre-commit
"lint-staged": {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,yml}": ["prettier --write"]
}

// commit-msg: commitlint (conventional)
// pre-push: pnpm typecheck && pnpm test --filter=...[origin/main]
```

Không chạy full test suite ở pre-commit — chậm quá sẽ khiến người ta `--no-verify`.

---

**Tiếp theo**: [10 — Local Setup & DevOps](10-devops-setup.md)
