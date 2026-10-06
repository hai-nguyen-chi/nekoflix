import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose, { type ClientSession, type Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { EventEnvelope } from '@nekoflix/contracts';

import { IdentityHandlers } from '../src/events/identity.handlers';
import { EmailOutbox, EmailOutboxSchema } from '../src/persistence/schemas/email-outbox.schema';
import { Notification, NotificationSchema } from '../src/persistence/schemas/notification.schema';

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

function envelope<T>(type: string, data: T, id = `evt-${Math.random()}`): EventEnvelope<T> {
  return {
    id,
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    producer: 'identity-service@test',
    traceId: '',
    correlationId: '',
    causationId: null,
    data,
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

const REGISTERED = {
  userId: 'u1',
  email: 'an@example.com',
  displayName: 'An Nguyen',
  verificationToken: 'tok-abc-123',
  verificationExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  registeredAt: new Date().toISOString(),
};

// ═══════════════════════════════════════════════════════════════
describe('Đăng ký', () => {
  it('đưa email chào mừng vào hàng đợi kèm link xác thực đúng', async () => {
    const e = envelope('identity.user.registered', REGISTERED);
    await run((s) => handlers.onRegistered(e, s));

    const mail = await Emails.findOne().lean();
    expect(mail?.to).toBe('an@example.com');
    expect(mail?.status).toBe('pending');
    // Link phải dùng được: có đủ origin, đường dẫn và token
    expect(mail?.text).toContain('http://localhost:5173/verify?token=tok-abc-123');
    expect(mail?.html).toContain('tok-abc-123');
  });

  it('tạo thông báo in-app', async () => {
    await run((s) => handlers.onRegistered(envelope('identity.user.registered', REGISTERED), s));
    expect(await Notifications.countDocuments({ userId: 'u1', type: 'welcome' })).toBe(1);
  });

  it('tài khoản OAuth (token rỗng) -> KHÔNG gửi email xác thực', async () => {
    const e = envelope('identity.user.registered', { ...REGISTERED, verificationToken: '' });
    await run((s) => handlers.onRegistered(e, s));

    // Nhà cung cấp đã xác thực email rồi, gửi thêm là làm phiền
    expect(await Emails.countDocuments()).toBe(0);
    expect(await Notifications.countDocuments()).toBe(1); // vẫn chào mừng
  });

  it('email KHÔNG được gửi trong handler — chỉ đưa vào hàng đợi', async () => {
    await run((s) => handlers.onRegistered(envelope('identity.user.registered', REGISTERED), s));

    // Gửi email trong transaction là sai: rollback không thu lại được email
    // đã bay đi. Handler chỉ ghi hàng đợi, relay riêng mới gửi.
    expect((await Emails.findOne().lean())?.status).toBe('pending');
    expect((await Emails.findOne().lean())?.sentAt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Idempotency — event bị giao lại', () => {
  it('CÙNG event 3 lần -> chỉ MỘT email', async () => {
    const e = envelope('identity.user.registered', REGISTERED, 'evt-co-dinh');

    await run((s) => handlers.onRegistered(e, s));
    // JetStream giao at-least-once: lần 2 và 3 phải đụng unique eventId
    for (let i = 0; i < 2; i++) {
      await run((s) => handlers.onRegistered(e, s)).catch(() => undefined);
    }

    expect(await Emails.countDocuments()).toBe(1);
  });

  it('event KHÁC nhau -> email khác nhau', async () => {
    await run((s) =>
      handlers.onRegistered(envelope('identity.user.registered', REGISTERED, 'evt-1'), s),
    );
    await run((s) =>
      handlers.onRegistered(
        envelope('identity.user.registered', { ...REGISTERED, email: 'b@example.com' }, 'evt-2'),
        s,
      ),
    );

    expect(await Emails.countDocuments()).toBe(2);
  });

  it('transaction rollback -> KHÔNG để lại email mồ côi', async () => {
    const e = envelope('identity.user.registered', REGISTERED);

    await expect(
      run(async (s) => {
        await handlers.onRegistered(e, s);
        throw new Error('lỗi cố ý sau khi ghi');
      }),
    ).rejects.toThrow();

    // Nếu còn lại, relay sẽ gửi email cho một sự kiện đã bị huỷ
    expect(await Emails.countDocuments()).toBe(0);
    expect(await Notifications.countDocuments()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Đăng nhập thiết bị mới', () => {
  const LOGIN = {
    userId: 'u1',
    email: 'an@example.com',
    deviceLabel: 'Chrome trên Windows',
    ip: '1.2.3.4',
    isNewDevice: true,
    loggedInAt: new Date().toISOString(),
  };

  it('thiết bị MỚI -> gửi cảnh báo', async () => {
    await run((s) => handlers.onLoggedIn(envelope('identity.user.logged_in', LOGIN), s));

    const mail = await Emails.findOne().lean();
    expect(mail?.subject).toContain('thiết bị mới');
    expect(mail?.text).toContain('Chrome trên Windows');
    expect(mail?.text).toContain('1.2.3.4');
  });

  it('thiết bị ĐÃ BIẾT -> KHÔNG gửi gì', async () => {
    const e = envelope('identity.user.logged_in', { ...LOGIN, isNewDevice: false });
    await run((s) => handlers.onLoggedIn(e, s));

    // Gửi email mỗi lần đăng nhập làm người dùng quen tay bỏ qua,
    // và cảnh báo thật mất tác dụng
    expect(await Emails.countDocuments()).toBe(0);
    expect(await Notifications.countDocuments()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Cảnh báo bảo mật và đặt lại mật khẩu', () => {
  it('token_reuse_detected -> email cảnh báo nghiêm trọng', async () => {
    const e = envelope('identity.security.alert', {
      userId: 'u1',
      email: 'an@example.com',
      type: 'token_reuse_detected',
      ip: '9.9.9.9',
      userAgent: 'Chrome',
      detail: 'Đã thu hồi 3 phiên.',
      occurredAt: new Date().toISOString(),
    });
    await run((s) => handlers.onSecurityAlert(e, s));

    const mail = await Emails.findOne().lean();
    expect(mail?.subject).toContain('nghiêm trọng');
    expect(mail?.text).toContain('Đã thu hồi 3 phiên.');
  });

  it('đặt lại mật khẩu -> email có link, KHÔNG tạo thông báo in-app', async () => {
    const e = envelope('identity.password.reset_requested', {
      userId: 'u1',
      email: 'an@example.com',
      displayName: 'An Nguyen',
      resetToken: 'reset-xyz',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      ip: '1.2.3.4',
      requestedAt: new Date().toISOString(),
    });
    await run((s) => handlers.onPasswordReset(e, s));

    expect((await Emails.findOne().lean())?.text).toContain(
      'http://localhost:5173/reset-password?token=reset-xyz',
    );
    // Người quên mật khẩu thường không đăng nhập được -> sẽ không bao giờ
    // thấy thông báo in-app, tạo nó là vô ích
    expect(await Notifications.countDocuments()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Chất lượng email', () => {
  it('mọi email đều có CẢ html lẫn text', async () => {
    await run((s) => handlers.onRegistered(envelope('identity.user.registered', REGISTERED), s));

    const mail = await Emails.findOne().lean();
    // Thiếu bản text: bộ lọc thư rác cho điểm trừ, và trình đọc màn hình
    // nhận được mớ thẻ HTML
    expect(mail?.html).toContain('<!DOCTYPE html>');
    expect(mail?.text.length).toBeGreaterThan(50);
    expect(mail?.text).not.toContain('<');
  });

  it('KHÔNG lộ token trong tiêu đề email', async () => {
    await run((s) => handlers.onRegistered(envelope('identity.user.registered', REGISTERED), s));
    // Tiêu đề hiện ở màn hình khoá điện thoại và trong danh sách hộp thư
    expect((await Emails.findOne().lean())?.subject).not.toContain('tok-abc-123');
  });
});
