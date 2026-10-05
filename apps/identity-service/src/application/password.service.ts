import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes } from 'node:crypto';
import type {
  ChangePasswordRequest,
  ChangePasswordResponse,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
} from '@nekoflix/contracts';
import { AppError, OutboxService, getLogger } from '@nekoflix/service-kit';
import { User } from '../persistence/schemas/user.schema';
import { Session } from '../persistence/schemas/session.schema';
import { VerificationToken } from '../persistence/schemas/verification-token.schema';
import { PasswordService } from '../domain/password.service';
import { TokenService } from '../domain/token.service';
import { toPublicUser } from './auth.service';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 giờ

/**
 * Tối đa 3 yêu cầu đặt lại trong 1 giờ cho mỗi tài khoản.
 *
 * Giới hạn này đếm ngay trong `verificationTokens` thay vì dùng Redis:
 * dữ liệu cần đếm đã nằm sẵn ở đó, có TTL index tự dọn, và không phải
 * thêm một hạ tầng cho một con số.
 */
const MAX_RESETS_PER_HOUR = 3;

@Injectable()
export class PasswordResetService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    @InjectModel(VerificationToken.name) private readonly verifications: Model<VerificationToken>,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Yêu cầu đặt lại mật khẩu.
   *
   * LUÔN trả `{ ok: true }` — kể cả khi email không tồn tại, tài khoản bị
   * khoá, hay đã vượt giới hạn tần suất. Mọi nhánh thoát sớm đều im lặng.
   *
   * Phân biệt được các trường hợp này sẽ biến endpoint thành công cụ dò
   * danh sách người dùng.
   */
  async forgot(input: ForgotPasswordRequest): Promise<ForgotPasswordResponse> {
    const ok: ForgotPasswordResponse = { ok: true };

    const user = await this.users.findOne({ email: input.email, deletedAt: null });
    if (!user || user.status !== 'active') {
      getLogger().debug({ email: input.email }, 'quên mật khẩu cho email không tồn tại');
      return ok;
    }

    const recent = await this.verifications.countDocuments({
      userId: user.id as string,
      type: 'password_reset',
      createdAt: { $gt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    if (recent >= MAX_RESETS_PER_HOUR) {
      getLogger().warn({ userId: user.id }, 'vượt giới hạn yêu cầu đặt lại mật khẩu');
      return ok;
    }

    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await this.outbox.withTransaction(async (session) => {
      // Vô hiệu các token cũ: gửi yêu cầu mới thì link cũ phải chết, nếu
      // không một email cũ bị rò rỉ vẫn đặt lại được mật khẩu.
      await this.verifications.updateMany(
        { userId: user.id as string, type: 'password_reset', consumedAt: null },
        { $set: { consumedAt: new Date() } },
        { session },
      );

      await this.verifications.create(
        [
          {
            userId: user.id as string,
            type: 'password_reset',
            tokenHash: this.tokens.hashToken(rawToken),
            expiresAt,
          },
        ],
        { session },
      );

      await this.outbox.publish(
        'identity.password.reset_requested',
        {
          userId: user.id as string,
          email: user.email,
          displayName: user.displayName,
          resetToken: rawToken,
          expiresAt: expiresAt.toISOString(),
          ip: input.ctx.ip,
          requestedAt: new Date().toISOString(),
        },
        { session },
      );
    });

    getLogger().info({ userId: user.id }, 'đã tạo token đặt lại mật khẩu');
    return ok;
  }

  /**
   * Đặt lại mật khẩu bằng token từ email.
   *
   * Thu hồi TOÀN BỘ phiên, kể cả phiên đang gọi. Lý do: người dùng đặt lại
   * mật khẩu thường vì nghi tài khoản bị xâm nhập. Giữ lại phiên nào cũng
   * là giữ cho kẻ tấn công một đường vào.
   */
  async reset(input: ResetPasswordRequest): Promise<ResetPasswordResponse> {
    const tokenHash = this.tokens.hashToken(input.token);
    const record = await this.verifications.findOne({ tokenHash, type: 'password_reset' });

    if (!record) {
      throw new AppError('TOKEN_INVALID', 'Liên kết đặt lại mật khẩu không hợp lệ.');
    }
    if (record.consumedAt) {
      throw new AppError('TOKEN_CONSUMED', 'Liên kết này đã được sử dụng.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new AppError('TOKEN_EXPIRED', 'Liên kết đã hết hạn. Vui lòng yêu cầu lại.');
    }

    const user = await this.users.findById(record.userId);
    if (!user || user.status !== 'active') {
      throw new AppError('TOKEN_INVALID', 'Tài khoản không còn hoạt động.');
    }

    const newHash = await this.passwords.hash(input.newPassword);

    return this.outbox.withTransaction(async (session) => {
      user.passwordHash = newHash;
      // Đặt lại mật khẩu qua email cũng chứng minh người dùng sở hữu hộp
      // thư -> coi như đã xác thực email luôn.
      user.emailVerifiedAt ??= new Date();
      await user.save({ session });

      await this.verifications.updateOne(
        { _id: record._id },
        { $set: { consumedAt: new Date() } },
        { session },
      );

      const revoked = await this.sessions.updateMany(
        { userId: user.id as string, status: { $ne: 'revoked' } },
        { $set: { status: 'revoked' } },
        { session },
      );

      await this.outbox.publish(
        'identity.security.alert',
        {
          userId: user.id as string,
          email: user.email,
          type: 'password_changed',
          ip: input.ctx.ip,
          userAgent: input.ctx.userAgent,
          detail: `Mật khẩu đã được đặt lại qua email. Đã thu hồi ${revoked.modifiedCount} phiên đăng nhập.`,
          occurredAt: new Date().toISOString(),
        },
        { session },
      );

      getLogger().info(
        { userId: user.id, revoked: revoked.modifiedCount },
        'đặt lại mật khẩu thành công, đã thu hồi mọi phiên',
      );
      return { user: toPublicUser(user) };
    });
  }

  /**
   * Đổi mật khẩu khi đang đăng nhập.
   *
   * Khác `reset`: giữ lại phiên hiện tại. Người dùng chủ động đổi mật khẩu
   * không nên bị đá ra khỏi chính thiết bị họ đang dùng — nhưng mọi thiết
   * bị KHÁC thì phải đăng nhập lại.
   */
  async change(input: ChangePasswordRequest): Promise<ChangePasswordResponse> {
    const user = await this.users.findById(input.userId);
    if (!user || user.status !== 'active') {
      throw new AppError('FORBIDDEN', 'Tài khoản không còn hoạt động.');
    }

    if (user.passwordHash !== null) {
      // Bắt buộc xác nhận mật khẩu cũ, kể cả khi đã đăng nhập: thiếu bước
      // này, ai mượn được máy lúc đang mở là chiếm luôn tài khoản.
      const ok = await this.passwords.verify(user.passwordHash, input.currentPassword ?? '');
      if (!ok) {
        throw new AppError('INVALID_CREDENTIALS', 'Mật khẩu hiện tại không đúng.');
      }
      if (input.currentPassword === input.newPassword) {
        throw AppError.validation('Mật khẩu mới phải khác mật khẩu hiện tại.');
      }
    }
    // passwordHash === null: tài khoản chỉ dùng OAuth, đây là lần ĐẶT
    // mật khẩu đầu tiên nên không có mật khẩu cũ để xác nhận.

    const newHash = await this.passwords.hash(input.newPassword);

    return this.outbox.withTransaction(async (session) => {
      user.passwordHash = newHash;
      await user.save({ session });

      const revoked = await this.sessions.updateMany(
        {
          userId: user.id as string,
          status: { $ne: 'revoked' },
          // GIỮ phiên hiện tại — và cả family của nó, vì refresh token
          // xoay vòng tạo document mới trong cùng family.
          familyId: { $ne: await this.familyOf(input.sessionId) },
        },
        { $set: { status: 'revoked' } },
        { session },
      );

      await this.outbox.publish(
        'identity.security.alert',
        {
          userId: user.id as string,
          email: user.email,
          type: 'password_changed',
          ip: input.ctx.ip,
          userAgent: input.ctx.userAgent,
          detail: `Mật khẩu đã được đổi. Đã thu hồi ${revoked.modifiedCount} phiên trên thiết bị khác.`,
          occurredAt: new Date().toISOString(),
        },
        { session },
      );

      return { revokedSessions: revoked.modifiedCount };
    });
  }

  private async familyOf(sessionId: string): Promise<string> {
    const doc = await this.sessions
      .findById(sessionId)
      .select('familyId')
      .lean()
      .catch(() => null);
    // Chuỗi không khớp family nào -> thu hồi tất cả. An toàn hơn là giữ nhầm.
    return doc?.familyId ?? '__khong_co__';
  }
}
