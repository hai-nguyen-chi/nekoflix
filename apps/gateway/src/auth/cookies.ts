import type { Response } from 'express';

export const REFRESH_COOKIE = 'nf_rt';

/**
 * Refresh token nằm trong httpOnly cookie, KHÔNG nằm trong body JSON.
 *
 * Lý do phân chia:
 *  - Access token  -> body JSON -> client giữ trong BIẾN (memory)
 *  - Refresh token -> httpOnly cookie -> JavaScript KHÔNG đọc được
 *
 * Nếu để access token vào localStorage, một lỗ XSS là mất token. Để trong
 * memory thì mất khi reload tab — nhưng refresh token trong cookie sẽ khôi
 * phục phiên tự động, và cookie httpOnly thì XSS không chạm tới được.
 */
export function setRefreshCookie(res: Response, token: string, expiresAt: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    // Path hẹp: cookie KHÔNG được gửi kèm mọi request API, chỉ gửi tới
    // các endpoint auth. Giảm bề mặt tấn công.
    path: '/v1/auth',
    expires: new Date(expiresAt),
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
}
