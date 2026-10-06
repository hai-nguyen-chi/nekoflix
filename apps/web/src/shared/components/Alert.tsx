import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

interface Props {
  variant?: 'error' | 'success' | 'info';
  children: ReactNode;
}

const STYLES = {
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  info: 'bg-sky-500/15 text-sky-200 border-sky-500/30',
} as const;

export function Alert({ variant = 'error', children }: Props) {
  return (
    <div
      // role=alert để trình đọc màn hình đọc ngay khi xuất hiện
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn('rounded border px-4 py-3 text-sm leading-relaxed', STYLES[variant])}
    >
      {children}
    </div>
  );
}
