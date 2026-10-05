import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { type Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { generateKeyPairSync } from 'node:crypto';
import { MAX_PROFILES_PER_USER } from '@nekoflix/contracts';

import { AuthService } from '../src/application/auth.service';
import { ProfileService } from '../src/application/profile.service';
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
let Profiles: Model<Profile>;
let auth: AuthService;
let profiles: ProfileService;
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
  profiles = new ProfileService(Profiles, Users, Sessions, passwords, tokens, outbox as never);
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
  const s = await Sessions.findOne({ userId }).lean();
  sessionId = s!._id.toString();
  published.length = 0;
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

// ═══════════════════════════════════════════════════════════════
describe('Tạo profile', () => {
  it('đăng ký tạo sẵn một profile mặc định', async () => {
    const res = await profiles.list(userId);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.name).toBe('An Nguyen');
    expect(res.remaining).toBe(MAX_PROFILES_PER_USER - 1);
  });

  it('profile kids bị ÉP giới hạn ở PG', async () => {
    const { profile } = await profiles.create({
      userId,
      name: 'Bé Na',
      avatarKey: 'avatar-03',
      isKid: true,
      language: 'vi',
    });

    expect(profile.isKid).toBe(true);
    expect(profile.maturityLimit).toBe('PG');
  });

  it('kids KHÔNG được tự nâng giới hạn tuổi', async () => {
    const { profile } = await profiles.create({
      userId,
      name: 'Bé Na',
      avatarKey: 'avatar-01',
      isKid: true,
      language: 'vi',
    });

    // Cho đổi thì kids mode trở nên vô nghĩa
    await expect(
      profiles.update({ userId, profileId: profile.id, maturityLimit: 'NC-17' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('trùng tên trong cùng tài khoản -> ALREADY_EXISTS', async () => {
    await expect(
      profiles.create({
        userId,
        name: 'An Nguyen',
        avatarKey: 'avatar-01',
        isKid: false,
        language: 'vi',
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  it('phát event profile.created', async () => {
    await profiles.create({
      userId,
      name: 'Hai',
      avatarKey: 'avatar-02',
      isKid: false,
      language: 'vi',
    });
    expect(published.some((e) => e.type === 'identity.profile.created')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Giới hạn 5 profile', () => {
  const makeName = (i: number) => `Profile ${i}`;

  it('tạo tới profile thứ 5 thì dừng', async () => {
    for (let i = 2; i <= MAX_PROFILES_PER_USER; i++) {
      await profiles.create({
        userId,
        name: makeName(i),
        avatarKey: 'avatar-01',
        isKid: false,
        language: 'vi',
      });
    }

    await expect(
      profiles.create({
        userId,
        name: 'Thừa',
        avatarKey: 'avatar-01',
        isKid: false,
        language: 'vi',
      }),
    ).rejects.toMatchObject({ code: 'PROFILE_LIMIT_REACHED' });

    expect(await Profiles.countDocuments({ userId, deletedAt: null })).toBe(MAX_PROFILES_PER_USER);
  });

  it('TẠO SONG SONG 10 cái -> vẫn chỉ đúng 5', async () => {
    // Bài test quan trọng nhất ở đây.
    //
    // MongoDB dùng snapshot isolation: hai transaction cùng đếm được 1 rồi
    // cùng chèn document KHÁC NHAU thì không xung đột. Transaction một mình
    // KHÔNG chặn được. Phải cùng ghi vào user doc để tạo WriteConflict.
    //
    // Test tuần tự luôn xanh và bỏ lọt lỗi này.
    await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        profiles.create({
          userId,
          name: makeName(i + 100),
          avatarKey: 'avatar-01',
          isKid: false,
          language: 'vi',
        }),
      ),
    );

    const count = await Profiles.countDocuments({ userId, deletedAt: null });
    expect(count).toBe(MAX_PROFILES_PER_USER);
  });

  it('xoá rồi tạo lại được', async () => {
    for (let i = 2; i <= MAX_PROFILES_PER_USER; i++) {
      await profiles.create({
        userId,
        name: makeName(i),
        avatarKey: 'avatar-01',
        isKid: false,
        language: 'vi',
      });
    }
    const list = await profiles.list(userId);
    await profiles.remove(userId, list.items[4]!.id);

    const after = await profiles.create({
      userId,
      name: 'Mới',
      avatarKey: 'avatar-01',
      isKid: false,
      language: 'vi',
    });
    expect(after.profile.name).toBe('Mới');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Xoá profile', () => {
  it('không cho xoá profile CUỐI CÙNG', async () => {
    const list = await profiles.list(userId);
    // Không còn profile nào thì không vào được app — trạng thái cụt
    await expect(profiles.remove(userId, list.items[0]!.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('phát event profile.deleted để service khác dọn dữ liệu', async () => {
    await profiles.create({
      userId,
      name: 'Tạm',
      avatarKey: 'avatar-01',
      isKid: false,
      language: 'vi',
    });
    const list = await profiles.list(userId);
    published.length = 0;

    await profiles.remove(userId, list.items[1]!.id);

    // activity-service và reco-service không đọc được DB của identity,
    // chúng chỉ biết qua event này
    expect(published.some((e) => e.type === 'identity.profile.deleted')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Chọn profile và PIN', () => {
  it('chọn profile -> access token mới có claim pid', async () => {
    const list = await profiles.list(userId);
    const res = await profiles.select({ userId, sessionId, profileId: list.items[0]!.id });

    const payload = JSON.parse(
      Buffer.from(res.accessToken.split('.')[1]!, 'base64url').toString(),
    ) as { pid: string; sub: string };

    expect(payload.pid).toBe(list.items[0]!.id);
    expect(payload.sub).toBe(userId);
  });

  it('profile có PIN: thiếu PIN -> PROFILE_PIN_REQUIRED', async () => {
    const list = await profiles.list(userId);
    const id = list.items[0]!.id;
    await profiles.setPin(userId, id, '1234');

    await expect(profiles.select({ userId, sessionId, profileId: id })).rejects.toMatchObject({
      code: 'PROFILE_PIN_REQUIRED',
    });
  });

  it('PIN sai -> INVALID_CREDENTIALS, PIN đúng -> qua', async () => {
    const list = await profiles.list(userId);
    const id = list.items[0]!.id;
    await profiles.setPin(userId, id, '1234');

    await expect(
      profiles.select({ userId, sessionId, profileId: id, pin: '9999' }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    const ok = await profiles.select({ userId, sessionId, profileId: id, pin: '1234' });
    expect(ok.accessToken).toBeTruthy();
  });

  it('KHÔNG lưu PIN dạng thô', async () => {
    const list = await profiles.list(userId);
    await profiles.setPin(userId, list.items[0]!.id, '1234');

    const doc = await Profiles.findById(list.items[0]!.id).lean();
    expect(doc?.pinHash).not.toBe('1234');
    expect(doc?.pinHash).toMatch(/^\$argon2id\$/);
  });

  it('gỡ PIN phải đúng mật khẩu tài khoản', async () => {
    const list = await profiles.list(userId);
    const id = list.items[0]!.id;
    await profiles.setPin(userId, id, '1234');

    // Nếu không, đứa trẻ mượn máy lúc đang mở là gỡ được PIN
    await expect(profiles.removePin(userId, id, 'SaiMatKhau')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });

    await profiles.removePin(userId, id, 'Matkhau123');
    expect((await profiles.list(userId)).items[0]?.hasPin).toBe(false);
  });

  it('phiên đã thu hồi -> không đổi được access token mới', async () => {
    const list = await profiles.list(userId);
    await Sessions.updateOne({ _id: sessionId }, { $set: { status: 'revoked' } });

    // Thiếu bước kiểm tra này, token bị thu hồi vẫn đổi được sang một
    // access token mới hoàn toàn hợp lệ.
    await expect(
      profiles.select({ userId, sessionId, profileId: list.items[0]!.id }),
    ).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Quyền sở hữu', () => {
  it('KHÔNG đọc/sửa được profile của tài khoản khác', async () => {
    const other = await auth.register({
      email: 'khac@example.com',
      password: 'Matkhau123',
      displayName: 'Nguoi Khac',
      ctx: CTX,
    });
    const otherList = await profiles.list(other.user.id);
    const victimId = otherList.items[0]!.id;

    await expect(
      profiles.update({ userId, profileId: victimId, name: 'Bị hack' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(profiles.remove(userId, victimId)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect((await profiles.verify(userId, victimId)).valid).toBe(false);
  });

  it('verify trả true cho profile của chính mình', async () => {
    const list = await profiles.list(userId);
    const res = await profiles.verify(userId, list.items[0]!.id);
    expect(res.valid).toBe(true);
    expect(res.profile?.name).toBe('An Nguyen');
  });
});
