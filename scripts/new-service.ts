/**
 * Scaffold một service mới theo đúng khuôn của dự án.
 *
 *   pnpm new:service identity 4001
 *
 * Tạo ra apps/<name>-service/ với đầy đủ: package.json, tsconfig, nest-cli,
 * main.ts, app.module.ts, và khung thư mục api/ domain/ persistence/ events/.
 *
 * Vì sao cần script này thay vì copy-paste: với 9 service, mỗi lần dựng tay
 * là một cơ hội để cấu trúc lệch đi một chút. Sau vài service thì mỗi cái
 * một kiểu, và "khuôn chung" chỉ còn trên giấy.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [rawName, rawPort] = process.argv.slice(2);

if (!rawName || !rawPort) {
  console.error(`
Cách dùng:  pnpm new:service <tên> <cổng>

Ví dụ:      pnpm new:service identity 4001
            pnpm new:service catalog 4002

Cổng theo quy ước (docs/13-service-catalog.md):
  gateway 4000 · identity 4001 · catalog 4002 · media 4003
  activity 4004 · realtime 4005 · billing 4006
  notification 4007 · reco 4008
`);
  process.exit(1);
}

const name = rawName.replace(/-service$/, '');
const port = Number(rawPort);

if (!/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('Tên service phải là chữ thường, kebab-case. Vd: identity, watch-party');
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('Cổng phải là số nguyên trong khoảng 1024–65535.');
  process.exit(1);
}

const serviceName = `${name}-service`;
const root = resolve(process.cwd(), 'apps', serviceName);
const database = `nekoflix_${name}`;

if (existsSync(root)) {
  console.error(`apps/${serviceName} đã tồn tại.`);
  process.exit(1);
}

const write = (relativePath: string, content: string): void => {
  const full = resolve(root, relativePath);
  mkdirSync(resolve(full, '..'), { recursive: true });
  writeFileSync(full, content);
  console.log(`  + apps/${serviceName}/${relativePath}`);
};

// ─── package.json ────────────────────────────────────────────────
write(
  'package.json',
  JSON.stringify(
    {
      name: serviceName,
      version: '0.1.0',
      private: true,
      scripts: {
        build: 'nest build',
        dev: 'nest start --watch',
        start: 'node dist/main.js',
        typecheck: 'tsc -p tsconfig.json --noEmit',
        lint: 'eslint src --max-warnings 0',
        clean: 'rimraf dist',
      },
      dependencies: {
        '@nekoflix/contracts': 'workspace:*',
        '@nekoflix/service-kit': 'workspace:*',
        '@nestjs/common': '^11.0.1',
        '@nestjs/core': '^11.0.1',
        '@nestjs/microservices': '^11.0.1',
        '@nestjs/mongoose': '^11.0.0',
        '@nestjs/platform-express': '^11.0.1',
        mongoose: '^8.9.2',
        nats: '^2.29.1',
        'reflect-metadata': '^0.2.2',
        rxjs: '^7.8.1',
        zod: '^3.24.1',
      },
      devDependencies: {
        '@nekoflix/config-eslint': 'workspace:*',
        '@nekoflix/config-ts': 'workspace:*',
        '@nestjs/cli': '^11.0.0',
        '@nestjs/schematics': '^11.0.0',
        '@types/node': '^20.17.10',
        eslint: '^9.17.0',
        rimraf: '^6.0.1',
        typescript: '^5.7.2',
      },
    },
    null,
    2,
  ) + '\n',
);

write(
  'tsconfig.json',
  JSON.stringify(
    {
      extends: '@nekoflix/config-ts/nest.json',
      compilerOptions: {
        rootDir: './src',
        outDir: './dist',
        types: ['node', 'reflect-metadata'],
      },
      include: ['src/**/*'],
    },
    null,
    2,
  ) + '\n',
);

write(
  'nest-cli.json',
  JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/nest-cli',
      collection: '@nestjs/schematics',
      sourceRoot: 'src',
      compilerOptions: { deleteOutDir: true, tsConfigPath: 'tsconfig.json' },
    },
    null,
    2,
  ) + '\n',
);

