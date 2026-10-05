import { z } from 'zod';

/** Tối đa 5 profile mỗi tài khoản — giống Netflix */
export const MAX_PROFILES_PER_USER = 5;

export const AVATAR_KEYS = [
  'avatar-01',
  'avatar-02',
  'avatar-03',
  'avatar-04',
  'avatar-05',
  'avatar-06',
  'avatar-07',
  'avatar-08',
  'avatar-09',
  'avatar-10',
  'avatar-11',
  'avatar-12',
] as const;
export const avatarKey = z.enum(AVATAR_KEYS);
export type AvatarKey = z.infer<typeof avatarKey>;

/**
 * Thang độ tuổi, xếp từ thấp đến cao.
 *
 * Thứ tự quan trọng: so sánh phải theo BẬC, không theo chuỗi. So sánh chuỗi
 * thì 'PG-13' < 'R' đúng ngẫu nhiên nhưng 'NC-17' < 'PG' sai — và sai kiểu
 * này nghĩa là trẻ em xem được phim người lớn.
 */
export const MATURITY_ORDER = ['G', 'PG', 'PG-13', 'R', 'NC-17'] as const;
export const maturityRating = z.enum(MATURITY_ORDER);
export type MaturityRating = z.infer<typeof maturityRating>;

export function maturityRank(rating: MaturityRating): number {
  return MATURITY_ORDER.indexOf(rating);
}

/** Profile kids bị ép giới hạn ở PG, không cho tự nâng */
export const KID_MATURITY_LIMIT: MaturityRating = 'PG';

export const profileLanguage = z.enum(['vi', 'en']);

export const publicProfile = z.object({
  id: z.string(),
  name: z.string(),
  avatarKey: z.string(),
  isKid: z.boolean(),
  maturityLimit: maturityRating,
  language: profileLanguage,
  /** KHÔNG trả về hash PIN — client chỉ cần biết có PIN hay không */
  hasPin: z.boolean(),
  createdAt: z.string().datetime(),
});
export type PublicProfile = z.infer<typeof publicProfile>;

const pinSchema = z.string().regex(/^\d{4}$/, 'PIN phải gồm đúng 4 chữ số');

// ── Danh sách ────────────────────────────────────────────────────
export const listProfilesRequest = z.object({ userId: z.string() });
export const listProfilesResponse = z.object({
  items: z.array(publicProfile),
  /** Còn tạo thêm được bao nhiêu profile nữa */
  remaining: z.number().int().nonnegative(),
});
export type ListProfilesResponse = z.infer<typeof listProfilesResponse>;

// ── Tạo ──────────────────────────────────────────────────────────
export const createProfileRequest = z.object({
  userId: z.string(),
  name: z.string().min(1, 'Tên không được để trống').max(20, 'Tên tối đa 20 ký tự').trim(),
  avatarKey: avatarKey.default('avatar-01'),
  isKid: z.boolean().default(false),
  language: profileLanguage.default('vi'),
  pin: pinSchema.optional(),
});
export type CreateProfileRequest = z.infer<typeof createProfileRequest>;

export const profileResponse = z.object({ profile: publicProfile });
export type ProfileResponse = z.infer<typeof profileResponse>;

// ── Sửa ──────────────────────────────────────────────────────────
export const updateProfileRequest = z.object({
  userId: z.string(),
  profileId: z.string(),
  name: z.string().min(1).max(20).trim().optional(),
  avatarKey: avatarKey.optional(),
  language: profileLanguage.optional(),
  /**
   * CHỈ áp dụng cho profile người lớn. Profile kids bị ép ở PG —
   * cho đổi thì tính năng kids mode trở nên vô nghĩa.
   */
  maturityLimit: maturityRating.optional(),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequest>;

// ── Xoá ──────────────────────────────────────────────────────────
export const deleteProfileRequest = z.object({
  userId: z.string(),
  profileId: z.string(),
});
export const deleteProfileResponse = z.object({ deleted: z.boolean() });
export type DeleteProfileResponse = z.infer<typeof deleteProfileResponse>;

// ── Chọn profile ─────────────────────────────────────────────────
export const selectProfileRequest = z.object({
  userId: z.string(),
  sessionId: z.string(),
  profileId: z.string(),
  pin: pinSchema.optional(),
});
export type SelectProfileRequest = z.infer<typeof selectProfileRequest>;

/** Trả access token MỚI, lần này có claim `pid` */
export const selectProfileResponse = z.object({
  profile: publicProfile,
  accessToken: z.string(),
  expiresIn: z.number().int(),
});
export type SelectProfileResponse = z.infer<typeof selectProfileResponse>;

// ── Quản lý PIN ──────────────────────────────────────────────────
export const setPinRequest = z.object({
  userId: z.string(),
  profileId: z.string(),
  pin: pinSchema,
});

export const removePinRequest = z.object({
  userId: z.string(),
  profileId: z.string(),
  /** Gỡ PIN phải xác nhận bằng mật khẩu tài khoản */
  password: z.string().min(1),
});

export const okResponse = z.object({ ok: z.boolean() });
export type OkResponse = z.infer<typeof okResponse>;

// ── Xác minh quyền sở hữu (service khác gọi) ─────────────────────
export const verifyProfileRequest = z.object({
  userId: z.string(),
  profileId: z.string(),
});
export const verifyProfileResponse = z.object({
  valid: z.boolean(),
  profile: publicProfile.nullable(),
});
export type VerifyProfileResponse = z.infer<typeof verifyProfileResponse>;
