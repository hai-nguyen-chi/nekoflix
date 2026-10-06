import { API_URL } from '@/shared/api/client';

/**
 * Nút OAuth là thẻ <a>, KHÔNG phải <button> + fetch.
 *
 * Luồng OAuth cần trình duyệt tự điều hướng tới Google/GitHub. Gọi bằng
 * fetch sẽ dính CORS và không hiện được màn hình đăng nhập của họ.
 */
export function OAuthButtons({ next = '/browse' }: { next?: string }) {
  const href = (provider: string) =>
    `${API_URL}/v1/auth/oauth/${provider}?redirect=${encodeURIComponent(next)}`;

  return (
    <div className="flex flex-col gap-3">
      <a
        href={href('google')}
        className="flex items-center justify-center gap-3 rounded bg-white px-5 py-3 text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-100"
      >
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51Z"
          />
        </svg>
        Tiếp tục với Google
      </a>

      <a
        href={href('github')}
        className="flex items-center justify-center gap-3 rounded bg-white/10 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/20"
      >
        <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden>
          <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2 0 1.9 1.2 1.9 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.1 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z" />
        </svg>
        Tiếp tục với GitHub
      </a>
    </div>
  );
}
