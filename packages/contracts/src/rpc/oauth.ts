import { z } from 'zod';
import { publicUser } from './identity';
import { authContext, authTokens } from './identity';

export const oauthProvider = z.enum(['google', 'github']);
export type OAuthProvider = z.infer<typeof oauthProvider>;

// ── Bước 1: xin URL để chuyển hướng tới nhà cung cấp ─────────────
export const oauthStartRequest = z.object({
  provider: oauthProvider,
  /** Đường dẫn trong app để quay về sau khi đăng nhập xong */
  redirectPath: z.string().startsWith('/').max(200).default('/browse'),
});
export type OAuthStartRequest = z.infer<typeof oauthStartRequest>;

export const oauthStartResponse = z.object({
  authorizeUrl: z.string().url(),
  state: z.string(),
});
export type OAuthStartResponse = z.infer<typeof oauthStartResponse>;

// ── Bước 2: nhà cung cấp gọi lại ─────────────────────────────────
export const oauthCallbackRequest = z.object({
  provider: oauthProvider,
  code: z.string().min(1),
  state: z.string().min(1),
  ctx: authContext,
});
export type OAuthCallbackRequest = z.infer<typeof oauthCallbackRequest>;

/**
 * KHÔNG trả token ở đây.
 *
 * Trả về một mã đổi dùng một lần (TTL 60 giây). Nếu redirect thẳng về
 * frontend kèm access token trong URL, token sẽ bị ghi vào lịch sử trình
 * duyệt, header Referer, và log của mọi proxy trên đường đi.
 */
export const oauthCallbackResponse = z.object({
  exchangeCode: z.string(),
  redirectPath: z.string(),
  /** true = vừa tạo tài khoản mới, frontend có thể hiện onboarding */
  isNewUser: z.boolean(),
});
export type OAuthCallbackResponse = z.infer<typeof oauthCallbackResponse>;

// ── Bước 3: đổi mã lấy token ─────────────────────────────────────
export const oauthExchangeRequest = z.object({
  code: z.string().min(1),
  ctx: authContext,
});
export type OAuthExchangeRequest = z.infer<typeof oauthExchangeRequest>;

export const oauthExchangeResponse = z.object({
  user: publicUser,
  tokens: authTokens,
});
export type OAuthExchangeResponse = z.infer<typeof oauthExchangeResponse>;

// ── Quản lý liên kết ─────────────────────────────────────────────
export const linkedAccount = z.object({
  provider: oauthProvider,
  email: z.string(),
  linkedAt: z.string().datetime(),
});

export const listLinkedRequest = z.object({ userId: z.string() });
export const listLinkedResponse = z.object({
  items: z.array(linkedAccount),
  /** false khi gỡ nốt sẽ làm mất đường vào tài khoản */
  canUnlink: z.boolean(),
});
export type ListLinkedResponse = z.infer<typeof listLinkedResponse>;

export const unlinkRequest = z.object({
  userId: z.string(),
  provider: oauthProvider,
});
export const unlinkResponse = z.object({ unlinked: z.boolean() });
export type UnlinkResponse = z.infer<typeof unlinkResponse>;
