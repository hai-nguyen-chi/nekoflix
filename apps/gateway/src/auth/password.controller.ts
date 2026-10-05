import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  changePasswordRequest,
  forgotPasswordRequest,
  resetPasswordRequest,
} from '@nekoflix/contracts';
import { RpcClient, zodPipe } from '@nekoflix/service-kit';
import { CurrentUser, Public, type AuthUser } from './jwt.guard';
import { clearRefreshCookie } from './cookies';

function authContext(req: Request) {
  return {
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '',
    userAgent: req.headers['user-agent'] ?? '',
  };
}

@Controller('v1/auth')
export class PasswordController {
  constructor(private readonly rpc: RpcClient) {}

  /**
   * LUÔN trả 200, kể cả khi email không tồn tại.
   *
   * Trả 404 ở đây biến endpoint thành công cụ dò xem ai có tài khoản.
   */
  @Public()
  @Post('forgot-password')
  async forgot(
    @Body(zodPipe(forgotPasswordRequest.omit({ ctx: true }))) body: { email: string },
    @Req() req: Request,
  ) {
    await this.rpc.request('identity.password.forgot', { ...body, ctx: authContext(req) });
    return {
      data: {
        ok: true,
        message: 'Nếu email tồn tại trong hệ thống, chúng tôi đã gửi liên kết đặt lại mật khẩu.',
      },
    };
  }

  @Public()
  @Post('reset-password')
  async reset(
    @Body(zodPipe(resetPasswordRequest.omit({ ctx: true })))
    body: { token: string; newPassword: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user } = await this.rpc.request('identity.password.reset', {
      ...body,
      ctx: authContext(req),
    });
    // Mọi phiên đã bị thu hồi -> cookie hiện tại vô dụng, xoá luôn
    clearRefreshCookie(res);
    return { data: { user, message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.' } };
  }

  @Post('change-password')
  async change(
    @CurrentUser() user: AuthUser,
    @Body(zodPipe(changePasswordRequest.omit({ ctx: true, userId: true, sessionId: true })))
    body: { currentPassword?: string; newPassword: string },
    @Req() req: Request,
  ) {
    return {
      data: await this.rpc.request('identity.password.change', {
        ...body,
        userId: user.userId,
        sessionId: user.sessionId,
        ctx: authContext(req),
      }),
    };
  }
}
