import type { OAuthProvider } from '@nekoflix/contracts';

/**
 * Thông tin tối thiểu lấy được từ nhà cung cấp OAuth.
 *
 * `emailVerified` là field QUAN TRỌNG NHẤT ở đây. Chỉ chấp nhận email đã
 * được nhà cung cấp xác thực — nếu không, kẻ tấn công đăng ký một tài khoản
 * Google với email của nạn nhân (chưa xác thực) rồi dùng nó chiếm tài khoản
 * Nekoflix của nạn nhân.
 */
export interface OAuthProfile {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
}

export interface OAuthProviderAdapter {
  readonly name: OAuthProvider;
  /** Đã cấu hình client id/secret chưa */
  readonly configured: boolean;

  /** URL để chuyển hướng người dùng tới */
  buildAuthorizeUrl(params: { state: string; codeChallenge: string }): string;

  /** Đổi `code` lấy thông tin người dùng */
  exchange(params: { code: string; codeVerifier: string }): Promise<OAuthProfile>;
}

/** Hết thời gian chờ nhà cung cấp — họ ở ngoài, không tin được là luôn nhanh */
export const PROVIDER_TIMEOUT_MS = 10_000;

export async function postForm(
  url: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Nhà cung cấp trả ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

export async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Nhà cung cấp trả ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

export function callbackUrl(provider: string): string {
  const base = process.env.OAUTH_CALLBACK_BASE ?? 'http://localhost:4000/v1/auth/oauth';
  return `${base}/${provider}/callback`;
}
