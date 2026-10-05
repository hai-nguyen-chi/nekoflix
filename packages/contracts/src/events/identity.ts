import { z } from 'zod';

/**
 * Event do identity-service phát ra.
 *
 * Nguyên tắc: payload phải TỰ CHỨA ĐỦ dữ liệu để consumer làm việc của mình.
 * Chỉ gửi id thì notification-service buộc phải gọi ngược về identity để lấy
 * email — và nếu identity đang chết thì email không gửi được, dù event đã
 * nhận thành công.
 */

export const userRegisteredV1 = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
  /** Token xác thực email dạng THÔ — notification-service cần để dựng link */
  verificationToken: z.string(),
  verificationExpiresAt: z.string().datetime(),
  registeredAt: z.string().datetime(),
});
export type UserRegisteredV1 = z.infer<typeof userRegisteredV1>;

export const userVerifiedV1 = z.object({
  userId: z.string(),
  email: z.string(),
  verifiedAt: z.string().datetime(),
});
export type UserVerifiedV1 = z.infer<typeof userVerifiedV1>;

export const userLoggedInV1 = z.object({
  userId: z.string(),
  email: z.string(),
  deviceLabel: z.string(),
  ip: z.string(),
  /** true khi thiết bị này chưa từng đăng nhập -> gửi mail cảnh báo */
  isNewDevice: z.boolean(),
  loggedInAt: z.string().datetime(),
});
export type UserLoggedInV1 = z.infer<typeof userLoggedInV1>;

export const securityAlertType = z.enum([
  'token_reuse_detected',
  'password_changed',
  'all_sessions_revoked',
]);
export type SecurityAlertType = z.infer<typeof securityAlertType>;

/**
 * Sự kiện bảo mật — notification-service gửi email cảnh báo.
 *
 * `token_reuse_detected` là nghiêm trọng nhất: nó nghĩa là một refresh token
 * đã dùng rồi lại được dùng tiếp, tức nhiều khả năng token đã bị đánh cắp.
 */
export const securityAlertV1 = z.object({
  userId: z.string(),
  email: z.string(),
  type: securityAlertType,
  ip: z.string(),
  userAgent: z.string(),
  detail: z.string(),
  occurredAt: z.string().datetime(),
});
export type SecurityAlertV1 = z.infer<typeof securityAlertV1>;

export const profileCreatedV1 = z.object({
  profileId: z.string(),
  userId: z.string(),
  name: z.string(),
  isKid: z.boolean(),
  createdAt: z.string().datetime(),
});
export type ProfileCreatedV1 = z.infer<typeof profileCreatedV1>;

/**
 * Xoá profile.
 *
 * activity-service và reco-service NGHE event này để dọn dữ liệu của
 * profile đó (tiến độ xem, watchlist, vector sở thích). Chúng không thể
 * tự biết — identity không được đụng vào database của chúng (ADR-012).
 */
export const profileDeletedV1 = z.object({
  profileId: z.string(),
  userId: z.string(),
  deletedAt: z.string().datetime(),
});
export type ProfileDeletedV1 = z.infer<typeof profileDeletedV1>;

/**
 * Người dùng yêu cầu đặt lại mật khẩu.
 *
 * notification-service nghe event này để gửi email. Token THÔ đi trong
 * payload vì consumer cần nó để dựng link — event chỉ chạy trong mạng
 * nội bộ và token sống 1 giờ.
 */
export const passwordResetRequestedV1 = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
  resetToken: z.string(),
  expiresAt: z.string().datetime(),
  ip: z.string(),
  requestedAt: z.string().datetime(),
});
export type PasswordResetRequestedV1 = z.infer<typeof passwordResetRequestedV1>;
