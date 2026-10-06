import { getAccessToken, useAuthStore } from '@/features/auth/store/auth.store';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export interface ApiErrorDetail {
  field: string;
  issue: string;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/* ────────────────────────────────────────────────────────────────
 * Refresh single-flight
 *
 * Đây là đoạn QUAN TRỌNG NHẤT của client.
 *
 * Khi access token hết hạn, thường có nhiều request 401 cùng lúc (nhiều
 * component cùng gọi API, hoặc người dùng mở nhiều tab). Nếu mỗi cái tự
 * gọi /auth/refresh, lần thứ hai sẽ dùng một refresh token đã bị rotate
 * -> server coi là token bị đánh cắp -> THU HỒI TOÀN BỘ PHIÊN và người
 * dùng bị đá ra oan.
 *
 * Backend đã có grace period 10 giây để chịu được điều này, nhưng client
 * vẫn phải tự chặn: mọi caller cùng chờ chung MỘT promise.
 * ──────────────────────────────────────────────────────────────── */
let refreshing: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  const res = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });

  if (!res.ok) {
    useAuthStore.getState().clear();
    throw new ApiError('TOKEN_INVALID', 'Phiên đăng nhập đã hết hạn.', res.status);
  }

  const body = (await res.json()) as { data: { accessToken: string } };
  useAuthStore.getState().setAccessToken(body.data.accessToken);
  return body.data.accessToken;
}

export function refreshOnce(): Promise<string> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/* ──────────────────────────────────────────────────────────────── */

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Bỏ qua tự động refresh (dùng cho chính endpoint refresh/login) */
  skipAuth?: boolean;
}

async function rawRequest(path: string, opts: RequestOptions): Promise<Response> {
  const token = getAccessToken();
  // Tách body và skipAuth ra khỏi phần spread: cả hai không thuộc RequestInit
  const { body, skipAuth, headers, ...rest } = opts;

  return fetch(`${API_URL}${path}`, {
    ...rest,
    // Bắt buộc để cookie refresh token được gửi kèm
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      // Form HTML không đặt được header tuỳ ý -> lớp chống CSRF bổ sung
      'X-Requested-With': 'XMLHttpRequest',
      ...(token && !skipAuth ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function toError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code: string; message: string; details?: ApiErrorDetail[] };
  } | null;

  return new ApiError(
    body?.error?.code ?? 'INTERNAL_ERROR',
    body?.error?.message ?? 'Đã có lỗi xảy ra. Vui lòng thử lại.',
    res.status,
    body?.error?.details,
  );
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await rawRequest(path, opts);

  if (res.status === 401 && !opts.skipAuth) {
    const err = await toError(res.clone());

    if (err.code === 'TOKEN_EXPIRED') {
      try {
        await refreshOnce();
      } catch {
        throw err;
      }
      // Thử lại ĐÚNG MỘT LẦN. Lặp vô hạn ở đây sẽ làm treo trình duyệt.
      res = await rawRequest(path, opts);
    } else {
      // TOKEN_INVALID / UNAUTHENTICATED -> refresh cũng vô ích
      useAuthStore.getState().clear();
      throw err;
    }
  }

  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;

  const body = (await res.json()) as { data: T };
  return body.data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, opts: RequestOptions = {}) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};

export { API_URL };
