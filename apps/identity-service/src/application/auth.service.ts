import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type ClientSession } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  AuthContext,
  AuthTokens,
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  LogoutResponse,
  PublicUser,
  RefreshRequest,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse,
  VerifyEmailRequest,
  VerifyEmailResponse,
} from '@nekoflix/contracts';
import { AppError, OutboxService, getLogger } from '@nekoflix/service-kit';
import { User, type UserDocument } from '../persistence/schemas/user.schema';
import { Session } from '../persistence/schemas/session.schema';
import { Profile } from '../persistence/schemas/profile.schema';
import { VerificationToken } from '../persistence/schemas/verification-token.schema';
import { PasswordService } from '../domain/password.service';
import { TokenService } from '../domain/token.service';
import { deviceFingerprint, deviceLabel } from '../domain/device';

/**
 * Cửa sổ ân hạn khi refresh token bị dùng lại.
 *
 * Nhiều tab cùng gọi refresh một lúc là chuyện BÌNH THƯỜNG, không phải tấn
 * công. Coi mọi lần dùng lại là đánh cắp thì người dùng bị đá ra oan mỗi
 * khi mở 3 tab. Trong 10 giây đầu, trả lại đúng cặp token đã sinh.
 */
const ROTATION_GRACE_MS = 10_000;

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_KNOWN_DEVICES = 20;

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    @InjectModel(Profile.name) private readonly profiles: Model<Profile>,
    @InjectModel(VerificationToken.name) private readonly verifications: Model<VerificationToken>,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly outbox: OutboxService,
  ) {}

  // ───────────────────────────────────────────────────────────────
  // ĐĂNG KÝ
  // ───────────────────────────────────────────────────────────────
  async register(input: RegisterRequest): Promise<RegisterResponse> {
    const existing = await this.users.findOne({ email: input.email }).lean();
    if (existing) {
      throw new AppError('EMAIL_TAKEN', 'Email này đã được sử dụng.');
    }

    const passwordHash = await this.passwords.hash(input.password);
    const rawVerifyToken = randomBytes(32).toString('base64url');
    const verifyExpiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

    return this.outbox.withTransaction(async (session) => {
      const [user] = await this.users.create(
        [
          {
            email: input.email,
            passwordHash,
            displayName: input.displayName,
            emailVerifiedAt: null,
            knownDevices: [deviceFingerprint(input.ctx.userAgent)],
          },
        ],
        { session },
      );
      if (!user) throw AppError.internal();

      await this.verifications.create(
        [
          {
            userId: user.id as string,
            type: 'email_verify',
            tokenHash: this.tokens.hashToken(rawVerifyToken),
            expiresAt: verifyExpiresAt,
          },
        ],
        { session },
      );

      // Profile mặc định, tạo CÙNG transaction với user.
      //
      // Không ai nên vào được app mà không có profile nào: mọi dữ liệu cá
      // nhân hoá (tiến độ xem, watchlist) gắn với profile, nên user không
      // profile là trạng thái cụt không làm được gì.
      const [profile] = await this.profiles.create(
        [
          {
            userId: user.id as string,
            name: input.displayName.slice(0, 20),
            avatarKey: 'avatar-01',
          },
        ],
        { session },
      );
      if (!profile) throw AppError.internal();

      const tokens = await this.issueNewFamily(user, input.ctx, session);

      await this.outbox.publish(
        'identity.profile.created',
        {
          profileId: profile._id.toString(),
          userId: user.id as string,
          name: profile.name,
          isKid: false,
          createdAt: profile.createdAt.toISOString(),
        },
        { session },
      );

      await this.outbox.publish(
        'identity.user.registered',
        {
          userId: user.id as string,
          email: user.email,
          displayName: user.displayName,
          // Token THÔ đi trong event: notification-service cần nó để dựng
          // link xác thực. Nó chỉ chạy trong mạng nội bộ và sống 24h.
          verificationToken: rawVerifyToken,
          verificationExpiresAt: verifyExpiresAt.toISOString(),
          registeredAt: user.createdAt.toISOString(),
        },
        { session },
      );

      getLogger().info({ userId: user.id }, 'đăng ký tài khoản mới');
      return { user: toPublicUser(user), tokens };
    });
  }

  // ───────────────────────────────────────────────────────────────
  // ĐĂNG NHẬP
  // ───────────────────────────────────────────────────────────────
  async login(input: LoginRequest): Promise<LoginResponse> {
    const user = await this.users.findOne({ email: input.email, deletedAt: null });

    // LUÔN chạy verify, kể cả khi user không tồn tại — PasswordService dùng
    // hash giả. Trả lời sớm sẽ để lộ email nào có thật qua thời gian phản hồi.
    const ok = await this.passwords.verify(user?.passwordHash ?? null, input.password);

    if (!user || !ok) {
      throw new AppError('INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
    }
    if (user.status !== 'active') {
      throw new AppError('FORBIDDEN', 'Tài khoản đã bị khoá.');
    }

    const fingerprint = deviceFingerprint(input.ctx.userAgent);
    const isNewDevice = !user.knownDevices.includes(fingerprint);

    return this.outbox.withTransaction(async (session) => {
      const tokens = await this.issueNewFamily(user, input.ctx, session);

      user.lastLoginAt = new Date();
      if (isNewDevice) {
        user.knownDevices = [fingerprint, ...user.knownDevices].slice(0, MAX_KNOWN_DEVICES);
      }
      await user.save({ session });

      await this.outbox.publish(
        'identity.user.logged_in',
        {
          userId: user.id as string,
          email: user.email,
          deviceLabel: deviceLabel(input.ctx.userAgent),
          ip: input.ctx.ip,
          isNewDevice,
          loggedInAt: new Date().toISOString(),
        },
        { session },
      );

      return { user: toPublicUser(user), tokens };
    });
  }

  // ───────────────────────────────────────────────────────────────
  // LÀM MỚI TOKEN — phần khó nhất của Phase 1
  // ───────────────────────────────────────────────────────────────
  async refresh(input: RefreshRequest): Promise<RefreshResponse> {
    const tokenHash = this.tokens.hashToken(input.refreshToken);
    const existing = await this.sessions.findOne({ tokenHash });

    if (!existing) {
      throw new AppError('TOKEN_INVALID', 'Phiên đăng nhập không hợp lệ.');
    }

    // ── Token đã bị rotate hoặc thu hồi ──────────────────────────
    if (existing.status !== 'active') {
      const withinGrace =
        existing.status === 'rotated' &&
        existing.rotatedAt !== null &&
        Date.now() - existing.rotatedAt.getTime() < ROTATION_GRACE_MS &&
        existing.nextTokenHash !== null &&
        existing.nextAccessToken !== null;

      if (withinGrace) {
        // Nhiều tab gọi refresh cùng lúc — trả lại ĐÚNG cặp token đã sinh.
        // Thao tác này idempotent: gọi 5 lần trong 10 giây đều ra kết quả
        // như nhau, và không tạo thêm session nào.
        const next = await this.sessions.findOne({ tokenHash: existing.nextTokenHash });
        if (next && next.status === 'active') {
          getLogger().debug({ userId: existing.userId }, 'refresh trong grace period');
          return {
            tokens: {
              accessToken: existing.nextAccessToken!,
              expiresIn: this.tokens.accessTtlSeconds,
              refreshToken: '', // gateway giữ nguyên cookie cũ
              refreshExpiresAt: next.expiresAt.toISOString(),
            },
          };
        }
      }

      await this.handleTokenReuse(existing.userId, existing.familyId, input.ctx);
      throw new AppError(
        'TOKEN_REUSE_DETECTED',
        'Phiên đăng nhập đã bị thu hồi vì lý do bảo mật. Vui lòng đăng nhập lại.',
      );
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new AppError('TOKEN_EXPIRED', 'Phiên đăng nhập đã hết hạn.');
    }

    const user = await this.users.findById(existing.userId);
    if (!user || user.status !== 'active' || user.deletedAt) {
      throw new AppError('TOKEN_INVALID', 'Tài khoản không còn hoạt động.');
    }

    // ── Rotate ───────────────────────────────────────────────────
    return this.outbox.withTransaction(async (session) => {
      const rawRefresh = this.tokens.generateRefreshToken();
      const newHash = this.tokens.hashToken(rawRefresh);
      const expiresAt = this.tokens.refreshExpiryDate();

      const [created] = await this.sessions.create(
        [
          {
            userId: existing.userId,
            familyId: existing.familyId, // GIỮ NGUYÊN family
            tokenHash: newHash,
            status: 'active',
            deviceLabel: existing.deviceLabel,
            ip: input.ctx.ip || existing.ip,
            expiresAt,
            lastUsedAt: new Date(),
          },
        ],
        { session },
      );
      if (!created) throw AppError.internal();

      const accessToken = this.tokens.signAccessToken({
        sub: user.id as string,
        sid: created._id.toString(),
        pid: null,
        role: user.role,
        ev: user.emailVerifiedAt !== null,
      });

      await this.sessions.updateOne(
        { _id: existing._id },
        {
          $set: {
            status: 'rotated',
            rotatedAt: new Date(),
            nextTokenHash: newHash,
            nextAccessToken: accessToken,
            lastUsedAt: new Date(),
          },
        },
        { session },
      );

      return {
        tokens: {
          accessToken,
          expiresIn: this.tokens.accessTtlSeconds,
          refreshToken: rawRefresh,
          refreshExpiresAt: expiresAt.toISOString(),
        },
      };
    });
  }

  /**
   * Refresh token đã dùng rồi lại được dùng tiếp => nhiều khả năng bị đánh cắp.
   *
   * Thu hồi TOÀN BỘ family, không chỉ token đó. Hệ quả: cả nạn nhân lẫn kẻ
   * tấn công đều phải đăng nhập lại. Nạn nhân bị phiền một chút, nhưng kẻ
   * tấn công mất quyền truy cập — đánh đổi chấp nhận được.
   */
  private async handleTokenReuse(
    userId: string,
    familyId: string,
    ctx: AuthContext,
  ): Promise<void> {
    const user = await this.users.findById(userId).lean();

    await this.outbox.withTransaction(async (session) => {
      const res = await this.sessions.updateMany(
        { familyId, status: { $ne: 'revoked' } },
        { $set: { status: 'revoked' } },
        { session },
      );

      if (user) {
        await this.outbox.publish(
          'identity.security.alert',
          {
            userId,
            email: user.email,
            type: 'token_reuse_detected',
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            detail: `Đã thu hồi ${res.modifiedCount} phiên trong cùng nhóm.`,
            occurredAt: new Date().toISOString(),
          },
          { session },
        );
      }

      getLogger().error(
        { userId, familyId, revoked: res.modifiedCount, ip: ctx.ip },
        'PHÁT HIỆN DÙNG LẠI REFRESH TOKEN — đã thu hồi toàn bộ family',
      );
    });
  }

  // ───────────────────────────────────────────────────────────────
  // ĐĂNG XUẤT
  // ───────────────────────────────────────────────────────────────
  async logout(input: LogoutRequest): Promise<LogoutResponse> {
    if (input.allDevices) {
      if (!input.userId) throw AppError.validation('Thiếu userId.');
      const res = await this.sessions.updateMany(
        { userId: input.userId, status: { $ne: 'revoked' } },
        { $set: { status: 'revoked' } },
      );
      return { revoked: res.modifiedCount };
    }

    if (!input.refreshToken) return { revoked: 0 };

    const tokenHash = this.tokens.hashToken(input.refreshToken);
    const doc = await this.sessions.findOne({ tokenHash });
    if (!doc) return { revoked: 0 };

    // Thu hồi cả family: đăng xuất một thiết bị thì mọi token sinh ra từ
    // lần đăng nhập đó đều phải chết, không chỉ token hiện tại.
    const res = await this.sessions.updateMany(
      { familyId: doc.familyId, status: { $ne: 'revoked' } },
      { $set: { status: 'revoked' } },
    );
    return { revoked: res.modifiedCount };
  }

  // ───────────────────────────────────────────────────────────────
  // XÁC THỰC EMAIL
  // ───────────────────────────────────────────────────────────────
  async verifyEmail(input: VerifyEmailRequest): Promise<VerifyEmailResponse> {
    const tokenHash = this.tokens.hashToken(input.token);
    const record = await this.verifications.findOne({ tokenHash, type: 'email_verify' });

    if (!record) throw new AppError('TOKEN_INVALID', 'Liên kết xác thực không hợp lệ.');
    if (record.consumedAt) {
      throw new AppError('TOKEN_CONSUMED', 'Liên kết này đã được sử dụng.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new AppError('TOKEN_EXPIRED', 'Liên kết xác thực đã hết hạn.');
    }

    const user = await this.users.findById(record.userId);
    if (!user) throw AppError.notFound('Không tìm thấy tài khoản.');

    return this.outbox.withTransaction(async (session) => {
      const verifiedAt = new Date();

      if (!user.emailVerifiedAt) {
        user.emailVerifiedAt = verifiedAt;
        await user.save({ session });

        await this.outbox.publish(
          'identity.user.verified',
          {
            userId: user.id as string,
            email: user.email,
            verifiedAt: verifiedAt.toISOString(),
          },
          { session },
        );
      }

      await this.verifications.updateOne(
        { _id: record._id },
        { $set: { consumedAt: verifiedAt } },
        { session },
      );

      return { user: toPublicUser(user) };
    });
  }

  /**
   * Cấp một phiên mới (dùng cho đăng nhập OAuth).
   *
   * Tự mở transaction vì OAuth gọi từ ngoài, không nằm sẵn trong một
   * transaction nào.
   */
  async issueSessionFor(user: UserDocument, ctx: AuthContext): Promise<AuthTokens> {
    return this.outbox.withTransaction(async (session) => {
      const tokens = await this.issueNewFamily(user, ctx, session);

      user.lastLoginAt = new Date();
      user.knownDevices = [
        deviceFingerprint(ctx.userAgent),
        ...user.knownDevices.filter((d) => d !== deviceFingerprint(ctx.userAgent)),
      ].slice(0, MAX_KNOWN_DEVICES);
      await user.save({ session });

      await this.outbox.publish(
        'identity.user.logged_in',
        {
          userId: user.id as string,
          email: user.email,
          deviceLabel: deviceLabel(ctx.userAgent),
          ip: ctx.ip,
          isNewDevice: false,
          loggedInAt: new Date().toISOString(),
        },
        { session },
      );

      return tokens;
    });
  }

  // ───────────────────────────────────────────────────────────────
  private async issueNewFamily(
    user: UserDocument,
    ctx: AuthContext,
    session: ClientSession,
  ): Promise<AuthTokens> {
    const rawRefresh = this.tokens.generateRefreshToken();
    const expiresAt = this.tokens.refreshExpiryDate();

    const [created] = await this.sessions.create(
      [
        {
          userId: user.id as string,
          familyId: randomUUID(), // family MỚI cho mỗi lần đăng nhập
          tokenHash: this.tokens.hashToken(rawRefresh),
          status: 'active',
          deviceLabel: deviceLabel(ctx.userAgent),
          ip: ctx.ip,
          expiresAt,
          lastUsedAt: new Date(),
        },
      ],
      { session },
    );
    if (!created) throw AppError.internal();

    return {
      accessToken: this.tokens.signAccessToken({
        sub: user.id as string,
        sid: created._id.toString(),
        pid: null,
        role: user.role,
        ev: user.emailVerifiedAt !== null,
      }),
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken: rawRefresh,
      refreshExpiresAt: expiresAt.toISOString(),
    };
  }
}

export function toPublicUser(user: UserDocument): PublicUser {
  return {
    id: user.id as string,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}
