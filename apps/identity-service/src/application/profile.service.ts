import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';
import {
  KID_MATURITY_LIMIT,
  MAX_PROFILES_PER_USER,
  type CreateProfileRequest,
  type DeleteProfileResponse,
  type ListProfilesResponse,
  type OkResponse,
  type ProfileResponse,
  type PublicProfile,
  type SelectProfileRequest,
  type SelectProfileResponse,
  type UpdateProfileRequest,
  type VerifyProfileResponse,
} from '@nekoflix/contracts';
import { AppError, OutboxService, getLogger } from '@nekoflix/service-kit';
import { Profile, type ProfileDocument } from '../persistence/schemas/profile.schema';
import { User } from '../persistence/schemas/user.schema';
import { Session } from '../persistence/schemas/session.schema';
import { PasswordService } from '../domain/password.service';
import { TokenService } from '../domain/token.service';

const DUPLICATE_KEY = 11000;

@Injectable()
export class ProfileService {
  constructor(
    @InjectModel(Profile.name) private readonly profiles: Model<Profile>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly outbox: OutboxService,
  ) {}

  async list(userId: string): Promise<ListProfilesResponse> {
    const docs = await this.profiles.find({ userId, deletedAt: null }).sort({ createdAt: 1 });
    return {
      items: docs.map(toPublicProfile),
      remaining: Math.max(0, MAX_PROFILES_PER_USER - docs.length),
    };
  }

  /**
   * Tạo profile, tối đa 5.
   *
   * Giới hạn này PHẢI chịu được race. Hai request đồng thời khi đang có 4
   * profile: nếu chỉ `count()` rồi `create()`, cả hai cùng đếm được 4, cả
   * hai cùng tạo -> thành 6.
   *
   * MongoDB dùng snapshot isolation: đọc không khoá nhau, và hai transaction
   * chèn hai document KHÁC NHAU thì không xung đột. Nên transaction một mình
   * không cứu được.
   *
   * Cách giải: trong cùng transaction, GHI vào document `user`. Hai
   * transaction đồng thời cùng ghi một document -> MongoDB phát hiện
   * WriteConflict -> một cái bị huỷ. Đếm vẫn dùng số thật, nên không bị
   * lệch như cách nuôi một biến đếm riêng.
   */
  async create(input: CreateProfileRequest): Promise<ProfileResponse> {
    const user = await this.users.findOne({ _id: input.userId, deletedAt: null }).lean();
    if (!user) throw AppError.notFound('Không tìm thấy tài khoản.');

    const pinHash = input.pin ? await this.passwords.hash(input.pin) : null;

    try {
      return await this.outbox.withTransaction(async (session) => {
        const count = await this.profiles.countDocuments(
          { userId: input.userId, deletedAt: null },
          { session },
        );
        if (count >= MAX_PROFILES_PER_USER) {
          throw new AppError(
            'PROFILE_LIMIT_REACHED',
            `Mỗi tài khoản chỉ được tạo tối đa ${MAX_PROFILES_PER_USER} hồ sơ.`,
          );
        }

        // Chạm vào user doc để hai transaction đồng thời xung đột với nhau
        await this.users.updateOne(
          { _id: input.userId },
          { $set: { profilesChangedAt: new Date() } },
          { session },
        );

        const [created] = await this.profiles.create(
          [
            {
              userId: input.userId,
              name: input.name,
              avatarKey: input.avatarKey,
              isKid: input.isKid,
              // Profile kids bị ÉP ở PG. Cho tự đặt thì kids mode vô nghĩa.
              maturityLimit: input.isKid ? KID_MATURITY_LIMIT : 'NC-17',
              language: input.language,
              pinHash,
            },
          ],
          { session },
        );
        if (!created) throw AppError.internal();

        await this.outbox.publish(
          'identity.profile.created',
          {
            profileId: created._id.toString(),
            userId: input.userId,
            name: created.name,
            isKid: created.isKid,
            createdAt: created.createdAt.toISOString(),
          },
          { session },
        );

        return { profile: toPublicProfile(created) };
      });
    } catch (err) {
      if (isDuplicateKey(err)) {
        throw new AppError('ALREADY_EXISTS', 'Tài khoản đã có hồ sơ trùng tên này.');
      }
      throw err;
    }
  }

  async update(input: UpdateProfileRequest): Promise<ProfileResponse> {
    const profile = await this.owned(input.userId, input.profileId);

    if (input.name !== undefined) profile.name = input.name;
    if (input.avatarKey !== undefined) profile.avatarKey = input.avatarKey;
    if (input.language !== undefined) profile.language = input.language;

    if (input.maturityLimit !== undefined) {
      if (profile.isKid) {
        throw new AppError('FORBIDDEN', 'Không thể đổi giới hạn độ tuổi của hồ sơ trẻ em.');
      }
      profile.maturityLimit = input.maturityLimit;
    }

    try {
      await profile.save();
    } catch (err) {
      if (isDuplicateKey(err)) {
        throw new AppError('ALREADY_EXISTS', 'Tài khoản đã có hồ sơ trùng tên này.');
      }
      throw err;
    }

    return { profile: toPublicProfile(profile) };
  }

