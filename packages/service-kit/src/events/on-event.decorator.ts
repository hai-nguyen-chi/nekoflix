import { SetMetadata } from '@nestjs/common';
import type { EventType } from '@nekoflix/contracts';

export const ON_EVENT_METADATA = 'nekoflix:on_event';

/**
 * Đăng ký một method làm consumer của một event.
 *
 * ```ts
 * @Injectable()
 * export class EchoHandlers {
 *   @OnEvent('ping.echo.created')
 *   async onCreated(event: EventEnvelope<PingEchoCreatedV1>) { ... }
 * }
 * ```
 *
 * Idempotency được bọc sẵn bởi JetStreamConsumer — handler KHÔNG cần tự lo,
 * nhưng vẫn phải biết rằng nó có thể chạy lại nếu process chết giữa chừng.
 */
export const OnEvent = (type: EventType): MethodDecorator => SetMetadata(ON_EVENT_METADATA, type);
