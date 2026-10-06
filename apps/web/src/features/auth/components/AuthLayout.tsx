import type { ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * Khung chung cho các trang auth.
 *
 * Ảnh nền để `opacity` thấp và phủ gradient đen: chữ trắng trên ảnh phải
 * đạt tương phản 4.5:1 mới đọc được, mà ảnh phim thì sáng tối thất thường.
 */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative min-h-dvh">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-ink to-ink"
      />
      <div className="relative mx-auto flex min-h-dvh max-w-md flex-col px-5 py-8">
        <Link
          to="/"
          className="mb-10 self-start text-2xl font-black tracking-tight text-brand"
          aria-label="Nekoflix — trang chủ"
        >
          NEKOFLIX
        </Link>
        <main className="flex-1">
          <h1 className="mb-7 text-3xl font-bold">{title}</h1>
          {children}
        </main>
      </div>
    </div>
  );
}