  async remove(userId: string, profileId: string): Promise<DeleteProfileResponse> {
    const profile = await this.owned(userId, profileId);

    const remaining = await this.profiles.countDocuments({ userId, deletedAt: null });
    if (remaining <= 1) {
      // Không có profile nào thì không vào được app. Muốn xoá hẳn thì
      // phải xoá tài khoản, không phải xoá profile cuối cùng.
      throw new AppError('CONFLICT', 'Không thể xoá hồ sơ cuối cùng của tài khoản.');
    }

    return this.outbox.withTransaction(async (session) => {
      const deletedAt = new Date();
      profile.deletedAt = deletedAt;
      await profile.save({ session });

      // activity-service và reco-service nghe event này để dọn dữ liệu —
      // identity không đụng được vào database của chúng.
      await this.outbox.publish(
        'identity.profile.deleted',
        { profileId, userId, deletedAt: deletedAt.toISOString() },
        { session },
      );

      getLogger().info({ profileId, userId }, 'đã xoá hồ sơ');
      return { deleted: true };
    });
  }

  /**
   * Chọn profile -> cấp access token MỚI có claim `pid`.
   *
   * Không dùng lại token cũ rồi "gắn thêm" profileId ở đâu đó: profileId
   * phải nằm TRONG token đã ký, nếu không client tự sửa được và xem được
   * dữ liệu của profile khác.
   */
  async select(input: SelectProfileRequest): Promise<SelectProfileResponse> {
    const profile = await this.owned(input.userId, input.profileId);

    if (profile.pinHash) {
      if (!input.pin) {
        throw new AppError('PROFILE_PIN_REQUIRED', 'Hồ sơ này yêu cầu mã PIN.');
      }
      const ok = await this.passwords.verify(profile.pinHash, input.pin);
      if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Mã PIN không đúng.');
    }

    // Phiên phải còn sống. Thiếu bước này, token bị thu hồi vẫn đổi được
    // sang một access token mới hoàn toàn hợp lệ.
    const session = await this.sessions.findOne({ _id: input.sessionId, status: 'active' }).lean();
    if (!session || session.userId !== input.userId) {
      throw new AppError('TOKEN_INVALID', 'Phiên đăng nhập không còn hiệu lực.');
    }

    const user = await this.users.findById(input.userId).lean();
    if (!user || user.status !== 'active') {
      throw new AppError('FORBIDDEN', 'Tài khoản không còn hoạt động.');
    }

    return {
      profile: toPublicProfile(profile),
      accessToken: this.tokens.signAccessToken({
        sub: input.userId,
        sid: input.sessionId,
        pid: input.profileId,
        role: user.role,
        ev: user.emailVerifiedAt !== null,
      }),
      expiresIn: this.tokens.accessTtlSeconds,
    };
  }

  async setPin(userId: string, profileId: string, pin: string): Promise<OkResponse> {
    const profile = await this.owned(userId, profileId);
    profile.pinHash = await this.passwords.hash(pin);
    await profile.save();
    return { ok: true };
  }

  async removePin(userId: string, profileId: string, password: string): Promise<OkResponse> {
    const user = await this.users.findById(userId);
    // Gỡ PIN phải xác nhận mật khẩu tài khoản: nếu không, đứa trẻ mượn
    // được máy lúc đang mở là gỡ PIN của profile người lớn.
    const ok = await this.passwords.verify(user?.passwordHash ?? null, password);
    if (!user || !ok) throw new AppError('INVALID_CREDENTIALS', 'Mật khẩu không đúng.');

    const profile = await this.owned(userId, profileId);
    profile.pinHash = null;
    await profile.save();
    return { ok: true };
  }

  /** Service khác gọi để xác minh profileId có thuộc userId không */
  async verify(userId: string, profileId: string): Promise<VerifyProfileResponse> {
    const profile = await this.profiles
      .findOne({ _id: profileId, userId, deletedAt: null })
      .catch(() => null);
    return profile
      ? { valid: true, profile: toPublicProfile(profile) }
      : { valid: false, profile: null };
  }

  /**
   * Lấy profile và xác minh quyền sở hữu.
   *
   * Luôn đi qua hàm này, không bao giờ `findById(profileId)` trần: thiếu
   * điều kiện `userId` thì ai biết id là đổi được profile của người khác.
   */
  private async owned(userId: string, profileId: string): Promise<ProfileDocument> {
    const profile = await this.profiles
      .findOne({ _id: profileId, userId, deletedAt: null })
      .catch(() => null);
    if (!profile) throw AppError.notFound('Không tìm thấy hồ sơ.');
    return profile;
  }
}

export function toPublicProfile(p: ProfileDocument): PublicProfile {
  return {
    id: p._id.toString(),
    name: p.name,
    avatarKey: p.avatarKey,
    isKid: p.isKid,
    maturityLimit: p.maturityLimit,
    language: p.language,
    hasPin: p.pinHash !== null,
    createdAt: p.createdAt.toISOString(),
  };
}

function isDuplicateKey(err: unknown): boolean {
  if (err instanceof mongo.MongoServerError && err.code === DUPLICATE_KEY) return true;
  const code = (err as { code?: number } | null)?.code;
  return code === DUPLICATE_KEY;
}
