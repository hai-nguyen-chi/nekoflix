import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { type Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { generateKeyPairSync } from 'node:crypto';

import { AuthService } from '../src/application/auth.service';
import { PasswordResetService } from '../src/application/password.service';
import { PasswordService } from '../src/domain/password.service';
import { TokenService } from '../src/domain/token.service';
import { User, UserSchema } from '../src/persistence/schemas/user.schema';
import { Session, SessionSchema } from '../src/persistence/schemas/session.schema';
import { Profile, ProfileSchema } from '../src/persistence/schemas/profile.schema';
import {
  VerificationToken,
  VerificationTokenSchema,
} from '../src/persistence/schemas/verification-token.schema';

let replSet: MongoMemoryReplSet;
let Users: Model<User>;
let Sessions: Model<Session>;
let Verifications: Model<VerificationToken>;
let auth: AuthService;
let reset: PasswordResetService;
const published: { type: string; data: Record<string, unknown> }[] = [];

const CTX = { ip: '10.0.0.1', userAgent: 'Chrome/120 Windows' };
let userId: string;
let sessionId: string;

beforeAll(async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  process.env.JWT_PRIVATE_KEY = privateKey;
  process.env.JWT_PUBLIC_KEY = publicKey;

  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'test' });

  Users = mongoose.model<User>(User.name, UserSchema);
  Sessions = mongoose.model<Session>(Session.name, SessionSchema);
  const Profiles = mongoose.model<Profile>(Profile.name, ProfileSchema);
  Verifications = mongoose.model<VerificationToken>(
    VerificationToken.name,
    VerificationTokenSchema,
  );
  await Promise.all([
    Users.createIndexes(),
    Sessions.createIndexes(),
    Profiles.createIndexes(),
    Verifications.createIndexes(),
  ]);

  const outbox = {
    publish: vi.fn((type: string, data: Record<string, unknown>) => {
      published.push({ type, data });
      return Promise.resolve('evt');
    }),
    withTransaction: async <T>(fn: (s: mongoose.ClientSession) => Promise<T>): Promise<T> => {
      const s = await mongoose.connection.startSession();
      try {
        let result!: T;
        await s.withTransaction(async () => {
          result = await fn(s);
        });
        return result;
      } finally {
        await s.endSession();
      }
    },
  };

  const passwords = new PasswordService();
  const tokens = new TokenService();
  auth = new AuthService(
    Users,
    Sessions,
    Profiles,
    Verifications,
    passwords,
    tokens,
    outbox as never,
  );
  reset = new PasswordResetService(
    Users,
    Sessions,
    Verifications,
    passwords,
    tokens,
    outbox as never,
  );
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

