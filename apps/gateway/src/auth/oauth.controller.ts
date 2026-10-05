import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  oauthExchangeRequest,
  oauthProvider,
  oauthStartRequest,
  type OAuthProvider,
} from '@nekoflix/contracts';
import { AppError, RpcClient, zodPipe } from '@nekoflix/service-kit';
import { CurrentUser, Public, type AuthUser } from './jwt.guard';
import { setRefreshCookie } from './cookies';

function webOrigin(): string {
  return (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(',')[0]!;
}

function authContext(req: Request) {
  return {
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '',
    userAgent: req.headers['user-agent'] ?? '',
  };
}

@Controller('v1/auth/oauth')
export class OAuthController {
  constructor(private readonly rpc: RpcClient) {}

  /**
   * Bước 1 — chuyển hướng tới nhà cung cấp.
   *
   * Dùng 302 chứ không trả JSON: trình duyệt phải tự đi tới Google/GitHub,
   * và `window.location = url` từ JS cũng được nhưng thừa một chặng.
   */
  @Public()
  @Get(':provider')
  async start(
    @Param('provider') provider: string,
    @Query('redirect') redirect: string | undefined,
    @Res() res: Response,
  ) {
    const parsed = oauthStartRequest.safeParse({
      provider,
      redirectPath: redirect ?? '/browse',
    });
    if (!parsed.success) {
      throw AppError.validation('Nhà cung cấp hoặc đường dẫn quay về không hợp lệ.');
    }

    const { authorizeUrl } = await this.rpc.request('identity.oauth.start', parsed.data);
    res.redirect(302, authorizeUrl);
  }

  /**
   * Bước 2 — nhà cung cấp gọi lại.
   *
   * Luôn redirect về frontend, KHÔNG trả JSON: trình duyệt đang đứng ở URL
   * này, người dùng phải thấy giao diện app chứ không phải một cục JSON.
   *
   * Và chỉ đưa `exchangeCode` lên URL, không bao giờ đưa token — URL bị ghi
   * vào lịch sử trình duyệt, Referer, và log của mọi proxy.
   */
  @Public()
  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') providerError: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const web = webOrigin();

    // Người dùng bấm "Huỷ" ở màn hình của Google/GitHub
    if (providerError) {
      return res.redirect(302, `${web}/login?error=oauth_cancelled`);
    }
    if (!code || !state || !oauthProvider.safeParse(provider).success) {
      return res.redirect(302, `${web}/login?error=oauth_invalid`);
    }

    try {
      const result = await this.rpc.request('identity.oauth.callback', {
        provider: provider as OAuthProvider,
        code,
        state,
        ctx: authContext(req),
      });

      const target = new URL(`${web}/oauth/callback`);
      target.searchParams.set('code', result.exchangeCode);
      target.searchParams.set('next', result.redirectPath);
      if (result.isNewUser) target.searchParams.set('new', '1');
      return res.redirect(302, target.toString());
    } catch (err) {
      // Trả mã lỗi qua query để frontend hiện thông báo tiếng Việt phù hợp
      const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
      return res.redirect(302, `${web}/login?error=${encodeURIComponent(code)}`);
    }
  }

  /** Bước 3 — frontend đổi mã lấy token qua POST */
  @Public()
  @Post('exchange')
  async exchange(
    @Body(zodPipe(oauthExchangeRequest.omit({ ctx: true }))) body: { code: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.rpc.request('identity.oauth.exchange', {
      code: body.code,
      ctx: authContext(req),
    });
    setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
    return {
      data: { user, accessToken: tokens.accessToken, expiresIn: tokens.expiresIn },
    };
  }

  @Get()
  async listLinked(@CurrentUser() user: AuthUser) {
    return { data: await this.rpc.request('identity.oauth.listLinked', { userId: user.userId }) };
  }

  @Delete(':provider')
  async unlink(@CurrentUser() user: AuthUser, @Param('provider') provider: string) {
    const parsed = oauthProvider.safeParse(provider);
    if (!parsed.success) throw AppError.notFound('Không hỗ trợ nhà cung cấp này.');

    return {
      data: await this.rpc.request('identity.oauth.unlink', {
        userId: user.userId,
        provider: parsed.data,
      }),
    };
  }
}
