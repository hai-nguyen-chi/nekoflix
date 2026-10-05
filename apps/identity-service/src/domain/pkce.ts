import { createHash, randomBytes } from 'node:crypto';

/**
 * PKCE — Proof Key for Code Exchange (RFC 7636).
 *
 * Vấn đề nó giải: `code` mà nhà cung cấp trả về đi qua URL redirect của
 * trình duyệt. Nó nằm trong lịch sử duyệt web, header Referer, log proxy.
 * Ai lấy được `code` đó mà biết client_secret là đổi được thành token.
 *
 * PKCE thêm một bí mật dùng một lần:
 *   1. Ta sinh `code_verifier` ngẫu nhiên, GIỮ LẠI phía server
 *   2. Gửi đi `code_challenge` = SHA256(verifier) — không thể đảo ngược
 *   3. Khi đổi code lấy token, gửi kèm `verifier`
 *   4. Nhà cung cấp tự tính SHA256(verifier) và so với challenge đã nhận
 *
 * Kẻ chặn được `code` không có `verifier`, nên không đổi được.
 */
export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export function generatePkce(): PkcePair {
  // RFC 7636 yêu cầu verifier dài 43–128 ký tự. 32 byte base64url = 43.
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

/** Chuỗi ngẫu nhiên chống CSRF trên luồng OAuth */
export function generateState(): string {
  return randomBytes(32).toString('base64url');
}
