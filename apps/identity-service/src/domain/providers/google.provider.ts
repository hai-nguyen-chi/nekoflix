import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { OAuthProvider } from '@nekoflix/contracts';
import { AppError } from '@nekoflix/service-kit';
import {
  callbackUrl,
  postForm,
  type OAuthProfile,
  type OAuthProviderAdapter,
} from './provider.types';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

interface GoogleTokenResponse {
  id_token?: string;
}

interface GoogleIdTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

@Injectable()
export class GoogleProvider implements OAuthProviderAdapter {
  readonly name: OAuthProvider = 'google';
  private readonly clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';

  /** Tải khoá công khai của Google, tự cache và tự làm mới */
  private readonly jwks = createRemoteJWKSet(new URL(JWKS_URL));

  get configured(): boolean {
    return this.clientId !== '' && this.clientSecret !== '';
  }

  buildAuthorizeUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: callbackUrl('google'),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      // Buộc chọn tài khoản — nếu không, máy dùng chung sẽ tự đăng nhập
      // bằng tài khoản Google của người trước
      prompt: 'select_account',
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async exchange({
    code,
    codeVerifier,
  }: {
    code: string;
    codeVerifier: string;
  }): Promise<OAuthProfile> {
    const token = (await postForm(TOKEN_URL, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl('google'),
    })) as GoogleTokenResponse;

    if (!token.id_token) {
      throw new AppError('UNPROCESSABLE', 'Google không trả về id_token.');
    }

    // XÁC MINH chữ ký, issuer và audience — không bao giờ chỉ decode.
    // id_token không verify thì ai cũng tự tạo được một cái và đăng nhập
    // thành bất kỳ ai.
    const { payload } = await jwtVerify(token.id_token, this.jwks, {
      issuer: ISSUERS,
      audience: this.clientId,
    });
    const claims = payload as unknown as GoogleIdTokenClaims;

    if (!claims.email) {
      throw new AppError('UNPROCESSABLE', 'Tài khoản Google không có email.');
    }

    return {
      providerUserId: claims.sub,
      email: claims.email.toLowerCase(),
      emailVerified: claims.email_verified === true,
      displayName: claims.name?.trim() || claims.email.split('@')[0] || 'Người dùng',
    };
  }
}
