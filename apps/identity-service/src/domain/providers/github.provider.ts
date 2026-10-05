import { Injectable } from '@nestjs/common';
import type { OAuthProvider } from '@nekoflix/contracts';
import { AppError } from '@nekoflix/service-kit';
import {
  callbackUrl,
  getJson,
  postForm,
  type OAuthProfile,
  type OAuthProviderAdapter,
} from './provider.types';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const EMAILS_URL = 'https://api.github.com/user/emails';

interface GitHubTokenResponse {
  access_token?: string;
  error_description?: string;
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

@Injectable()
export class GitHubProvider implements OAuthProviderAdapter {
  readonly name: OAuthProvider = 'github';
  private readonly clientId = process.env.GITHUB_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.GITHUB_CLIENT_SECRET ?? '';

  get configured(): boolean {
    return this.clientId !== '' && this.clientSecret !== '';
  }

  buildAuthorizeUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: callbackUrl('github'),
      scope: 'read:user user:email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
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
      redirect_uri: callbackUrl('github'),
    })) as GitHubTokenResponse;

    if (!token.access_token) {
      throw new AppError(
        'UNPROCESSABLE',
        `GitHub từ chối: ${token.error_description ?? 'không rõ lý do'}`,
      );
    }

    const headers = {
      Authorization: `Bearer ${token.access_token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'nekoflix',
    };

    const user = (await getJson(USER_URL, headers)) as GitHubUser;

    // GitHub KHÔNG trả email trong /user nếu người dùng để riêng tư.
    // Phải gọi riêng /user/emails và tự lọc — đây là khác biệt lớn so với
    // Google, nơi id_token đã có sẵn email đã xác thực.
    const emails = (await getJson(EMAILS_URL, headers)) as GitHubEmail[];
    const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);

    if (!primary) {
      throw new AppError(
        'UNPROCESSABLE',
        'Tài khoản GitHub chưa có email nào được xác thực. Vui lòng xác thực email trên GitHub trước.',
      );
    }

    return {
      providerUserId: String(user.id),
      email: primary.email.toLowerCase(),
      emailVerified: primary.verified,
      displayName: user.name?.trim() || user.login,
    };
  }
}
