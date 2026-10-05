import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error';

/**
 * Validate bằng chính schema trong @nekoflix/contracts.
 *
 * Cùng một schema dùng cho: DTO ở service, form ở frontend, và contract test.
 * Đổi field ở một nơi là TypeScript báo lỗi ở mọi nơi còn lại.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    try {
      return this.schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        throw AppError.validation(
          'Dữ liệu gửi lên không hợp lệ.',
          err.issues.map((i) => ({
            field: i.path.join('.') || '(root)',
            issue: i.message,
          })),
        );
      }
      throw err;
    }
  }
}

export function zodPipe<T>(schema: ZodType<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}
