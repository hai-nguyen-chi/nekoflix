import { Injectable } from '@nestjs/common';
import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * Tham số theo khuyến nghị OWASP cho argon2id.
 *
 * memoryCost 19 MiB là con số PHẢI tính: mỗi lần đăng nhập chiếm ngần ấy
 * RAM trong chốc lát. 50 lượt đăng nhập đồng thời ≈ 1GB. Đó là lý do phải
 * rate-limit endpoint đăng nhập, không chỉ vì chống dò mật khẩu.
 */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hash của một chuỗi ngẫu nhiên, dùng khi email không tồn tại.
 *
 * Mục đích: chống USER ENUMERATION. Nếu email sai mà trả lời ngay lập tức
 * còn email đúng thì mất 80ms để verify, kẻ tấn công đo thời gian phản hồi
 * là biết email nào có thật trong hệ thống.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$YXJiaXRyYXJ5ZHVtbXloYXNodmFsdWVoZXJl';

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return hash(plain, OPTIONS);
  }

  /**
   * So khớp mật khẩu.
   *
   * LUÔN truyền hash giả khi user không tồn tại — đừng return sớm:
   *
   *   const ok = await passwords.verify(user?.passwordHash ?? null, input);
   *   if (!user || !ok) throw ...   // thời gian phản hồi như nhau
   */
  async verify(storedHash: string | null, plain: string): Promise<boolean> {
    try {
      return await verify(storedHash ?? DUMMY_HASH, plain, OPTIONS);
    } catch {
      // Hash hỏng hoặc sai định dạng — coi như không khớp, không ném lỗi ra
      return false;
    }
  }
}
