import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type ClientSession } from 'mongoose';
import { randomBytes } from 'node:crypto';
import type {
  ListLinkedResponse,
  OAuthCallbackRequest,
  OAuthCallbackResponse,
  OAuthExchangeRequest,
  OAuthExchangeResponse,
  OAuthProvider,
  OAuthStartRequest,
  OAuthStartResponse,
  UnlinkResponse,
} from '@nekoflix/contracts';
import { AppError, OutboxService, getLogger } from '@nekoflix/service-kit';
import { User, type UserDocument } from '../persistence/schemas/user.schema';
import { Profile } from '../persistence/schemas/profile.schema';
import { OAuthExchangeCode, OAuthState } from '../persistence/schemas/oauth-state.schema';
import { generatePkce, generateState } from '../domain/pkce';
import type { OAuthProfile, OAuthProviderAdapter } from '../domain/providers/provider.types';
import { GoogleProvider } from '../domain/providers/google.provider';
import { GitHubProvider } from '../domain/providers/github.provider';
import { AuthService, toPublicUser } from './auth.service';

const STATE_TTL_MS = 10 * 60 * 1000;
const EXCHANGE_TTL_MS = 60 * 1000;

@Injectable()
export class OAuthService {
  private readonly providers: Map<OAuthProvider, OAuthProviderAdapter>;

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Profile.name) private readonly profiles: Model<Profile>,
    @InjectModel(OAuthState.name) private readonly states: Model<OAuthState>,
    @InjectModel(OAuthExchangeCode.name) private readonly codes: Model<OAuthExchangeCode>,
    private readonly auth: AuthService,
    private readonly outbox: OutboxService,
    google: GoogleProvider,
    github: GitHubProvider,
  ) {
    this.providers = new Map<OAuthProvider, OAuthProviderAdapter>([
      ['google', google],
      ['github', github],
    ]);
  }

  // ───────────────────────────────────────────────────────────────
  async start(input: OAuthStartRequest): Promise<OAuthStartResponse> {
    const provider = this.provider(input.provider);
    const state = generateState();
    const { codeVerifier, codeChallenge } = generatePkce();

    await this.states.create({
      state,
      provider: input.provider,
      codeVerifier,
      redirectPath: input.redirectPath,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    });

    return { authorizeUrl: provider.buildAuthorizeUrl({ state, codeChallenge }), state };
  }

  // ───────────────────────────────────────────────────────────────
  async callback(input: OAuthCallbackRequest): Promise<OAuthCallbackResponse> {
    const provider = this.provider(input.provider);

    // findOneAndDelete: đọc VÀ xoá nguyên tử. State dùng được đúng một lần.
    // Tách thành đọc-rồi-xoá sẽ để lọt request lặp qua khe hở giữa hai bước.
    const stored = await this.states.findOneAndDelete({
      state: input.state,
      provider: input.provider,
    });

    if (!stored) {
      throw new AppError(
        'TOKEN_INVALID',
        'Phiên đăng nhập OAuth không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.',
      );
    }
    if (stored.expiresAt.getTime() < Date.now()) {
      throw new AppError('TOKEN_EXPIRED', 'Phiên đăng nhập OAuth đã hết hạn.');
    }

    let profile: OAuthProfile;
    try {
      profile = await provider.exchange({
        code: input.code,
        codeVerifier: stored.codeVerifier,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      getLogger().error(
        { provider: input.provider, err: err instanceof Error ? err.message : String(err) },
        'đổi code OAuth thất bại',
      );
      throw AppError.unavailable('Không kết nối được tới nhà cung cấp. Vui lòng thử lại.');
    }

    // Chỉ chấp nhận email ĐÃ XÁC THỰC bởi nhà cung cấp.
    //
    // Thiếu điều kiện này, kẻ tấn công tạo một tài khoản Google với email
    // của nạn nhân (chưa xác thực) rồi đăng nhập vào tài khoản Nekoflix
    // của nạn nhân.
    if (!profile.emailVerified) {
      throw new AppError(
        'EMAIL_NOT_VERIFIED',
        `Email trên ${input.provider} chưa được xác thực. Vui lòng xác thực rồi thử lại.`,
      );
    }

    const { user, isNewUser } = await this.findOrLink(input.provider, profile);

    const code = randomBytes(32).toString('base64url');
    await this.codes.create({
      code,
      userId: user.id as string,
      isNewUser,
      expiresAt: new Date(Date.now() + EXCHANGE_TTL_MS),
    });

    return { exchangeCode: code, redirectPath: stored.redirectPath, isNewUser };
  }

  /**
   * Quy tắc liên kết tài khoản — chỗ dễ tạo lỗ hổng chiếm tài khoản nhất.
   *
   *   email chưa có trong hệ thống
   *     -> tạo user mới, coi như đã xác thực (tin nhà cung cấp)
   *
   *   email đã có VÀ đã xác thực
   *     -> LIÊN KẾT provider vào tài khoản đó
   *
   *   email đã có NHƯNG chưa xác thực
   *     -> TỪ CHỐI
   *
   * Nhánh cuối là bắt buộc. Thiếu nó: kẻ tấn công đăng ký trước bằng email
   * của nạn nhân (không cần xác thực được), rồi khi nạn nhân đăng nhập bằng
   * Google, hệ thống gộp họ vào tài khoản của kẻ tấn công — kẻ tấn công
   * biết mật khẩu và chiếm được tài khoản.
   */
  private async findOrLink(
    providerName: OAuthProvider,
    profile: OAuthProfile,
  ): Promise<{ user: UserDocument; isNewUser: boolean }> {
    // Đã liên kết trước đó -> đăng nhập thẳng
    const linked = await this.users.findOne({
      'oauthAccounts.provider': providerName,
      'oauthAccounts.providerUserId': profile.providerUserId,
      deletedAt: null,
    });
    if (linked) return { user: linked, isNewUser: false };

    const byEmail = await this.users.findOne({ email: profile.email, deletedAt: null });

    if (byEmail) {
      if (!byEmail.emailVerifiedAt) {
        throw new AppError(
          'EMAIL_NOT_VERIFIED',
          'Email này đã được đăng ký nhưng chưa xác thực. ' +
            'Vui lòng xác thực email bằng liên kết đã gửi trước khi liên kết tài khoản ' +
            `${providerName}.`,
        );
      }

      byEmail.oauthAccounts.push({
        provider: providerName,
        providerUserId: profile.providerUserId,
        email: profile.email,
        linkedAt: new Date(),
      });
      await byEmail.save();

      getLogger().info(
        { userId: byEmail.id, provider: providerName },
        'đã liên kết nhà cung cấp OAuth vào tài khoản sẵn có',
      );
      return { user: byEmail, isNewUser: false };
    }

    // Tài khoản mới hoàn toàn
    const user = await this.outbox.withTransaction(async (session) => {
      const [created] = await this.users.create(
        [
          {
            email: profile.email,
            // Không có mật khẩu: tài khoản này chỉ đăng nhập qua OAuth
            passwordHash: null,
            displayName: profile.displayName,
            // Nhà cung cấp đã xác thực email, không cần bắt xác thực lại
            emailVerifiedAt: new Date(),
            oauthAccounts: [
              {
                provider: providerName,
                providerUserId: profile.providerUserId,
                email: profile.email,
                linkedAt: new Date(),
              },
            ],
          },
        ],
        { session },
      );
      if (!created) throw AppError.internal();

      await this.createDefaultProfile(created, session);

      await this.outbox.publish(
        'identity.user.registered',
        {
          userId: created.id as string,
          email: created.email,
          displayName: created.displayName,
          // Không cần xác thực email -> không có token
          verificationToken: '',
          verificationExpiresAt: new Date().toISOString(),
          registeredAt: created.createdAt.toISOString(),
        },
        { session },
      );

      return created;
    });

    getLogger().info({ userId: user.id, provider: providerName }, 'tạo tài khoản mới qua OAuth');
    return { user, isNewUser: true };
  }

  private async createDefaultProfile(user: UserDocument, session: ClientSession): Promise<void> {
    const [profile] = await this.profiles.create(
      [
        {
          userId: user.id as string,
          name: user.displayName.slice(0, 20),
          avatarKey: 'avatar-01',
        },
      ],
      { session },
    );
    if (!profile) throw AppError.internal();

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
  }

  // ───────────────────────────────────────────────────────────────
  async exchange(input: OAuthExchangeRequest): Promise<OAuthExchangeResponse> {
    // Nguyên tử, dùng một lần — giống state
    const record = await this.codes.findOneAndDelete({ code: input.code });

    if (!record) {
      throw new AppError('TOKEN_INVALID', 'Mã đổi không hợp lệ hoặc đã được dùng.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new AppError('TOKEN_EXPIRED', 'Mã đổi đã hết hạn. Vui lòng đăng nhập lại.');
    }

    const user = await this.users.findById(record.userId);
    if (!user || user.status !== 'active') {
      throw new AppError('FORBIDDEN', 'Tài khoản không còn hoạt động.');
    }

    const tokens = await this.auth.issueSessionFor(user, input.ctx);
    return { user: toPublicUser(user), tokens };
  }

  // ───────────────────────────────────────────────────────────────
  async listLinked(userId: string): Promise<ListLinkedResponse> {
    const user = await this.users.findById(userId).lean();
    if (!user) throw AppError.notFound('Không tìm thấy tài khoản.');

    return {
      items: user.oauthAccounts.map((a) => ({
        provider: a.provider as OAuthProvider,
        email: a.email,
        linkedAt: a.linkedAt.toISOString(),
      })),
      // Gỡ nốt liên kết cuối khi không có mật khẩu = mất đường vào tài khoản
      canUnlink: user.passwordHash !== null || user.oauthAccounts.length > 1,
    };
  }

  async unlink(userId: string, provider: OAuthProvider): Promise<UnlinkResponse> {
    const user = await this.users.findById(userId);
    if (!user) throw AppError.notFound('Không tìm thấy tài khoản.');

    const has = user.oauthAccounts.some((a) => a.provider === provider);
    if (!has) throw AppError.notFound('Tài khoản chưa liên kết với nhà cung cấp này.');

    if (user.passwordHash === null && user.oauthAccounts.length <= 1) {
      throw new AppError(
        'CONFLICT',
        'Không thể gỡ liên kết cuối cùng khi tài khoản chưa đặt mật khẩu — ' +
          'bạn sẽ không còn cách nào đăng nhập.',
      );
    }

    user.oauthAccounts = user.oauthAccounts.filter((a) => a.provider !== provider);
    await user.save();
    return { unlinked: true };
  }

  // ───────────────────────────────────────────────────────────────
  private provider(name: OAuthProvider): OAuthProviderAdapter {
    const p = this.providers.get(name);
    if (!p) throw AppError.notFound(`Không hỗ trợ nhà cung cấp "${name}".`);
    if (!p.configured) {
      // Thông báo rõ thay vì để lỗi khó hiểu từ phía nhà cung cấp
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        `Đăng nhập bằng ${name} chưa được cấu hình. ` +
          `Thiếu ${name.toUpperCase()}_CLIENT_ID / ${name.toUpperCase()}_CLIENT_SECRET trong .env`,
      );
    }
    return p;
  }
}
