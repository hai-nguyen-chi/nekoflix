import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { type Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { generateKeyPairSync } from 'node:crypto';

import { AuthService } from '../src/application/auth.service';
import { OAuthService } from '../src/application/oauth.service';
import { PasswordResetService } from '../src/application/password.service';
import { PasswordService } from '../src/domain/password.service';
import { TokenService } from '../src/domain/token.service';
import { generatePkce } from '../src/domain/pkce';
import type { OAuthProfile, OAuthProviderAdapter } from '../src/domain/providers/provider.types';
import { User, UserSchema } from '../src/persistence/schemas/user.schema';
import { Session, SessionSchema } from '../src/persistence/schemas/session.schema';
import { Profile, ProfileSchema } from '../src/persistence/schemas/profile.schema';
import {
  VerificationToken,
  VerificationTokenSchema,
} from '../src/persistence/schemas/verification-token.schema';
import {
  OAuthExchangeCode,
  OAuthExchangeCodeSchema,
  OAuthState,
  OAuthStateSchema,
} from '../src/persistence/schemas/oauth-state.schema';

/**
 * Nhà cung cấp giả.
 *
 * Test KHÔNG gọi Google/GitHub thật: cần credential, cần mạng, và không
 * dựng được các tình huống cần kiểm (email chưa xác thực, đổi code lỗi).
 *
 * Phần được test ở đây là thứ dễ sai và nguy hiểm nhất: QUY TẮC LIÊN KẾT
 * TÀI KHOẢN. Phần gọi HTTP tới nhà cung cấp là code thẳng, ít rủi ro hơn.
 */
class FakeProvider implements OAuthProviderAdapter {
  readonly configured = true;
  profile: OAuthProfile = {
    providerUserId: 'g-123',
    email: 'an@example.com',
    emailVerified: true,
    displayName: 'An Google',
  };
  shouldFail = false;

  constructor(readonly name: 'google' | 'github') {}

  buildAuthorizeUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
    return `https://fake.${this.name}/auth?state=${state}&code_challenge=${codeChallenge}`;
  }

  exchange(): Promise<OAuthProfile> {
    if (this.shouldFail) return Promise.reject(new Error('nhà cung cấp lỗi'));
    return Promise.resolve(this.profile);
  }
}

let replSet: MongoMemoryReplSet;
let Users: Model<User>;
let States: Model<OAuthState>;
let Codes: Model<OAuthExchangeCode>;
let auth: AuthService;
let oauth: OAuthService;
let passwordReset: PasswordResetService;
let google: FakeProvider;
const published: { type: string; data: Record<string, unknown> }[] = [];

