import { z } from 'zod';
import { authContext, emailSchema, passwordSchema, publicUser } from './identity';

// ── Quên mật khẩu ────────────────────────────────────────────────
export const forgotPasswordRequest = z.object({
  email: emailSchema,
  ctx: authContext,
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequest>;

/**
 * LUÔN trả `{ ok: true }`, kể cả khi email không tồn tại.
 *
 * Trả lỗi "email không tồn tại" biến endpoint này thành công cụ dò xem ai
 * có tài khoản trong hệ thống. Người dùng thật không mất gì: họ mở hộp thư
 * và thấy có/không có email.
 */
export const forgotPasswordResponse = z.object({ ok: z.literal(true) });
export type ForgotPasswordResponse = z.infer<typeof forgotPasswordResponse>;

// ── Đặt lại bằng token từ email ──────────────────────────────────
export const resetPasswordRequest = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
  ctx: authContext,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequest>;

export const resetPasswordResponse = z.object({ user: publicUser });
export type ResetPasswordResponse = z.infer<typeof resetPasswordResponse>;

// ── Đổi mật khẩu khi đang đăng nhập ──────────────────────────────
export const changePasswordRequest = z.object({
  userId: z.string(),
  /** Giữ lại phiên hiện tại, thu hồi các phiên còn lại */
  sessionId: z.string(),
  /**
   * Bắt buộc, kể cả khi đã đăng nhập.
   *
   * Thiếu nó, ai mượn được máy lúc đang mở là đổi mật khẩu và chiếm luôn
   * tài khoản. Tài khoản chỉ dùng OAuth (chưa có mật khẩu) thì bỏ trống.
   */
  currentPassword: z.string().max(128).optional(),
  newPassword: passwordSchema,
  ctx: authContext,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequest>;

export const changePasswordResponse = z.object({
  /** Số phiên khác đã bị thu hồi */
  revokedSessions: z.number().int().nonnegative(),
});
export type ChangePasswordResponse = z.infer<typeof changePasswordResponse>;