// ─── main.ts ─────────────────────────────────────────────────────
write(
  'src/main.ts',
  `import { createService } from '@nekoflix/service-kit';

/**
 * \`moduleFactory\` là dynamic import có CHỦ ĐÍCH, không phải import ở đầu file.
 *
 * OpenTelemetry vá mongoose/http lúc \`require\`. Import AppModule ở trên cùng
 * nghĩa là mongoose đã vào cache của Node trước khi SDK kịp khởi động — trace
 * sẽ thiếu hẳn tầng database, im lặng, không báo lỗi gì.
 */
void createService({
  name: '${serviceName}',
  version: '0.1.0',
  moduleFactory: async () => (await import('./app.module')).AppModule,
  healthPort: Number(process.env.PORT ?? ${port}),
});
`,
);

// ─── app.module.ts ───────────────────────────────────────────────
write(
  'src/app.module.ts',
  `import { Module } from '@nestjs/common';
import { ServiceKitModule } from '@nekoflix/service-kit';

@Module({
  imports: [
    ServiceKitModule.forRoot({
      name: '${serviceName}',
      version: '0.1.0',
      database: '${database}',
      // Bật khi service này PHÁT event
      outbox: false,
      // Bật khi service này NGHE event (@OnEvent)
      consumeEvents: false,
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
`,
);

// ─── Khung thư mục + ghi chú phân lớp ────────────────────────────
write(
  'src/api/.gitkeep',
  `Biên NATS của service: @MessagePattern.
Parse payload -> gọi domain -> trả kết quả. KHÔNG chứa business logic.
`,
);
write(
  'src/events/handlers/.gitkeep',
  `Biên event: @OnEvent.
Idempotency đã được JetStreamConsumer bọc sẵn — handler nhận (event, session)
và PHẢI ghi qua session đó, nếu không bản ghi nằm ngoài transaction.
`,
);
write(
  'src/domain/.gitkeep',
  `Toàn bộ business logic. KHÔNG biết NATS, KHÔNG biết Mongoose.
Đây là nơi dễ test nhất và chứa giá trị thật của service.
ESLint chặn import @nestjs/microservices, mongoose, nats ở thư mục này.
`,
);
write(
  'src/persistence/schemas/.gitkeep',
  `Mongoose schema. LUÔN khai báo @Prop({ type: ... }) tường minh —
vitest dùng esbuild, không emit decorator metadata.
Tránh đặt field tên "id": đụng virtual id có sẵn của Mongoose.
`,
);
write(
  'src/clients/.gitkeep',
  `Gọi service khác. Mỗi client bọc sẵn timeout + circuit breaker + fallback.
Domain gọi interface, không gọi NATS trực tiếp.
`,
);
write(
  'test/.gitkeep',
  `Contract test (producer + consumer) và integration test.
Xem docs/12-testing-strategy.md
`,
);

/**
 * Chạy Prettier lên thứ vừa sinh ra.
 *
 * `JSON.stringify(x, null, 2)` trải mảng ngắn ra nhiều dòng, còn Prettier
 * (printWidth 100) gộp lại — nên file scaffold ra luôn trượt `format:check`
 * và CI đỏ ngay ở feature đầu tiên của service mới. Đã dính một lần với
 * catalog-service.
 *
 * `--ignore-unknown` vì thư mục có các file `.gitkeep`, Prettier không đoán
 * được parser và sẽ thoát với lỗi thay vì bỏ qua.
 */
try {
  execFileSync('npx', ['prettier', '--write', '--ignore-unknown', `apps/${serviceName}`], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  console.log('\n  đã chạy Prettier lên file vừa tạo');
} catch {
  console.log('\n  CHƯA chạy được Prettier — nhớ gõ `pnpm format` trước khi commit');
}

console.log(`
Đã tạo apps/${serviceName}

Việc PHẢI làm tiếp:
  1. pnpm install
  2. Thêm '${name}' vào SERVICES trong infra/mongo/init-users.js
     rồi chạy lại:  docker compose -f infra/docker-compose.yml up mongo-init
  3. Khai báo RPC subject + event trong packages/contracts
  4. Cập nhật docs/13-service-catalog.md (trách nhiệm, dữ liệu, event)

Chạy thử:
  pnpm --filter ${serviceName} dev
  curl localhost:${port}/health/ready
`);
