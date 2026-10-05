import { DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { JetStreamConsumer } from './events/jetstream.consumer';
import { HealthController } from './health/health.controller';
import { IndexGuard } from './infra/index-guard';
import { IdempotencyService } from './idempotency/idempotency.service';
import { ProcessedEvent, ProcessedEventSchema } from './idempotency/processed-event.schema';
import { NatsConnectionProvider } from './nats/nats.connection';
import { OutboxRelay } from './outbox/outbox.relay';
import { OutboxEvent, OutboxEventSchema } from './outbox/outbox.schema';
import { OutboxService } from './outbox/outbox.service';
import { NATS_CLIENT, RpcClient } from './rpc/rpc-client';
import { SERVICE_IDENTITY, type ServiceIdentity } from './tokens';

export interface ServiceKitModuleOptions {
  name: string;
  version: string;
  /** Tên database riêng của service, vd 'nekoflix_identity'. Bỏ trống = không dùng Mongo (gateway) */
  database?: string;
  /** Bật outbox + relay. Cần `database`. */
  outbox?: boolean;
  /** Bật JetStream consumer. Cần `database` (để lưu processedEvents). */
  consumeEvents?: boolean;
}

/**
 * Hạ tầng dùng chung cho mọi service.
 *
 * CẠM BẪY: package này CHỈ được chứa hạ tầng kỹ thuật. Ngay khi logic nghiệp
 * vụ lọt vào đây, mọi service lại phải deploy cùng nhau — distributed
 * monolith qua đường thư viện dùng chung.
 *
 * Quy tắc kiểm tra: nếu một thay đổi trong service-kit buộc phải deploy đồng
 * thời nhiều service, nó không thuộc về đây.
 */
@Global()
@Module({})
export class ServiceKitModule {
  static forRoot(options: ServiceKitModuleOptions): DynamicModule {
    const identity: ServiceIdentity = { name: options.name, version: options.version };

    const imports: DynamicModule['imports'] = [
      DiscoveryModule,
      ClientsModule.register([
        {
          name: NATS_CLIENT,
          transport: Transport.NATS,
          options: {
            servers: (process.env.NATS_URL ?? 'nats://localhost:4222').split(','),
            // Queue group: nhiều instance cùng service -> NATS tự chia tải.
            // Không cần service discovery, không cần load balancer.
            queue: options.name,
          },
        },
      ]),
    ];

    const providers: Provider[] = [
      { provide: SERVICE_IDENTITY, useValue: identity },
      NatsConnectionProvider,
      RpcClient,
    ];

    const exported: NonNullable<DynamicModule['exports']> = [
      SERVICE_IDENTITY,
      NatsConnectionProvider,
      RpcClient,
    ];

    if (options.database) {
      providers.push(IndexGuard);
      exported.push(IndexGuard);
      imports.push(
        MongooseModule.forRoot(buildMongoUri(options.database), {
          autoIndex: process.env.NODE_ENV !== 'production',
          serverSelectionTimeoutMS: 10_000,
        }),
      );
    }

    if (options.outbox) {
      assertDatabase(options, 'outbox');
      imports.push(
        MongooseModule.forFeature([{ name: OutboxEvent.name, schema: OutboxEventSchema }]),
      );
      providers.push(OutboxService, OutboxRelay);
      exported.push(OutboxService);
    }

    if (options.consumeEvents) {
      assertDatabase(options, 'consumeEvents');
      imports.push(
        MongooseModule.forFeature([{ name: ProcessedEvent.name, schema: ProcessedEventSchema }]),
      );
      providers.push(IdempotencyService, JetStreamConsumer);
      exported.push(IdempotencyService);
    }

    return {
      module: ServiceKitModule,
      imports,
      providers,
      exports: exported,
      controllers: options.database ? [HealthController] : [],
    };
  }
}

function assertDatabase(options: ServiceKitModuleOptions, feature: string): void {
  if (!options.database) {
    throw new Error(`ServiceKitModule: bật "${feature}" thì phải khai báo "database".`);
  }
}

/**
 * Dựng connection string với DB user riêng của service.
 *
 * Mỗi service một user chỉ có quyền trên database của mình (ADR-012) —
 * đọc nhầm database của service khác là lỗi runtime ngay, không phải chuyện
 * kỷ luật.
 */
function buildMongoUri(database: string): string {
  const explicit = process.env.MONGO_URI;
  if (explicit) return explicit;

  const host = process.env.MONGO_HOST ?? 'localhost:27017';
  const replicaSet = process.env.MONGO_REPLICA_SET ?? 'rs0';
  // 'nekoflix_identity' -> 'identity_svc'
  const user = `${database.replace(/^nekoflix_/, '')}_svc`;
  const password = process.env.SERVICE_DB_PASSWORD ?? 'devpassword';

  return (
    `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}/${database}` +
    `?replicaSet=${replicaSet}&directConnection=true&authSource=admin`
  );
}
