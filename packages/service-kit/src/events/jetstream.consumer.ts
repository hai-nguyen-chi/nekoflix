import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import {
  ROOT_CONTEXT,
  SpanStatusCode,
  context as otelContext,
  propagation,
  trace,
} from '@opentelemetry/api';
import type { ConsumerMessages, JsMsg } from 'nats';
import type { ClientSession } from 'mongoose';
import {
  EVENT_STREAM_NAME,
  dlqSubject,
  eventSubject,
  isKnownEventType,
  type EventEnvelope,
  type EventType,
} from '@nekoflix/contracts';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { getLogger, requestStorage } from '../observability/logger';
import { dlqTotal, eventDuplicates, eventDuration, eventFailures } from '../observability/metrics';
import { NatsConnectionProvider } from '../nats/nats.connection';
import { SERVICE_IDENTITY, type ServiceIdentity } from '../tokens';
import { ON_EVENT_METADATA } from './on-event.decorator';

const MAX_DELIVER = 5;
const ACK_WAIT_MS = 30_000;
const MAX_ACK_PENDING = 100;
/** Backoff khi nak: 1s, 5s, 25s, 125s */
const NAK_BACKOFF_MS = [1_000, 5_000, 25_000, 125_000];

export type EventHandlerFn = (
  event: EventEnvelope<unknown>,
  session: ClientSession,
) => Promise<void> | void;

interface RegisteredHandler {
  instance: Record<string, unknown>;
  method: string;
  providerName: string;
}

