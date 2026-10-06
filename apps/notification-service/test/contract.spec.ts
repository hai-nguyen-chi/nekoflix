import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mongoose, { type ClientSession, type Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  EVENT_FIXTURES,
  EVENT_REGISTRY,
  parseEventData,
  type EventEnvelope,
  type EventType,
} from '@nekoflix/contracts';

import { IdentityHandlers } from '../src/events/identity.handlers';
import { EmailOutbox, EmailOutboxSchema } from '../src/persistence/schemas/email-outbox.schema';
import { Notification, NotificationSchema } from '../src/persistence/schemas/notification.schema';

/**
 * CONTRACT TEST — phía CONSUMER.
 *
 * identity-service KHÔNG chạy ở đây. Đầu vào là `EVENT_FIXTURES` trong
 * `@nekoflix/contracts` — cùng bộ dữ liệu mà contract test phía producer
 * dùng để kiểm chứng thứ nó phát ra.
 *
 * Hai bên không bao giờ chạy cùng nhau, nhưng cả hai đều bị ràng buộc bởi
 * một schema và một bộ fixture. Sửa schema mà quên một bên -> TypeScript
 * báo lỗi lúc build, hoặc một trong hai bộ test này đỏ.
 *
 * handlers.spec.ts kiểm tra NGHIỆP VỤ (nội dung email, điều kiện gửi).
 * File này chỉ kiểm tra: dữ liệu đúng hợp đồng thì consumer xử lý được.
 */

let replSet: MongoMemoryReplSet;
let Emails: Model<EmailOutbox>;
let Notifications: Model<Notification>;
let handlers: IdentityHandlers;

beforeAll(async () => {
  process.env.WEB_ORIGIN = 'http://localhost:5173';

  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'test' });

  Emails = mongoose.model<EmailOutbox>(EmailOutbox.name, EmailOutboxSchema);
  Notifications = mongoose.model<Notification>(Notification.name, NotificationSchema);
  await Promise.all([Emails.createIndexes(), Notifications.createIndexes()]);

  handlers = new IdentityHandlers(Emails, Notifications);
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

/**
 * Dựng envelope đúng như JetStreamConsumer giao cho handler: payload đã
 * được `parseEventData` kiểm tra trước. Dùng dữ liệu chưa parse ở đây sẽ
 * test một đường đi không tồn tại trong thực tế.
 */
function envelopeFor<T extends EventType>(type: T, id: string): EventEnvelope<any> {
  return {
    id,
    type,
    version: EVENT_REGISTRY[type].version,
    occurredAt: '2026-01-15T08:30:00.000Z',
    producer: 'identity-service@0.1.0',
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    correlationId: 'req-contract-test',
    causationId: null,
    data: parseEventData(type, EVENT_FIXTURES[type]),
  };
}

/** Mô phỏng đúng cách JetStreamConsumer gọi handler: trong một transaction */
async function run(fn: (s: ClientSession) => Promise<void>): Promise<void> {
  const s = await mongoose.connection.startSession();
  try {
    await s.withTransaction(async () => {
      await fn(s);
    });
  } finally {
    await s.endSession();
  }
}

/**
 * Event nào do handler nào xử lý. Bảng viết tay thay vì tra ngược từ
 * decorator `@OnEvent`: tra ngược thì đổi tên event ở hai nơi cùng lúc
 * vẫn xanh. Viết tay thì không.
 *
 * Thunk vì `handlers` chỉ tồn tại sau `beforeAll`.
 */
const HANDLED: {
  type: EventType;
  invoke: (e: EventEnvelope<any>, s: ClientSession) => Promise<void>;
}[] = [
  { type: 'identity.user.registered', invoke: (e, s) => handlers.onRegistered(e, s) },
  { type: 'identity.user.verified', invoke: (e, s) => handlers.onVerified(e, s) },
  { type: 'identity.user.logged_in', invoke: (e, s) => handlers.onLoggedIn(e, s) },
  { type: 'identity.security.alert', invoke: (e, s) => handlers.onSecurityAlert(e, s) },
  { type: 'identity.password.reset_requested', invoke: (e, s) => handlers.onPasswordReset(e, s) },
];

// ═══════════════════════════════════════════════════════════════
describe('Consumer xử lý được mọi fixture chuẩn', () => {
  for (const { type, invoke } of HANDLED) {
    it(`${type}: xử lý không lỗi và đưa email vào hàng đợi`, async () => {
      const e = envelopeFor(type, `contract-${type}`);

      await run((s) => invoke(e, s));

      const mail = await Emails.findOne().lean();
      expect(mail, `${type} không tạo email nào`).toBeTruthy();

      // eventId là khoá chống trùng. Lấy nhầm id khác (vd userId) thì
      // event bị giao lại sẽ sinh email thứ hai.
      expect(mail!.eventId).toBe(e.id);
      expect(mail!.status).toBe('pending');
      expect(mail!.subject.length).toBeGreaterThan(0);
      expect(mail!.html).toContain('NEKOFLIX');
      expect(mail!.text.length).toBeGreaterThan(0);
    });
  }
});

describe('Rò rỉ dữ liệu nhạy cảm vào email', () => {
  it('email xác thực chứa token xác thực, KHÔNG chứa userId', async () => {
    const e = envelopeFor('identity.user.registered', 'leak-1');
    await run((s) => handlers.onRegistered(e, s));

    const mail = await Emails.findOne().lean();
    const fixture = EVENT_FIXTURES['identity.user.registered'];

    expect(mail!.text).toContain(fixture.verificationToken);
    // userId là id nội bộ. Lộ ra email là cho người nhận một mảnh thông
    // tin về cấu trúc database mà họ không cần.
    expect(mail!.html).not.toContain(fixture.userId);
    expect(mail!.text).not.toContain(fixture.userId);
  });

  it('email cảnh báo bảo mật không chứa User-Agent thô', async () => {
    const e = envelopeFor('identity.security.alert', 'leak-2');
    await run((s) => handlers.onSecurityAlert(e, s));

    const mail = await Emails.findOne().lean();
    const fixture = EVENT_FIXTURES['identity.security.alert'];

    // Hợp đồng có userAgent để consumer khác dùng; email thì không cần.
    expect(mail!.text).not.toContain(fixture.userAgent);
  });
});

describe('Độ phủ hợp đồng phía consumer', () => {
  it('mọi event identity.* đều hoặc được xử lý, hoặc được bỏ qua CÓ CHỦ Ý', () => {
    // Danh sách bỏ qua phải viết tay. Thêm event mới mà quên viết handler
    // thì test này đỏ, thay vì event lặng lẽ không ai nhận.
    const IGNORED: EventType[] = ['identity.profile.created', 'identity.profile.deleted'];

    const handled = HANDLED.map((h) => h.type);
    const identityEvents = (Object.keys(EVENT_REGISTRY) as EventType[]).filter((t) =>
      t.startsWith('identity.'),
    );

    const unaccounted = identityEvents.filter((t) => !handled.includes(t) && !IGNORED.includes(t));

    expect(
      unaccounted,
      `event chưa có handler và cũng chưa được khai là bỏ qua: ${unaccounted.join(', ')}`,
    ).toEqual([]);
  });
});
