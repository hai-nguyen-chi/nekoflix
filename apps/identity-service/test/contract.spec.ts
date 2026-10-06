import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { type Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { generateKeyPairSync } from 'node:crypto';
import {
  ALL_EVENT_TYPES,
  EVENT_REGISTRY,
  isKnownEventType,
  parseEventData,
  type EventType,
} from '@nekoflix/contracts';

import { AuthService } from '../src/application/auth.service';
import { ProfileService } from '../src/application/profile.service';
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

/**
 * CONTRACT TEST — phía PRODUCER.
 *
 * Câu hỏi duy nhất ở đây: event identity-service thực sự phát ra có khớp
 * schema trong `@nekoflix/contracts` không. Không kiểm tra nghiệp vụ —
 * auth.spec, profile.spec, password.spec đã lo phần đó.
 *
 * Vì sao cần tách riêng: các test kia kiểm tra một vài field cụ thể của
 * event (`expect(evt.data.verificationToken).toEqual(...)`). Thiếu hẳn một
 * field, hoặc gửi `Date` thay vì chuỗi ISO, chúng vẫn xanh — còn consumer
 * ở service khác thì chết. Ở đây mọi event đều bị parse bằng chính schema
 * mà consumer dùng.
 *
 * notification-service KHÔNG chạy trong file này. Ràng buộc chung giữa hai
 * bên là schema, không phải một môi trường tích hợp.
 */

let replSet: MongoMemoryReplSet;
let Users: Model<User>;
let Sessions: Model<Session>;
let Profiles: Model<Profile>;
let auth: AuthService;
let profiles: ProfileService;
let reset: PasswordResetService;
let tokens: TokenService;

interface Published {
  type: string;
  data: Record<string, unknown>;
}

const published: Published[] = [];
/** Gom type của MỌI event trong cả file — không bị beforeEach xoá */
const seenTypes = new Set<string>();

const CTX = { ip: '203.0.113.42', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' };

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
  Profiles = mongoose.model<Profile>(Profile.name, ProfileSchema);
  const Verifications = mongoose.model<VerificationToken>(
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
      seenTypes.add(type);
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
  tokens = new TokenService();
  auth = new AuthService(
    Users,
    Sessions,
    Profiles,
    Verifications,
    passwords,
    tokens,
    outbox as never,
  );
  profiles = new ProfileService(Profiles, Users, Sessions, passwords, tokens, outbox as never);
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

beforeEach(() => {
  published.length = 0;
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

// ─────────────────────────────────────────────────────────────────
/**
 * Kiểm tra chung cho mọi event: đã đăng ký, parse được, và không mang
 * thứ không được phép ra khỏi service.
 */
function assertContract(events: Published[], expectedTypes: string[]): void {
  expect(events.map((e) => e.type).sort(), `event phát ra không khớp danh sách mong đợi`).toEqual(
    [...expectedTypes].sort(),
  );

  for (const e of events) {
    expect(isKnownEventType(e.type), `${e.type} chưa có trong EVENT_REGISTRY`).toBe(true);

    // parse ném ZodError kèm đường dẫn field sai — đó chính là thông báo
    // lỗi muốn thấy khi test đỏ.
    expect(() => parseEventData(e.type as EventType, e.data), e.type).not.toThrow();

    assertSerialisable(e);
  }
}

/**
 * Payload phải là JSON thuần.
 *
 * `Date`, `ObjectId`, `undefined` đi qua `JSON.stringify` sẽ biến dạng
 * (ObjectId -> chuỗi, undefined -> mất field) rồi mới tới consumer. Zod
 * parse ở đây lại thấy nguyên bản nên không bắt được — phải kiểm riêng.
 */
function assertSerialisable(event: Published): void {
  const roundTripped: unknown = JSON.parse(JSON.stringify(event.data));
  expect(roundTripped, `${event.type}: payload đổi hình dạng sau khi qua JSON`).toEqual(event.data);
}

const register = (email = 'an.nguyen@example.com') =>
  auth.register({ email, password: 'Matkhau123', displayName: 'An Nguyễn', ctx: CTX });

// ═══════════════════════════════════════════════════════════════
describe('Event phát ra từ luồng đăng ký', () => {
  it('register -> user.registered + profile.created, cả hai khớp hợp đồng', async () => {
    await register();

    assertContract(published, ['identity.user.registered', 'identity.profile.created']);

    const registered = published.find((e) => e.type === 'identity.user.registered')!;
    // Consumer dựng link xác thực từ field này. Thiếu nó, email gửi đi
    // vẫn "thành công" nhưng không ai bấm được.
    expect(registered.data.verificationToken).toEqual(expect.any(String));
    expect(String(registered.data.verificationToken).length).toBeGreaterThan(16);
  });

  it('verifyEmail -> user.verified khớp hợp đồng', async () => {
    await register();

    // Database chỉ lưu HASH của token. Token thô chỉ tồn tại ở một nơi:
    // trong event — đúng như consumer nhận được.
    const raw = published.find((e) => e.type === 'identity.user.registered')!.data
      .verificationToken as string;
    published.length = 0;

    await auth.verifyEmail({ token: raw });

    assertContract(published, ['identity.user.verified']);
  });
});

describe('Event phát ra từ luồng đăng nhập', () => {
  it('đăng nhập thiết bị mới -> user.logged_in khớp hợp đồng', async () => {
    await register();
    published.length = 0;

    await auth.login({
      email: 'an.nguyen@example.com',
      password: 'Matkhau123',
      ctx: { ip: '198.51.100.7', userAgent: 'Safari/17 macOS' },
    });

    assertContract(published, ['identity.user.logged_in']);
    expect(published[0]!.data.isNewDevice).toBe(true);
  });

  it('dùng lại refresh token -> security.alert khớp hợp đồng', async () => {
    const { tokens: t1 } = await register();
    await auth.refresh({ refreshToken: t1.refreshToken, ctx: CTX });

    await Sessions.updateOne(
      { tokenHash: tokens.hashToken(t1.refreshToken) },
      { $set: { rotatedAt: new Date(Date.now() - 60_000) } },
    );
    published.length = 0;

    await expect(auth.refresh({ refreshToken: t1.refreshToken, ctx: CTX })).rejects.toMatchObject({
      code: 'TOKEN_REUSE_DETECTED',
    });

    assertContract(published, ['identity.security.alert']);
    // `type` là enum trong hợp đồng — gõ sai chuỗi ở producer thì consumer
    // chọn nhầm template và gửi email vô nghĩa.
    expect(published[0]!.data.type).toBe('token_reuse_detected');
  });
});

describe('Event phát ra từ luồng hồ sơ', () => {
  it('tạo và xoá hồ sơ -> profile.created / profile.deleted khớp hợp đồng', async () => {
    const { user } = await register();
    published.length = 0;

    const created = await profiles.create({
      userId: user.id,
      name: 'Bé Na',
      avatarKey: 'avatar-03',
      isKid: true,
      language: 'vi',
    });
    assertContract(published, ['identity.profile.created']);

    published.length = 0;
    await profiles.remove(user.id, created.profile.id);

    // activity-service và reco-service nghe event này để dọn dữ liệu của
    // profile. Sai hợp đồng ở đây = dữ liệu cá nhân còn lại sau khi xoá.
    assertContract(published, ['identity.profile.deleted']);
    expect(published[0]!.data.profileId).toBe(created.profile.id);
  });
});

describe('Event phát ra từ luồng mật khẩu', () => {
  it('quên mật khẩu -> password.reset_requested khớp hợp đồng', async () => {
    await register();
    published.length = 0;

    await reset.forgot({ email: 'an.nguyen@example.com', ctx: CTX });

    assertContract(published, ['identity.password.reset_requested']);
    expect(published[0]!.data.resetToken).toEqual(expect.any(String));
  });

  it('email không tồn tại -> KHÔNG phát event nào', async () => {
    await reset.forgot({ email: 'khong-ai@example.com', ctx: CTX });

    // Phát event ở đây là rò rỉ: ai quan sát được NATS sẽ biết email nào
    // có thật, đúng thứ mà phản hồi "luôn ok" đang cố giấu.
    expect(published).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Độ phủ hợp đồng', () => {
  // Chạy sau cùng, dựa trên `seenTypes` tích luỹ qua cả file. Chạy riêng
  // một test lẻ (`-t`) sẽ làm test này đỏ — đó là đánh đổi có chủ ý.
  it('mọi event trong EVENT_REGISTRY đều được một luồng thật phát ra', () => {
    const owned = ALL_EVENT_TYPES.filter((t) => t.startsWith('identity.'));
    const missing = owned.filter((t) => !seenTypes.has(t));

    // Event đăng ký mà không ai phát là hợp đồng chết: nó không được test,
    // không được dùng, nhưng vẫn khiến người đọc tin rằng nó tồn tại.
    expect(missing, `event đã đăng ký nhưng không luồng nào phát: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('không phát event nào ngoài registry', () => {
    const unknown = [...seenTypes].filter((t) => !isKnownEventType(t));
    expect(unknown, `event phát ra nhưng chưa đăng ký: ${unknown.join(', ')}`).toEqual([]);
  });

  it('version trong registry khớp version service đang dùng', () => {
    // Service hiện phát tất cả ở v1. Khi nâng lên v2, dòng này buộc phải
    // sửa — và đó là lúc nhớ ra consumer cũ vẫn đang đọc v1.
    for (const type of ALL_EVENT_TYPES) {
      expect(EVENT_REGISTRY[type].version, type).toBe(1);
    }
  });
});
