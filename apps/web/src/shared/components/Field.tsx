import type { InputHTMLAttributes } from 'react';
import { forwardRef, useId } from 'react';
import { cn } from '@/shared/lib/cn';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

/**
 * Ô nhập liệu có nhãn và thông báo lỗi.
 *
 * Dùng `useId` thay vì truyền id bằng tay: nhãn phải nối đúng với ô nhập
 * qua htmlFor/id, nếu không người dùng trình đọc màn hình không biết ô
 * này là gì. Lỗi nối qua aria-describedby và aria-invalid.
 */
export const Field = forwardRef<HTMLInputElement, Props>(function Field(
  { label, error, hint, ...props },
  ref,
) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-white/80">
        {label}
      </label>
      <input
        {...props}
        id={id}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(error && errorId, hint && hintId) || undefined}
        className={cn(
          'rounded bg-white/10 px-4 py-3 text-[15px] text-white placeholder:text-white/35',
          'transition-colors focus:bg-white/15',
          error && 'ring-1 ring-red-500',
          props.className,
        )}
      />
      {hint && !error && (
        <p id={hintId} className="text-xs text-white/45">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
});
