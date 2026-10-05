import { z } from 'zod';

/** Dùng chung cho register và reset password */
export const passwordSchema = z
  .string()
  .min(8, 'Mật khẩu phải có ít nhất 8 ký tự')
  .max(128, 'Mật khẩu quá dài')
  .regex(/[a-zA-Z]/, 'Mật khẩu phải có ít nhất một chữ cái')
  .regex(/[0-9]/, 'Mật khẩu phải có ít nhất một chữ số');

export const emailSchema = z.string().email('Email không hợp lệ').toLowerCase().max(254);

export const userRole = z.enum(['user', 'moderator', 'admin']);
export type UserRole = z.infer<typeof userRole>;

export const publicUser = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: userRole,
  emailVerified: z.boolean(),
  createdAt: z.string().datetime(),
});
export type PublicUser = z.infer<typeof publicUser>;

/**
 * Thông tin thiết bị/kết nối đi kèm mọi thao tác auth.
 *
 * Gateway thu thập và truyền xuống — identity-service không tự đọc được
 * IP hay User-Agent vì nó ngồi sau NATS, không thấy request HTTP gốc.
 */
export const authContext = z.object({
  ip: z.string().default(''),
  userAgent: z.string().default(''),
});
export type AuthContext = z.infer<typeof authContext>;

// ── Đăng ký ──────────────────────────────────────────────────────
export const registerRequest = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().min(2, 'Tên quá ngắn').max(50).trim(),
  ctx: authContext,
});
export type RegisterRequest = z.infer<typeof registerRequest>;

/**
 * Refresh token trả về dạng THÔ, chỉ một lần.
 * Gateway nhận rồi đặt vào httpOnly cookie — client KHÔNG BAO GIỜ
 * thấy nó trong body JSON.
 */
export const authTokens = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  refreshToken: z.string(),
  refreshExpiresAt: z.string().datetime(),
});
export type AuthTokens = z.infer<typeof authTokens>;

export const registerResponse = z.object({
  user: publicUser,
  tokens: authTokens,
});
export type RegisterResponse = z.infer<typeof registerResponse>;

// ── Đăng nhập ────────────────────────────────────────────────────
export const loginRequest = z.object({
  email: emailSchema,
  // KHÔNG dùng passwordSchema ở đây: policy có thể siết sau này, và
  // người đăng ký từ trước vẫn phải đăng nhập được bằng mật khẩu cũ.
  password: z.string().min(1).max(128),
  ctx: authContext,
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const loginResponse = z.object({
  user: publicUser,
  tokens: authTokens,
});
export type LoginResponse = z.infer<typeof loginResponse>;

// ── Làm mới token ────────────────────────────────────────────────
export const refreshRequest = z.object({
  refreshToken: z.string().min(1),
  ctx: authContext,
});
export type RefreshRequest = z.infer<typeof refreshRequest>;

export const refreshResponse = z.object({ tokens: authTokens });
export type RefreshResponse = z.infer<typeof refreshResponse>;

// ── Đăng xuất ────────────────────────────────────────────────────
export const logoutRequest = z.object({
  refreshToken: z.string().optional(),
  /** true = thu hồi MỌI phiên của user, không chỉ phiên hiện tại */
  allDevices: z.boolean().default(false),
  userId: z.string().optional(),
});
export type LogoutRequest = z.infer<typeof logoutRequest>;

export const logoutResponse = z.object({ revoked: z.number().int() });
export type LogoutResponse = z.infer<typeof logoutResponse>;

// ── Thông tin tài khoản ──────────────────────────────────────────
export const getUserRequest = z.object({ userId: z.string() });
export type GetUserRequest = z.infer<typeof getUserRequest>;

export const getUserResponse = z.object({ user: publicUser });
export type GetUserResponse = z.infer<typeof getUserResponse>;

// ── Danh sách phiên đăng nhập ────────────────────────────────────
export const listSessionsRequest = z.object({ userId: z.string() });
export type ListSessionsRequest = z.infer<typeof listSessionsRequest>;

export const listSessionsResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      deviceLabel: z.string(),
      ip: z.string(),
      createdAt: z.string().datetime(),
      lastUsedAt: z.string().datetime(),
      current: z.boolean(),
    }),
  ),
});
export type ListSessionsResponse = z.infer<typeof listSessionsResponse>;

// ── Xác thực email ───────────────────────────────────────────────
export const verifyEmailRequest = z.object({ token: z.string().min(1) });
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequest>;

export const verifyEmailResponse = z.object({ user: publicUser });
export type VerifyEmailResponse = z.infer<typeof verifyEmailResponse>;