beforeEach(async () => {
  published.length = 0;
  const res = await auth.register({
    email: 'an@example.com',
    password: 'Matkhau123',
    displayName: 'An Nguyen',
    ctx: CTX,
  });
  userId = res.user.id;
  sessionId = (await Sessions.findOne({ userId }).lean())!._id.toString();
  published.length = 0;
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

const resetTokenFrom = () =>
  published.find((e) => e.type === 'identity.password.reset_requested')?.data.resetToken as string;

// ═══════════════════════════════════════════════════════════════
describe('Quên mật khẩu — chống dò tài khoản', () => {
  it('email CÓ thật -> ok:true và phát event kèm token', async () => {
    const res = await reset.forgot({ email: 'an@example.com', ctx: CTX });

    expect(res.ok).toBe(true);
    expect(resetTokenFrom()).toEqual(expect.any(String));
  });

  it('email KHÔNG tồn tại -> vẫn ok:true, KHÔNG phát event', async () => {
    // Trả lỗi ở đây biến endpoint thành công cụ dò danh sách người dùng
    const res = await reset.forgot({ email: 'khong-co@example.com', ctx: CTX });

    expect(res.ok).toBe(true);
    expect(published).toHaveLength(0);
  });

  it('tài khoản bị khoá -> vẫn ok:true, không gửi gì', async () => {
    await Users.updateOne({ _id: userId }, { $set: { status: 'suspended' } });

    const res = await reset.forgot({ email: 'an@example.com', ctx: CTX });
    expect(res.ok).toBe(true);
    expect(published).toHaveLength(0);
  });

  it('yêu cầu mới VÔ HIỆU token cũ', async () => {
    await reset.forgot({ email: 'an@example.com', ctx: CTX });
    const first = resetTokenFrom();
    published.length = 0;

    await reset.forgot({ email: 'an@example.com', ctx: CTX });

    // Một email cũ bị rò rỉ không được dùng để đặt lại mật khẩu nữa
    await expect(
      reset.reset({ token: first, newPassword: 'MatkhauMoi1', ctx: CTX }),
    ).rejects.toMatchObject({ code: 'TOKEN_CONSUMED' });
  });

  it('quá 3 lần/giờ -> im lặng bỏ qua, VẪN trả ok:true', async () => {
    for (let i = 0; i < 3; i++) {
      await reset.forgot({ email: 'an@example.com', ctx: CTX });
    }
    published.length = 0;

    const res = await reset.forgot({ email: 'an@example.com', ctx: CTX });

    // Trả 429 sẽ để lộ rằng email này CÓ trong hệ thống
    expect(res.ok).toBe(true);
    expect(published).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Đặt lại mật khẩu', () => {
  it('token hợp lệ -> đổi mật khẩu, đăng nhập được bằng mật khẩu mới', async () => {
    await reset.forgot({ email: 'an@example.com', ctx: CTX });
    await reset.reset({ token: resetTokenFrom(), newPassword: 'MatkhauMoi1', ctx: CTX });

    const ok = await auth.login({ email: 'an@example.com', password: 'MatkhauMoi1', ctx: CTX });
    expect(ok.user.email).toBe('an@example.com');

    await expect(
      auth.login({ email: 'an@example.com', password: 'Matkhau123', ctx: CTX }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('thu hồi TOÀN BỘ phiên, kể cả phiên đang gọi', async () => {
    await auth.login({ email: 'an@example.com', password: 'Matkhau123', ctx: CTX });
    await auth.login({ email: 'an@example.com', password: 'Matkhau123', ctx: CTX });
    expect(await Sessions.countDocuments({ userId, status: 'active' })).toBe(3);

    await reset.forgot({ email: 'an@example.com', ctx: CTX });
    await reset.reset({ token: resetTokenFrom(), newPassword: 'MatkhauMoi1', ctx: CTX });

    // Người ta đặt lại mật khẩu thường vì nghi bị xâm nhập.
    // Giữ lại phiên nào cũng là giữ cho kẻ tấn công một đường vào.
    expect(await Sessions.countDocuments({ userId, status: 'active' })).toBe(0);
  });

  it('token dùng được ĐÚNG MỘT LẦN', async () => {
    await reset.forgot({ email: 'an@example.com', ctx: CTX });
    const token = resetTokenFrom();
    await reset.reset({ token, newPassword: 'MatkhauMoi1', ctx: CTX });

    await expect(
      reset.reset({ token, newPassword: 'MatkhauKhac2', ctx: CTX }),
    ).rejects.toMatchObject({ code: 'TOKEN_CONSUMED' });
  });

  it('token hết hạn -> TOKEN_EXPIRED', async () => {
    await reset.forgot({ email: 'an@example.com', ctx: CTX });
    await Verifications.updateOne(
      { type: 'password_reset' },
      { $set: { expiresAt: new Date(Date.now() - 1) } },
    );

    await expect(
      reset.reset({ token: resetTokenFrom(), newPassword: 'MatkhauMoi1', ctx: CTX }),
    ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('token bịa đặt -> TOKEN_INVALID', async () => {
    await expect(
      reset.reset({ token: 'token-gia', newPassword: 'MatkhauMoi1', ctx: CTX }),
    ).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('đặt lại qua email cũng XÁC THỰC luôn email', async () => {
    expect((await Users.findById(userId).lean())?.emailVerifiedAt).toBeNull();

    await reset.forgot({ email: 'an@example.com', ctx: CTX });
    await reset.reset({ token: resetTokenFrom(), newPassword: 'MatkhauMoi1', ctx: CTX });

    // Mở được email tức là sở hữu hộp thư -> không cần xác thực riêng
    expect((await Users.findById(userId).lean())?.emailVerifiedAt).not.toBeNull();
  });

  it('KHÔNG lưu token đặt lại dạng thô', async () => {
    await reset.forgot({ email: 'an@example.com', ctx: CTX });
    const doc = await Verifications.findOne({ type: 'password_reset' }).lean();

    expect(doc?.tokenHash).not.toBe(resetTokenFrom());
    expect(doc?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('phát cảnh báo bảo mật', async () => {
    await reset.forgot({ email: 'an@example.com', ctx: CTX });
    const token = resetTokenFrom();
    published.length = 0;

    await reset.reset({ token, newPassword: 'MatkhauMoi1', ctx: CTX });

    const alert = published.find((e) => e.type === 'identity.security.alert');
    expect(alert?.data.type).toBe('password_changed');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Đổi mật khẩu khi đang đăng nhập', () => {
  it('đúng mật khẩu cũ -> đổi được', async () => {
    await reset.change({
      userId,
      sessionId,
      currentPassword: 'Matkhau123',
      newPassword: 'MatkhauMoi1',
      ctx: CTX,
    });

    const ok = await auth.login({ email: 'an@example.com', password: 'MatkhauMoi1', ctx: CTX });
    expect(ok.user.id).toBe(userId);
  });

  it('SAI mật khẩu cũ -> từ chối, dù đã đăng nhập', async () => {
    // Thiếu bước này, ai mượn được máy lúc đang mở là chiếm luôn tài khoản
    await expect(
      reset.change({
        userId,
        sessionId,
        currentPassword: 'SaiRoi123',
        newPassword: 'MatkhauMoi1',
        ctx: CTX,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('mật khẩu mới trùng mật khẩu cũ -> từ chối', async () => {
    await expect(
      reset.change({
        userId,
        sessionId,
        currentPassword: 'Matkhau123',
        newPassword: 'Matkhau123',
        ctx: CTX,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('GIỮ phiên hiện tại, thu hồi các phiên khác', async () => {
    await auth.login({ email: 'an@example.com', password: 'Matkhau123', ctx: CTX });
    await auth.login({ email: 'an@example.com', password: 'Matkhau123', ctx: CTX });

    const res = await reset.change({
      userId,
      sessionId,
      currentPassword: 'Matkhau123',
      newPassword: 'MatkhauMoi1',
      ctx: CTX,
    });

    // Chủ động đổi mật khẩu thì không nên bị đá khỏi chính máy đang dùng
    expect(res.revokedSessions).toBe(2);
    const current = await Sessions.findById(sessionId).lean();
    expect(current?.status).toBe('active');
  });

  it('tài khoản chỉ dùng OAuth -> ĐẶT mật khẩu lần đầu, không cần mật khẩu cũ', async () => {
    await Users.updateOne({ _id: userId }, { $set: { passwordHash: null } });

    await reset.change({ userId, sessionId, newPassword: 'MatkhauMoi1', ctx: CTX });

    const ok = await auth.login({ email: 'an@example.com', password: 'MatkhauMoi1', ctx: CTX });
    expect(ok.user.id).toBe(userId);
  });
});
