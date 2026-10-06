import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PublicProfile, PublicUser } from '@nekoflix/contracts';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  /**
   * CHỈ nằm trong bộ nhớ, KHÔNG BAO GIỜ vào localStorage.
   *
   * localStorage đọc được bằng JavaScript — một lỗ XSS là mất token.
   * Để trong biến thì mất khi tải lại tab, nhưng refresh token nằm trong
   * httpOnly cookie sẽ khôi phục phiên tự động lúc app khởi động.
   */
  accessToken: string | null;
  user: PublicUser | null;
  profile: PublicProfile | null;
  status: AuthStatus;

  setSession: (token: string, user: PublicUser) => void;
  setAccessToken: (token: string) => void;
  setProfile: (profile: PublicProfile | null) => void;
  setUser: (user: PublicUser) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      profile: null,
      status: 'loading',

      setSession: (accessToken, user) => set({ accessToken, user, status: 'authenticated' }),
      setAccessToken: (accessToken) => set({ accessToken, status: 'authenticated' }),
      setProfile: (profile) => set({ profile }),
      setUser: (user) => set({ user }),
      clear: () => set({ accessToken: null, user: null, profile: null, status: 'unauthenticated' }),
    }),
    {
      name: 'nekoflix-auth',
      /**
       * CHỈ lưu profile đang chọn — không nhạy cảm, và giữ lại giúp người
       * dùng không phải chọn lại profile mỗi lần mở app.
       *
       * accessToken và user KHÔNG được persist.
       */
      partialize: (s) => ({ profile: s.profile }),
    },
  ),
);

/** Đọc token ngoài component (API client dùng) */
export const getAccessToken = (): string | null => useAuthStore.getState().accessToken;
