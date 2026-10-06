import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
  loading?: boolean;
  children: ReactNode;
}

const STYLES = {
  primary: 'bg-brand hover:bg-brand-hover text-white',
  ghost: 'bg-white/10 hover:bg-white/20 text-white',
  danger: 'bg-transparent hover:bg-red-500/10 text-red-400 border border-red-400/40',
} as const;

export function Button({ variant = 'primary', loading, children, ...props }: Props) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      // aria-busy để trình đọc màn hình biết đang xử lý
      aria-busy={loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded px-5 py-3',
        'text-sm font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        STYLES[variant],
        props.className,
      )}
    >
      {loading && (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
        />
      )}
      {children}
    </button>
  );
}
