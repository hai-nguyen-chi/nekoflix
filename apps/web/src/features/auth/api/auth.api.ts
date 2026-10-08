import type { PublicUser } from '@nekoflix/contracts';
import { api } from '@/shared/api/client';

export interface AuthPayload {
  user: PublicUser;
  accessToken: string;
  expiresIn: number;
}

export const authApi = {
  register: (body: { email: string; password: string; displayName: string }) =>
    api.post<AuthPayload>('/v1/auth/register', body, { skipAuth: true }),

  login: (body: { email: string; password: string }) =>
    api.post<AuthPayload>('/v1/auth/login', body, { skipAuth: true }),

  logout: () => api.post<{ revoked: number }>('/v1/auth/logout', undefined, { skipAuth: true }),

  /**
   * `skipAuth` KHÔNG dùng ở đây, khác với `logout`.
   *
   * Đăng xuất một thiết bị chỉ cần cookie refresh. Thu hồi mọi thiết bị thì
   * phải chứng minh đúng là chủ tài khoản — gateway lấy `userId` từ access
   * token đã ký, không bao giờ từ body.
   */
  logoutAll: () => api.post<{ revoked: number }>('/v1/auth/logout-all'),

  verifyEmail: (token: string) =>
    api.post<{ user: PublicUser }>('/v1/auth/verify-email', { token }, { skipAuth: true }),

  forgotPassword: (email: string) =>
    api.post<{ ok: true; message: string }>(
      '/v1/auth/forgot-password',
      { email },
      { skipAuth: true },
    ),

  resetPassword: (body: { token: string; newPassword: string }) =>
    api.post<{ user: PublicUser; message: string }>('/v1/auth/reset-password', body, {
      skipAuth: true,
    }),

  changePassword: (body: { currentPassword?: string; newPassword: string }) =>
    api.post<{ revokedSessions: number }>('/v1/auth/change-password', body),

  me: () =>
    api.get<{ user: PublicUser; session: { id: string; profileId: string | null } }>('/v1/auth/me'),

  sessions: () =>
    api.get<{
      items: {
        id: string;
        deviceLabel: string;
        ip: string;
        createdAt: string;
        lastUsedAt: string;
        current: boolean;
      }[];
    }>('/v1/auth/sessions'),

  exchangeOAuth: (code: string) =>
    api.post<AuthPayload>('/v1/auth/oauth/exchange', { code }, { skipAuth: true }),
};
