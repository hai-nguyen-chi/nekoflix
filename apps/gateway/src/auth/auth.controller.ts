import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  loginRequest,
  registerRequest,
  verifyEmailRequest,
  type AuthTokens,
} from '@nekoflix/contracts';
import { AppError, RpcClient, zodPipe } from '@nekoflix/service-kit';
import { CurrentUser, Public, type AuthUser } from './jwt.guard';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from './cookies';

/** Lược bỏ refreshToken khỏi response — nó chỉ đi qua httpOnly cookie */
function publicTokens(tokens: AuthTokens) {
  return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
}

function authContext(req: Request) {
  return {
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '',
    userAgent: req.headers['user-agent'] ?? '',
  };
}

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly rpc: RpcClient) {}

  @Public()
  @Post('register')
  async register(
    @Body(zodPipe(registerRequest.omit({ ctx: true })))
    body: { email: string; password: string; displayName: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.rpc.request('identity.auth.register', {
      ...body,
      ctx: authContext(req),
    });
    setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
    return { data: { user, ...publicTokens(tokens) } };
  }

  @Public()
  @Post('login')
  async login(
    @Body(zodPipe(loginRequest.omit({ ctx: true }))) body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.rpc.request('identity.auth.login', {
      ...body,
      ctx: authContext(req),
    });
    setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
    return { data: { user, ...publicTokens(tokens) } };
  }

  /**
   * Không nhận body — refresh token đọc từ cookie.
   *
   * Chống CSRF: cookie dùng SameSite=Lax (form HTML cross-site không gửi
   * được), và `credentials` ở CORS chỉ mở cho WEB_ORIGIN.
   */
  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!raw) throw AppError.unauthenticated('Không có phiên đăng nhập.');

    try {
      const { tokens } = await this.rpc.request('identity.auth.refresh', {
        refreshToken: raw,
        ctx: authContext(req),
      });

      // Trong grace period, identity trả refreshToken rỗng -> giữ cookie cũ.
      // Đặt lại cookie rỗng sẽ xoá mất phiên của người dùng.
      if (tokens.refreshToken) {
        setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
      }
      return { data: publicTokens(tokens) };
    } catch (err) {
      // Token hỏng hoặc bị thu hồi -> xoá cookie, nếu không trình duyệt
      // sẽ gửi lại token chết đó mãi mãi.
      if (err instanceof AppError && err.httpStatus === 401) clearRefreshCookie(res);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const result = raw
      ? await this.rpc.request('identity.auth.logout', { refreshToken: raw, allDevices: false })
      : { revoked: 0 };
    clearRefreshCookie(res);
    return { data: result };
  }

  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const result = await this.rpc.request('identity.auth.logout', {
      allDevices: true,
      userId: user.userId,
    });
    clearRefreshCookie(res);
    return { data: result };
  }

  @Public()
  @Post('verify-email')
  async verifyEmail(@Body(zodPipe(verifyEmailRequest)) body: { token: string }) {
    const { user } = await this.rpc.request('identity.auth.verifyEmail', body);
    return { data: { user } };
  }

  @Get('me')
  async me(@CurrentUser() current: AuthUser) {
    const { user } = await this.rpc.request('identity.user.get', { userId: current.userId });
    return { data: { user, session: { id: current.sessionId, profileId: current.profileId } } };
  }

  @Get('sessions')
  async sessions(@CurrentUser() current: AuthUser) {
    const { items } = await this.rpc.request('identity.session.list', { userId: current.userId });
    return {
      data: {
        items: items.map((s) => ({ ...s, current: s.id === current.sessionId })),
      },
    };
  }
}
