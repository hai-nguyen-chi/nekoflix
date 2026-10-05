import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { type Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { generateKeyPairSync } from 'node:crypto';

import { AuthService } from '../src/application/auth.service';
import { PasswordService } from '../src/domain/password.service';
import { TokenService } from '../src/domain/token.service';
import { User, UserSchema } from '../src/persistence/schemas/user.schema';
import { Session, SessionSchema } from '../src/persistence/schemas/session.schema';
import { Profile, ProfileSchema } from '../src/persistence/schemas/profile.schema';
import {
  VerificationToken,
  VerificationTokenSchema,
} from '../src/persistence/schemas/verification-token.schema';

/**
 * Test cho luồng auth — chạy trên MongoDB replica set THẬT.
 *
 * Bắt buộc là replica set: AuthService ghi dữ liệu + outbox trong một
 * transaction, mà MongoDB chỉ cho transaction trên replica set. Test trên
 * standalone sẽ "xanh" vì chẳng có transaction nào chạy cả.
 */

let replSet: MongoMemoryReplSet;
let Users: Model<User>;
let Sessions: Model<Session>;
let Verifications: Model<VerificationToken>;
let Profiles: Model<Profile>;
let auth: AuthService;
let tokens: TokenService;
const published: { type: string; data: Record<string, unknown> }[] = [];

const CTX = { ip: '10.0.0.1', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' };

beforeAll(async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  process.env.JWT_PRIVATE_KEY = privateKey;
  process.env.JWT_PUBLIC_KEY = publicKey;
  process.env.ACCESS_TOKEN_TTL = '15m';

  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'test' });

  Users = mongoose.model<User>(User.name, UserSchema);
  Sessions = mongoose.model<Session>(Session.name, SessionSchema);
  Verifications = mongoose.model<VerificationToken>(
    VerificationToken.name,
    VerificationTokenSchema,
  );
  Profiles = mongoose.model<Profile>(Profile.name, ProfileSchema);
  await Promise.all([
    Users.createIndexes(),
    Sessions.createIndexes(),
    Verifications.createIndexes(),
  ]);

  // Outbox giả: chỉ ghi lại event được phát, nhưng VẪN mở transaction thật
  // để kiểm chứng rollback hoạt động đúng.
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

  tokens = new TokenService();
  auth = new AuthService(
    Users,
    Sessions,
    Profiles,
    Verifications,
    new PasswordService(),
    tokens,
    outbox as never,
  );
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

beforeEach(() => {
  published.length = 0;
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

const register = (email = 'an@example.com') =>
  auth.register({ email, password: 'Matkhau123', displayName: 'An Nguyen', ctx: CTX });

// ═══════════════════════════════════════════════════════════════
describe('Đăng ký', () => {
  it('tạo user, token xác thực và phát event trong một transaction', async () => {
    const res = await register();

    expect(res.user.email).toBe('an@example.com');
    expect(res.user.emailVerified).toBe(false);
    expect(await Users.countDocuments()).toBe(1);
    expect(await Verifications.countDocuments({ type: 'email_verify' })).toBe(1);

    const evt = published.find((e) => e.type === 'identity.user.registered');
    expect(evt).toBeTruthy();
    // Event phải TỰ CHỨA token thô — nếu không, notification-service
    // buộc phải gọi ngược về identity để dựng được link xác thực.
    expect(evt?.data.verificationToken).toEqual(expect.any(String));
  });

  it('không lưu mật khẩu dạng thô', async () => {
    await register();
    const user = await Users.findOne().lean();
    expect(user?.passwordHash).not.toContain('Matkhau123');
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('email trùng -> EMAIL_TAKEN', async () => {
    await register();
    await expect(register()).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    expect(await Users.countDocuments()).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Đăng nhập', () => {
  it('đúng mật khẩu -> trả token và phát event', async () => {
    await register();
    const res = await auth.login({ email: 'an@example.com', password: 'Matkhau123', ctx: CTX });

    expect(res.tokens.accessToken).toBeTruthy();
    expect(published.some((e) => e.type === 'identity.user.logged_in')).toBe(true);
  });

  it('sai mật khẩu và email không tồn tại trả CÙNG MỘT mã lỗi', async () => {
    await register();

    const wrongPassword = await auth
      .login({ email: 'an@example.com', password: 'SaiRoi123', ctx: CTX })
      .catch((e: { code: string }) => e.code);
    const noSuchEmail = await auth
      .login({ email: 'khong-co@example.com', password: 'SaiRoi123', ctx: CTX })
      .catch((e: { code: string }) => e.code);

    // Khác mã lỗi là để lộ email nào có thật trong hệ thống
    expect(wrongPassword).toBe('INVALID_CREDENTIALS');
    expect(noSuchEmail).toBe('INVALID_CREDENTIALS');
  });

  it('đánh dấu thiết bị mới ở lần đăng nhập đầu từ máy lạ', async () => {
    await register();
    published.length = 0;

    await auth.login({
      email: 'an@example.com',
      password: 'Matkhau123',
      ctx: { ip: '1.2.3.4', userAgent: 'Firefox/121 Linux' },
    });

    const evt = published.find((e) => e.type === 'identity.user.logged_in');
    expect(evt?.data.isNewDevice).toBe(true);
  });

  it('mỗi lần đăng nhập tạo một family MỚI', async () => {
    await register();
    await auth.login({ email: 'an@example.com', password: 'Matkhau123', ctx: CTX });

    const families = await Sessions.distinct('familyId');
    expect(families).toHaveLength(2); // 1 từ register + 1 từ login
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Refresh token — rotation và reuse detection', () => {
  it('refresh hợp lệ -> token mới, token cũ chuyển sang rotated', async () => {
    const { tokens: t1 } = await register();
    const { tokens: t2 } = await auth.refresh({ refreshToken: t1.refreshToken, ctx: CTX });

    expect(t2.refreshToken).not.toBe(t1.refreshToken);

    const old = await Sessions.findOne({ tokenHash: tokens.hashToken(t1.refreshToken) });
    expect(old?.status).toBe('rotated');
    expect(old?.nextTokenHash).toBe(tokens.hashToken(t2.refreshToken));
  });

  it('giữ nguyên familyId qua các lần rotate', async () => {
    const { tokens: t1 } = await register();
    const { tokens: t2 } = await auth.refresh({ refreshToken: t1.refreshToken, ctx: CTX });
    await auth.refresh({ refreshToken: t2.refreshToken, ctx: CTX });

    expect(await Sessions.distinct('familyId')).toHaveLength(1);
  });

  it('GRACE PERIOD: dùng lại token vừa rotate -> trả lại token cũ, KHÔNG thu hồi', async () => {
    const { tokens: t1 } = await register();
    await auth.refresh({ refreshToken: t1.refreshToken, ctx: CTX });

    // Nhiều tab cùng gọi refresh là chuyện bình thường, không phải tấn công
    const again = await auth.refresh({ refreshToken: t1.refreshToken, ctx: CTX });

    expect(again.tokens.accessToken).toBeTruthy();
    expect(await Sessions.countDocuments({ status: 'revoked' })).toBe(0);
    expect(published.some((e) => e.type === 'identity.security.alert')).toBe(false);
  });

  it('5 lần refresh SONG SONG cùng một token -> không thu hồi oan', async () => {
    const { tokens: t1 } = await register();

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => auth.refresh({ refreshToken: t1.refreshToken, ctx: CTX })),
    );

    // Đây là tình huống thật khi app mở nhiều tab và access token hết hạn
    // cùng lúc. Nếu thu hồi ở đây, người dùng bị đá ra mà không hiểu vì sao.
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThan(0);
    expect(await Sessions.countDocuments({ status: 'revoked' })).toBe(0);
  });

  it('REUSE: quá grace period mà dùng lại -> thu hồi TOÀN BỘ family + cảnh báo', async () => {
    const { tokens: t1 } = await register();
    const { tokens: t2 } = await auth.refresh({ refreshToken: t1.refreshToken, ctx: CTX });

    // Đẩy thời điểm rotate lùi về quá khứ để vượt grace period
    await Sessions.updateOne(
      { tokenHash: tokens.hashToken(t1.refreshToken) },
      { $set: { rotatedAt: new Date(Date.now() - 60_000) } },
    );

    await expect(auth.refresh({ refreshToken: t1.refreshToken, ctx: CTX })).rejects.toMatchObject({
      code: 'TOKEN_REUSE_DETECTED',
    });

    // Token t2 vốn hợp lệ, nhưng cả family bị thu hồi.
    // Nạn nhân bị phiền, nhưng kẻ tấn công mất quyền truy cập.
    await expect(auth.refresh({ refreshToken: t2.refreshToken, ctx: CTX })).rejects.toMatchObject({
      code: 'TOKEN_REUSE_DETECTED',
    });

    expect(await Sessions.countDocuments({ status: 'active' })).toBe(0);

    const alert = published.find((e) => e.type === 'identity.security.alert');
    expect(alert?.data.type).toBe('token_reuse_detected');
  });

  it('token lạ -> TOKEN_INVALID, không phải REUSE', async () => {
    await expect(auth.refresh({ refreshToken: 'token-bia-dat', ctx: CTX })).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
  });

  it('token hết hạn -> TOKEN_EXPIRED', async () => {
    const { tokens: t1 } = await register();
    await Sessions.updateOne(
      { tokenHash: tokens.hashToken(t1.refreshToken) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    await expect(auth.refresh({ refreshToken: t1.refreshToken, ctx: CTX })).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
  });

  it('KHÔNG lưu refresh token dạng thô trong database', async () => {
    const { tokens: t1 } = await register();
    const doc = await Sessions.findOne().lean();

    // Lộ database vẫn không chiếm được phiên của ai
    expect(doc?.tokenHash).not.toBe(t1.refreshToken);
    expect(doc?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Đăng xuất', () => {
  it('thu hồi cả family, không chỉ token hiện tại', async () => {
    const { tokens: t1 } = await register();
    const { tokens: t2 } = await auth.refresh({ refreshToken: t1.refreshToken, ctx: CTX });

    await auth.logout({ refreshToken: t2.refreshToken, allDevices: false });

    expect(await Sessions.countDocuments({ status: 'active' })).toBe(0);
  });

  it('allDevices thu hồi mọi phiên của user', async () => {
    const { user } = await register();
    await auth.login({ email: 'an@example.com', password: 'Matkhau123', ctx: CTX });
    await auth.login({ email: 'an@example.com', password: 'Matkhau123', ctx: CTX });

    const res = await auth.logout({ allDevices: true, userId: user.id });

    expect(res.revoked).toBe(3);
    expect(await Sessions.countDocuments({ status: 'active' })).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Xác thực email', () => {
  it('token hợp lệ -> đánh dấu đã xác thực và phát event', async () => {
    await register();
    const raw = published.find((e) => e.type === 'identity.user.registered')?.data
      .verificationToken as string;

    const res = await auth.verifyEmail({ token: raw });

    expect(res.user.emailVerified).toBe(true);
    expect(published.some((e) => e.type === 'identity.user.verified')).toBe(true);
  });

  it('dùng lại token đã xác thực -> TOKEN_CONSUMED', async () => {
    await register();
    const raw = published.find((e) => e.type === 'identity.user.registered')?.data
      .verificationToken as string;

    await auth.verifyEmail({ token: raw });
    await expect(auth.verifyEmail({ token: raw })).rejects.toMatchObject({
      code: 'TOKEN_CONSUMED',
    });
  });

  it('token hết hạn -> TOKEN_EXPIRED', async () => {
    await register();
    const raw = published.find((e) => e.type === 'identity.user.registered')?.data
      .verificationToken as string;

    await Verifications.updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    await expect(auth.verifyEmail({ token: raw })).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
  });
});
