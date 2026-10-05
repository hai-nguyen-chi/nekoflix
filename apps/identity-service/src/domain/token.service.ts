import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { UserRole } from '@nekoflix/contracts';
import { AppError } from '@nekoflix/service-kit';

export interface AccessTokenClaims {
  sub: string; // userId
  sid: string; // sessionId — để thu hồi
  pid: string | null; // profileId (Phase 1.5)
  role: UserRole;
  ev: boolean; // emailVerified
}

export interface VerifiedClaims extends AccessTokenClaims {
  iat: number;
  exp: number;
}

const ISSUER = 'nekoflix';
const AUDIENCE = 'nekoflix-web';

function parseDuration(value: string, fallbackSeconds: number): number {
  const m = /^(\d+)([smhd])$/.exec(value.trim());
  if (!m) return fallbackSeconds;
  const n = Number(m[1]);
  const unit = m[2] as 's' | 'm' | 'h' | 'd';
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[unit];
}

/** .env không chứa được xuống dòng thật, nên key được escape thành \n */
function unescapePem(key: string): string {
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

@Injectable()
export class TokenService {
  private readonly privateKey: string;
  private readonly publicKey: string;
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;

  constructor() {
    const priv = process.env.JWT_PRIVATE_KEY;
    const pub = process.env.JWT_PUBLIC_KEY;

    if (!priv || !pub) {
      // Fail fast lúc khởi động. Để service chạy với key rỗng rồi mới hỏng
      // ở request đầu tiên là kiểu lỗi tệ nhất.
      throw new Error(
        'Thiếu JWT_PRIVATE_KEY / JWT_PUBLIC_KEY trong .env.\n' + '  Chạy:  pnpm gen:secrets',
      );
    }

    this.privateKey = unescapePem(priv);
    this.publicKey = unescapePem(pub);
    this.accessTtlSeconds = parseDuration(process.env.ACCESS_TOKEN_TTL ?? '15m', 900);
    this.refreshTtlSeconds = parseDuration(process.env.REFRESH_TOKEN_TTL ?? '30d', 2_592_000);
  }

  /**
   * Access token: JWT RS256, sống ngắn (15 phút).
   *
   * Dùng RS256 (bất đối xứng) thay vì HS256: private key chỉ nằm ở
   * identity-service, các service khác chỉ cần public key để xác minh —
   * không service nào ngoài identity có thể TẠO token.
   */
  signAccessToken(claims: AccessTokenClaims): string {
    return jwt.sign(claims, this.privateKey, {
      algorithm: 'RS256',
      expiresIn: this.accessTtlSeconds,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  }

  verifyAccessToken(token: string): VerifiedClaims {
    try {
      return jwt.verify(token, this.publicKey, {
        algorithms: ['RS256'], // chốt thuật toán — chống tấn công alg=none
        issuer: ISSUER,
        audience: AUDIENCE,
      }) as VerifiedClaims;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError('TOKEN_EXPIRED', 'Phiên đăng nhập đã hết hạn.');
      }
      throw new AppError('TOKEN_INVALID', 'Token không hợp lệ.');
    }
  }

  /**
   * Refresh token: chuỗi ngẫu nhiên 32 byte, KHÔNG phải JWT.
   *
   * Lý do: refresh token phải thu hồi được ngay lập tức. Mà muốn thu hồi
   * thì phải tra database — lúc đó JWT không còn lợi ích gì, chỉ còn
   * nhược điểm (dài hơn, lộ thông tin trong payload).
   */
  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /** Chỉ hash được lưu vào DB. Lộ database vẫn không dùng được token. */
  hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  refreshExpiryDate(): Date {
    return new Date(Date.now() + this.refreshTtlSeconds * 1000);
  }
}
