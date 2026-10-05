import {
  type CanActivate,
  type CustomDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '@nekoflix/service-kit';
import type { UserRole } from '@nekoflix/contracts';

export const IS_PUBLIC = 'nekoflix:public';
/** Route không cần đăng nhập */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'nekoflix:roles';
export const Roles = (...roles: UserRole[]): CustomDecorator<string> => SetMetadata(ROLES, roles);

export interface AuthUser {
  userId: string;
  sessionId: string;
  profileId: string | null;
  role: UserRole;
  emailVerified: boolean;
}

export interface AuthedRequest extends Request {
  authUser?: AuthUser;
}

function unescapePem(key: string): string {
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

/**
 * Xác thực access token MỘT LẦN ở biên hệ thống.
 *
 * Gateway chỉ cần PUBLIC key để xác minh — private key nằm riêng ở
 * identity-service. Nghĩa là dù gateway bị chiếm, kẻ tấn công vẫn không
 * TẠO được token hợp lệ. Đây là lý do dùng RS256 thay vì HS256.
 *
 * Service phía sau TIN các claim này (chúng nằm sau NATS trong mạng nội
 * bộ), nhưng vẫn phải tự kiểm tra quyền NGHIỆP VỤ của mình: gateway xác
 * thực *danh tính*, service quyết định *được làm gì*.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly publicKey: string;

  constructor(private readonly reflector: Reflector) {
    const pub = process.env.JWT_PUBLIC_KEY;
    if (!pub) {
      throw new Error('Thiếu JWT_PUBLIC_KEY trong .env. Chạy: pnpm gen:secrets');
    }
    this.publicKey = unescapePem(pub);
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw AppError.unauthenticated('Thiếu access token.');
    }

    let claims: jwt.JwtPayload;
    try {
      claims = jwt.verify(header.slice(7), this.publicKey, {
        algorithms: ['RS256'], // chốt thuật toán — chống alg=none
        issuer: 'nekoflix',
        audience: 'nekoflix-web',
      }) as jwt.JwtPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        // Code riêng: client thấy mã này thì gọi /auth/refresh,
        // thấy TOKEN_INVALID thì đăng xuất hẳn.
        throw new AppError('TOKEN_EXPIRED', 'Access token đã hết hạn.');
      }
      throw new AppError('TOKEN_INVALID', 'Access token không hợp lệ.');
    }

    req.authUser = {
      userId: String(claims.sub),
      sessionId: String(claims.sid),
      profileId: (claims.pid as string | null) ?? null,
      role: claims.role as UserRole,
      emailVerified: claims.ev === true,
    };

    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && !required.includes(req.authUser.role)) {
      throw new AppError('INSUFFICIENT_ROLE', 'Bạn không có quyền thực hiện thao tác này.');
    }

    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.authUser) throw AppError.unauthenticated();
  return req.authUser;
});