@Injectable()
export class JetStreamConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly handlers = new Map<EventType, RegisteredHandler>();
  private messages?: ConsumerMessages;
  private stopped = false;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly nats: NatsConnectionProvider,
    private readonly idempotency: IdempotencyService,
    @Inject(SERVICE_IDENTITY) private readonly identity: ServiceIdentity,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.discoverHandlers();

    if (this.handlers.size === 0) {
      getLogger().info('không có @OnEvent handler, bỏ qua JetStream consumer');
      return;
    }

    const types = [...this.handlers.keys()];
    await this.nats.ensureConsumer(this.identity.name, types.map(eventSubject), {
      maxDeliver: MAX_DELIVER,
      ackWaitMs: ACK_WAIT_MS,
      maxAckPending: MAX_ACK_PENDING,
    });

    const consumer = await this.nats
      .jetstream()
      .consumers.get(EVENT_STREAM_NAME, this.identity.name);
    this.messages = await consumer.consume();

    getLogger().info({ events: types }, 'JetStream consumer đã khởi động');
    void this.loop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    this.messages?.stop();
  }

  private discoverHandlers(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | null;
      if (!instance || typeof instance !== 'object') continue;

      const proto = Object.getPrototypeOf(instance) as object;
      if (!proto) continue;

      for (const method of this.scanner.getAllMethodNames(proto)) {
        const fn = instance[method];
        if (typeof fn !== 'function') continue;

        const type = this.reflector.get<EventType | undefined>(ON_EVENT_METADATA, fn);
        if (!type) continue;

        if (this.handlers.has(type)) {
          throw new Error(
            `Event "${type}" đã có handler trong service này. ` +
              `Một service chỉ được có MỘT handler cho mỗi event — ` +
              `nếu cần nhiều việc, gọi chúng từ bên trong handler đó.`,
          );
        }

        this.handlers.set(type, {
          instance,
          method,
          providerName: String(wrapper.name ?? 'unknown'),
        });
      }
    }
  }

  private async loop(): Promise<void> {
    if (!this.messages) return;
    try {
      // Xử lý tuần tự: đơn giản và giữ đúng thứ tự trong một subject.
      // Cần throughput cao hơn thì chạy nhiều instance service — NATS tự
      // chia tải qua cùng durable consumer.
      for await (const msg of this.messages) {
        if (this.stopped) break;
        await this.handleMessage(msg);
      }
    } catch (err) {
      if (!this.stopped) {
        getLogger().error({ err: String(err) }, 'vòng lặp JetStream consumer dừng bất thường');
      }
    }
  }

  private async handleMessage(msg: JsMsg): Promise<void> {
    let envelope: EventEnvelope<unknown>;
    try {
      envelope = this.nats.decode<EventEnvelope<unknown>>(msg.data);
    } catch (err) {
      // Payload hỏng — retry bao nhiêu lần cũng vô ích
      getLogger().error({ subject: msg.subject, err: String(err) }, 'event không decode được');
      msg.term();
      return;
    }

    if (!isKnownEventType(envelope.type)) {
      getLogger().warn({ type: envelope.type }, 'event lạ, bỏ qua');
      msg.ack();
      return;
    }

    const handler = this.handlers.get(envelope.type);
    if (!handler) {
      msg.ack();
      return;
    }

    const parentCtx = envelope.traceparent
      ? propagation.extract(ROOT_CONTEXT, { traceparent: envelope.traceparent })
      : ROOT_CONTEXT;

    const store = {
      requestId: envelope.id,
      correlationId: envelope.correlationId,
      traceId: envelope.traceId,
    };

    const stop = eventDuration.startTimer({ type: envelope.type });

    await otelContext.with(parentCtx, () =>
      requestStorage.run(store, async () => {
        const tracer = trace.getTracer('@nekoflix/service-kit');
        return tracer.startActiveSpan(`event ${envelope.type}`, async (span) => {
          span.setAttribute('messaging.system', 'nats');
          span.setAttribute('messaging.message.id', envelope.id);
          span.setAttribute('messaging.destination.name', msg.subject);
          span.setAttribute('nekoflix.delivery_count', msg.info.redeliveryCount);

          try {
            const result = await this.idempotency.runOnce(
              envelope.id,
              this.identity.name,
              envelope.type,
              async (session) => {
                const fn = handler.instance[handler.method] as EventHandlerFn;
                await fn.call(handler.instance, envelope, session);
              },
            );

            if (result === 'duplicate') {
              eventDuplicates.inc({ type: envelope.type });
              span.setAttribute('nekoflix.duplicate', true);
              getLogger().debug(
                { eventId: envelope.id, type: envelope.type },
                'event trùng, đã bỏ qua',
              );
            }

            msg.ack();
            stop({ status: result });
            span.setStatus({ code: SpanStatusCode.OK });
          } catch (err) {
            stop({ status: 'error' });
            eventFailures.inc({ type: envelope.type });
            span.setStatus({ code: SpanStatusCode.ERROR });
            span.recordException(err instanceof Error ? err : new Error(String(err)));
            await this.handleFailure(msg, envelope, err);
          } finally {
            span.end();
          }
        });
      }),
    );
  }

  private async handleFailure(
    msg: JsMsg,
    envelope: EventEnvelope<unknown>,
    err: unknown,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const delivery = msg.info.redeliveryCount;
    const log = getLogger();

    if (delivery >= MAX_DELIVER) {
      // Hết lượt thử — đẩy sang DLQ và TERM để JetStream ngừng giao lại.
      // Không term thì message quay vòng mãi và chặn chỗ max_ack_pending.
      try {
        await this.nats.jetstream().publish(
          dlqSubject(envelope.type),
          this.nats.encode({
            originalSubject: msg.subject,
            event: envelope,
            consumer: this.identity.name,
            failedAt: new Date().toISOString(),
            deliveryCount: delivery,
            lastError: message.slice(0, 1000),
          }),
        );
        dlqTotal.inc({ type: envelope.type });
        log.error(
          { eventId: envelope.id, type: envelope.type, deliveries: delivery, err: message },
          'event đẩy sang DLQ sau khi hết lượt thử',
        );
      } catch (dlqErr) {
        log.error({ err: String(dlqErr) }, 'KHÔNG publish được sang DLQ');
      }
      msg.term();
      return;
    }

    const delay = NAK_BACKOFF_MS[Math.min(delivery - 1, NAK_BACKOFF_MS.length - 1)] ?? 1_000;
    log.warn(
      { eventId: envelope.id, type: envelope.type, delivery, retryInMs: delay, err: message },
      'xử lý event lỗi, sẽ thử lại',
    );
    msg.nak(delay);
  }
}