const CTX = { ip: '10.0.0.1', userAgent: 'Chrome/120 Windows' };

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
  const Sessions = mongoose.model<Session>(Session.name, SessionSchema);
  const Profiles = mongoose.model<Profile>(Profile.name, ProfileSchema);
  const Verifications = mongoose.model<VerificationToken>(
    VerificationToken.name,
    VerificationTokenSchema,
  );
  States = mongoose.model<OAuthState>(OAuthState.name, OAuthStateSchema);
  Codes = mongoose.model<OAuthExchangeCode>(OAuthExchangeCode.name, OAuthExchangeCodeSchema);
  await Promise.all([
    Users.createIndexes(),
    Sessions.createIndexes(),
    Profiles.createIndexes(),
    Verifications.createIndexes(),
    States.createIndexes(),
    Codes.createIndexes(),
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
  passwordReset = new PasswordResetService(
    Users,
    Sessions,
    Verifications,
    passwords,
    tokens,
    outbox as never,
  );
  google = new FakeProvider('google');
  oauth = new OAuthService(
    Users,
    Profiles,
    States,
    Codes,
    auth,
    outbox as never,
    google as never,
    new FakeProvider('github') as never,
  );
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

beforeEach(() => {
  published.length = 0;
  google.shouldFail = false;
  google.profile = {
    providerUserId: 'g-123',
    email: 'an@example.com',
    emailVerified: true,
    displayName: 'An Google',
  };
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

/** Chạy trọn luồng: start -> callback */
async function runOAuth() {
  const start = await oauth.start({ provider: 'google', redirectPath: '/browse' });
  return oauth.callback({ provider: 'google', code: 'auth-code', state: start.state, ctx: CTX });
}

// ═══════════════════════════════════════════════════════════════
describe('PKCE', () => {
  it('challenge là SHA-256 của verifier, không đảo ngược được', async () => {
    const { codeVerifier, codeChallenge } = generatePkce();
    const { createHash } = await import('node:crypto');

    expect(codeChallenge).toBe(createHash('sha256').update(codeVerifier).digest('base64url'));
    expect(codeChallenge).not.toBe(codeVerifier);
    // RFC 7636 yêu cầu verifier dài 43–128 ký tự
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
  });

  it('mỗi lần start sinh state và verifier KHÁC nhau', async () => {
    const a = await oauth.start({ provider: 'google', redirectPath: '/browse' });
    const b = await oauth.start({ provider: 'google', redirectPath: '/browse' });
    expect(a.state).not.toBe(b.state);

    const docs = await States.find().lean();
    expect(docs[0]?.codeVerifier).not.toBe(docs[1]?.codeVerifier);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('State — chống CSRF và chống dùng lại', () => {
  it('state dùng được ĐÚNG MỘT LẦN', async () => {
    const start = await oauth.start({ provider: 'google', redirectPath: '/browse' });
    await oauth.callback({ provider: 'google', code: 'c1', state: start.state, ctx: CTX });

    // Lần hai phải chết: findOneAndDelete đã xoá state ở lần đầu
    await expect(
      oauth.callback({ provider: 'google', code: 'c2', state: start.state, ctx: CTX }),
    ).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('state bịa đặt -> TOKEN_INVALID', async () => {
    await expect(
      oauth.callback({ provider: 'google', code: 'c', state: 'state-gia', ctx: CTX }),
    ).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('state của provider này không dùng cho provider kia', async () => {
    const start = await oauth.start({ provider: 'google', redirectPath: '/browse' });
    await expect(
      oauth.callback({ provider: 'github', code: 'c', state: start.state, ctx: CTX }),
    ).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('state hết hạn -> TOKEN_EXPIRED', async () => {
    const start = await oauth.start({ provider: 'google', redirectPath: '/browse' });
    await States.updateOne(
      { state: start.state },
      { $set: { expiresAt: new Date(Date.now() - 1) } },
    );

    await expect(
      oauth.callback({ provider: 'google', code: 'c', state: start.state, ctx: CTX }),
    ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Liên kết tài khoản — chống chiếm tài khoản', () => {
  it('email chưa có -> tạo tài khoản mới, đã xác thực sẵn', async () => {
    const res = await runOAuth();

    expect(res.isNewUser).toBe(true);
    const user = await Users.findOne({ email: 'an@example.com' }).lean();
    // Tin nhà cung cấp đã xác thực -> không bắt xác thực lại
    expect(user?.emailVerifiedAt).not.toBeNull();
    expect(user?.passwordHash).toBeNull();
    expect(user?.oauthAccounts).toHaveLength(1);
  });

  it('tài khoản mới qua OAuth cũng có profile mặc định', async () => {
    await runOAuth();
    expect(published.some((e) => e.type === 'identity.profile.created')).toBe(true);
  });

  it('email ĐÃ XÁC THỰC -> LIÊN KẾT vào tài khoản sẵn có', async () => {
    const reg = await auth.register({
      email: 'an@example.com',
      password: 'Matkhau123',
      displayName: 'An Local',
      ctx: CTX,
    });
    await Users.updateOne({ _id: reg.user.id }, { $set: { emailVerifiedAt: new Date() } });

    const res = await runOAuth();

    expect(res.isNewUser).toBe(false);
    expect(await Users.countDocuments()).toBe(1); // không tạo tài khoản thứ hai
    const user = await Users.findById(reg.user.id).lean();
    expect(user?.oauthAccounts).toHaveLength(1);
    expect(user?.passwordHash).not.toBeNull(); // mật khẩu cũ vẫn dùng được
  });

  it('email CHƯA XÁC THỰC -> TỪ CHỐI (chặn chiếm tài khoản)', async () => {
    // Kịch bản tấn công:
    //   1. Kẻ tấn công đăng ký bằng email của nạn nhân (không cần xác thực)
    //   2. Nạn nhân đăng nhập bằng Google với chính email đó
    //   3. Nếu hệ thống gộp, nạn nhân rơi vào tài khoản mà kẻ tấn công
    //      biết mật khẩu -> mất tài khoản
    await auth.register({
      email: 'an@example.com',
      password: 'MatkhauKeTanCong1',
      displayName: 'Ke Tan Cong',
      ctx: CTX,
    });

    await expect(runOAuth()).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });

    const user = await Users.findOne({ email: 'an@example.com' }).lean();
    expect(user?.oauthAccounts).toHaveLength(0);
  });

  it('email chưa xác thực từ phía NHÀ CUNG CẤP -> từ chối', async () => {
    google.profile = { ...google.profile, emailVerified: false };

    await expect(runOAuth()).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    expect(await Users.countDocuments()).toBe(0);
  });

  it('đăng nhập lại lần hai -> dùng lại tài khoản cũ, không tạo mới', async () => {
    await runOAuth();
    const second = await runOAuth();

    expect(second.isNewUser).toBe(false);
    expect(await Users.countDocuments()).toBe(1);
  });

  it('nhà cung cấp lỗi -> SERVICE_UNAVAILABLE, không tạo tài khoản dở dang', async () => {
    google.shouldFail = true;

    await expect(runOAuth()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(await Users.countDocuments()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Mã đổi — token không bao giờ nằm trong URL', () => {
  it('callback trả MÃ ĐỔI, không trả token', async () => {
    const res = await runOAuth();

    expect(res.exchangeCode).toEqual(expect.any(String));
    expect(JSON.stringify(res)).not.toContain('accessToken');
  });

  it('đổi mã -> nhận token và tạo phiên', async () => {
    const cb = await runOAuth();
    const res = await oauth.exchange({ code: cb.exchangeCode, ctx: CTX });

    expect(res.tokens.accessToken).toBeTruthy();
    expect(res.tokens.refreshToken).toBeTruthy();
    expect(res.user.email).toBe('an@example.com');
  });

  it('mã đổi dùng được ĐÚNG MỘT LẦN', async () => {
    const cb = await runOAuth();
    await oauth.exchange({ code: cb.exchangeCode, ctx: CTX });

    await expect(oauth.exchange({ code: cb.exchangeCode, ctx: CTX })).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
  });

  it('mã đổi hết hạn -> TOKEN_EXPIRED', async () => {
    const cb = await runOAuth();
    await Codes.updateOne(
      { code: cb.exchangeCode },
      { $set: { expiresAt: new Date(Date.now() - 1) } },
    );

    await expect(oauth.exchange({ code: cb.exchangeCode, ctx: CTX })).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Gỡ liên kết', () => {
  it('KHÔNG gỡ được liên kết cuối khi chưa có mật khẩu', async () => {
    const cb = await runOAuth();
    const { user } = await oauth.exchange({ code: cb.exchangeCode, ctx: CTX });

    // Gỡ nốt = mất hẳn đường vào tài khoản
    await expect(oauth.unlink(user.id, 'google')).rejects.toMatchObject({ code: 'CONFLICT' });

    const linked = await oauth.listLinked(user.id);
    expect(linked.canUnlink).toBe(false);
    expect(linked.hasPassword).toBe(false);
  });

  it('hasPassword phản ánh đúng việc tài khoản có mật khẩu hay không', async () => {
    // Giao diện dựa vào cờ này để quyết định hỏi hay KHÔNG hỏi mật khẩu
    // hiện tại. Trả sai thì tài khoản OAuth bị hỏi một thứ họ không có,
    // và không bao giờ đặt được mật khẩu.
    const cb = await runOAuth();
    const { user } = await oauth.exchange({ code: cb.exchangeCode, ctx: CTX });

    expect((await oauth.listLinked(user.id)).hasPassword).toBe(false);

    await passwordReset.change({
      userId: user.id,
      sessionId: 'khong-quan-trong',
      newPassword: 'MatkhauMoi123',
      ctx: CTX,
    });

    expect((await oauth.listLinked(user.id)).hasPassword).toBe(true);
  });

  it('gỡ được khi tài khoản đã có mật khẩu', async () => {
    const reg = await auth.register({
      email: 'an@example.com',
      password: 'Matkhau123',
      displayName: 'An',
      ctx: CTX,
    });
    await Users.updateOne({ _id: reg.user.id }, { $set: { emailVerifiedAt: new Date() } });
    await runOAuth();

    expect((await oauth.listLinked(reg.user.id)).canUnlink).toBe(true);
    await oauth.unlink(reg.user.id, 'google');
    expect((await oauth.listLinked(reg.user.id)).items).toHaveLength(0);
  });
});
