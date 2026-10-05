import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  getUserRequest,
  listSessionsRequest,
  loginRequest,
  logoutRequest,
  refreshRequest,
  registerRequest,
  verifyEmailRequest,
  type GetUserResponse,
  type ListSessionsResponse,
  type LoginResponse,
  type LogoutResponse,
  type RefreshResponse,
  type RegisterResponse,
  type VerifyEmailResponse,
} from '@nekoflix/contracts';
import { AppError, RpcData } from '@nekoflix/service-kit';
import { AuthService, toPublicUser } from '../application/auth.service';
import { User } from '../persistence/schemas/user.schema';
import { Session } from '../persistence/schemas/session.schema';

/**
 * Biên NATS của identity-service.
 *
 * CHỈ làm: parse payload theo hợp đồng -> gọi domain -> trả kết quả.
 * Không có một dòng logic nghiệp vụ nào ở đây — nó nằm ở AuthService.
 */
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
  ) {}

  @MessagePattern('identity.auth.register')
  register(@RpcData() raw: unknown): Promise<RegisterResponse> {
    return this.auth.register(registerRequest.parse(raw));
  }

  @MessagePattern('identity.auth.login')
  login(@RpcData() raw: unknown): Promise<LoginResponse> {
    return this.auth.login(loginRequest.parse(raw));
  }

  @MessagePattern('identity.auth.refresh')
  refresh(@RpcData() raw: unknown): Promise<RefreshResponse> {
    return this.auth.refresh(refreshRequest.parse(raw));
  }

  @MessagePattern('identity.auth.logout')
  logout(@RpcData() raw: unknown): Promise<LogoutResponse> {
    return this.auth.logout(logoutRequest.parse(raw));
  }

  @MessagePattern('identity.auth.verifyEmail')
  verifyEmail(@RpcData() raw: unknown): Promise<VerifyEmailResponse> {
    return this.auth.verifyEmail(verifyEmailRequest.parse(raw));
  }

  @MessagePattern('identity.user.get')
  async getUser(@RpcData() raw: unknown): Promise<GetUserResponse> {
    const { userId } = getUserRequest.parse(raw);
    const user = await this.users.findOne({ _id: userId, deletedAt: null });
    if (!user) throw AppError.notFound('Không tìm thấy tài khoản.');
    return { user: toPublicUser(user) };
  }

  @MessagePattern('identity.session.list')
  async listSessions(@RpcData() raw: unknown): Promise<ListSessionsResponse> {
    const { userId } = listSessionsRequest.parse(raw);

    // Chỉ hiện phiên còn sống. Phiên đã rotate là chi tiết kỹ thuật bên
    // trong, người dùng không cần (và không nên) thấy.
    const docs = await this.sessions
      .find({ userId, status: 'active' })
      .sort({ lastUsedAt: -1 })
      .limit(50)
      .lean();

    return {
      items: docs.map((d) => ({
        id: d._id.toString(),
        deviceLabel: d.deviceLabel,
        ip: d.ip,
        createdAt: new Date(d.createdAt).toISOString(),
        lastUsedAt: new Date(d.lastUsedAt).toISOString(),
        current: false, // gateway tự đánh dấu dựa vào sid trong access token
      })),
    };
  }
}
