import { RPC_ERROR_MARKER, type RpcErrorShape, httpStatusForCode } from '@nekoflix/contracts';

export interface ErrorDetail {
  field: string;
  issue: string;
}

/**
 * Lỗi nghiệp vụ. Service ném, gateway bắt và map sang HTTP status.
 *
 * Dùng `code` ổn định để client switch theo; `message` chỉ dành cho người đọc.
 */
export class AppError extends Error {
  readonly code: string;
  readonly details?: ErrorDetail[];

  constructor(code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  get httpStatus(): number {
    return httpStatusForCode(this.code);
  }

  /** Hình dạng truyền qua NATS — Error thường không serialize được */
  toRpc(): RpcErrorShape {
    return {
      [RPC_ERROR_MARKER]: true,
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }

  static notFound(what = 'Không tìm thấy.') {
    return new AppError('NOT_FOUND', what);
  }
  static validation(message: string, details?: ErrorDetail[]) {
    return new AppError('VALIDATION_FAILED', message, details);
  }
  static unauthenticated(message = 'Chưa đăng nhập.') {
    return new AppError('UNAUTHENTICATED', message);
  }
  static forbidden(message = 'Không có quyền thực hiện thao tác này.') {
    return new AppError('FORBIDDEN', message);
  }
  static conflict(code: string, message: string) {
    return new AppError(code, message);
  }
  static internal(message = 'Đã có lỗi xảy ra.') {
    return new AppError('INTERNAL_ERROR', message);
  }
  static unavailable(message = 'Dịch vụ tạm thời không khả dụng.') {
    return new AppError('SERVICE_UNAVAILABLE', message);
  }
  static timeout(message = 'Dịch vụ phản hồi quá chậm.') {
    return new AppError('UPSTREAM_TIMEOUT', message);
  }
}

export function toRpcError(err: unknown): RpcErrorShape {
  if (err instanceof AppError) return err.toRpc();
  return {
    [RPC_ERROR_MARKER]: true,
    code: 'INTERNAL_ERROR',
    // KHÔNG lộ message gốc ra ngoài — có thể chứa chi tiết nội bộ
    message: 'Đã có lỗi xảy ra.',
  };
}
