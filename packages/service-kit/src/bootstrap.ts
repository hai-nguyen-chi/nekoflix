import 'reflect-metadata';
import type { INestApplication, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Transport, type MicroserviceOptions } from '@nestjs/microservices';
import { loadEnv } from './config/load-env';
import { AllExceptionsFilter } from './rpc/rpc-exception.filter';
import { RpcContextInterceptor } from './rpc/rpc-context.interceptor';
import { PinoNestLogger, createRootLogger, getLogger } from './observability/logger';
import { initMetrics } from './observability/metrics';
import { startTelemetry, stopTelemetry } from './observability/telemetry';

export interface CreateServiceOptions {
  name: string;
  version?: string;
  /**
   * PHẢI là dynamic import, không phải module đã import sẵn.
   *
   * Auto-instrumentation của OpenTelemetry vá module lúc `require`. Import
   * AppModule ở đầu file nghĩa là mongoose/http đã nằm trong cache của Node
   * trước khi SDK kịp khởi động — trace sẽ thiếu hẳn tầng database mà không
   * báo lỗi gì.
   *
   * ```ts
   * await createService({
   *   name: 'identity-service',
   *   moduleFactory: async () => (await import('./app.module')).AppModule,
   *   healthPort: 4101,
   * });
   * ```
   */
  moduleFactory: () => Promise<Type<unknown>>;
  /** Cổng phục vụ /health và /metrics. Gateway dùng cổng này cho cả HTTP công khai. */
  healthPort: number;
  /** Bật NATS microservice listener (service nghiệp vụ). Gateway để false. */
  enableRpcServer?: boolean;
  /** Chạy thêm cấu hình riêng trước khi listen (gateway dùng để gắn middleware) */
  configure?: (app: INestApplication) => void | Promise<void>;
}

export async function createService(options: CreateServiceOptions): Promise<INestApplication> {
  // TRƯỚC mọi thứ khác: nạp .env, nếu không telemetry tắt im lặng
  const envPath = loadEnv();

  const version = options.version ?? process.env.SERVICE_VERSION ?? '0.1.0';

  process.env.SERVICE_NAME = options.name;

  const logger = createRootLogger(options.name, process.env.LOG_LEVEL ?? 'info');
  initMetrics(options.name);

  // TRƯỚC khi nạp bất cứ thứ gì chạm mongoose/http
  startTelemetry({
    serviceName: options.name,
    serviceVersion: version,
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  });

  const AppModule = await options.moduleFactory();

  const app = await NestFactory.create(AppModule, {
    logger: new PinoNestLogger(logger),
    bufferLogs: false,
  });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new RpcContextInterceptor());
  app.enableShutdownHooks();

  if (options.enableRpcServer !== false) {
    app.connectMicroservice<MicroserviceOptions>(
      {
        transport: Transport.NATS,
        options: {
          servers: (process.env.NATS_URL ?? 'nats://localhost:4222').split(','),
          queue: options.name,
        },
      },
      { inheritAppConfig: true },
    );
    await app.startAllMicroservices();
  }

  await options.configure?.(app);

  await app.listen(options.healthPort, '0.0.0.0');

  logger.info(
    {
      port: options.healthPort,
      rpc: options.enableRpcServer !== false,
      tracing: !!process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
      envFile: envPath ?? '(không tìm thấy .env — dùng mặc định)',
    },
    `${options.name} đã sẵn sàng`,
  );

  installShutdownHandlers(app, options.name);
  return app;
}

function installShutdownHandlers(app: INestApplication, name: string): void {
  let closing = false;

  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    getLogger().info({ signal }, `${name} đang tắt...`);

    const timer = setTimeout(() => {
      getLogger().error('tắt quá lâu, buộc thoát');
      process.exit(1);
    }, 15_000);
    timer.unref();

    try {
      // app.close() chạy onApplicationShutdown: relay dừng, NATS drain,
      // mongo đóng. Thứ tự do Nest lo theo chiều ngược của dependency graph.
      await app.close();
      await stopTelemetry();
      clearTimeout(timer);
      process.exit(0);
    } catch (err) {
      getLogger().error({ err: String(err) }, 'lỗi khi tắt');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    getLogger().error({ reason: String(reason) }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    getLogger().fatal({ err: err.stack }, 'uncaught exception — thoát');
    process.exit(1);
  });
}
