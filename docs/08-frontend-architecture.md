# 08 — Frontend Architecture

## 1. Stack

| Vai trò      | Lựa chọn                              | Tại sao                                           |
| ------------ | ------------------------------------- | ------------------------------------------------- |
| Framework    | React 19                              | Hooks, `use()`, Suspense                          |
| Build        | Vite 6                                | Dev server nhanh, build Rollup                    |
| Routing      | React Router 7 (data mode)            | `loader`/`action`, không cần SSR                  |
| Server state | TanStack Query v5                     | Cache, dedupe, invalidate, infinite query         |
| Client state | Zustand                               | Nhẹ, không boilerplate — chỉ cho auth, player, UI |
| Form         | React Hook Form + Zod                 | Validate chung schema với backend                 |
| Styling      | Tailwind CSS 4                        |                                                   |
| Component    | Radix UI primitives                   | Accessible sẵn, không áp đặt style                |
| Player       | hls.js + `<video>` tự build UI        | Thư viện player có sẵn khó custom cho Watch Party |
| Realtime     | socket.io-client                      |                                                   |
| i18n         | i18next                               |                                                   |
| Animation    | Framer Motion                         | Chỉ dùng cho carousel + modal                     |
| Test         | Vitest + Testing Library + Playwright |                                                   |

## 2. Phân tách state — nguyên tắc quan trọng nhất

Nhầm lẫn hai loại state là nguồn gốc của phần lớn bug và code rối ở frontend.

| Loại                                                  | Công cụ                    | Ví dụ                                                            |
| ----------------------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| **Server state** — dữ liệu thuộc về server, có thể cũ | TanStack Query             | title detail, watchlist, continue watching, notification         |
| **Client state** — chỉ tồn tại ở browser              | Zustand                    | accessToken, profile đang chọn, trạng thái player, modal đang mở |
| **URL state**                                         | React Router search params | query tìm kiếm, filter, tab đang mở                              |
| **Form state**                                        | React Hook Form            | input đang gõ                                                    |

**Không bao giờ** copy server state vào Zustand. Nếu thấy mình viết `setTitles(data)` trong `useEffect` thì đang làm sai.

```ts
// SAI
const [titles, setTitles] = useState([]);
useEffect(() => {
  api.getTitles().then(setTitles);
}, []);

// ĐÚNG
const { data: titles } = useQuery({
  queryKey: ['titles', filters],
  queryFn: () => api.getTitles(filters),
});
```

## 3. Cấu trúc thư mục

Tổ chức theo **feature**, không theo loại file.

```
apps/web/src/
├── app/
│   ├── router.tsx              # định nghĩa route
│   ├── providers.tsx           # QueryClient, i18n, Theme, Socket
│   └── root-layout.tsx
├── features/
│   ├── auth/
│   │   ├── api/                # queries + mutations
│   │   ├── components/         # LoginForm, OAuthButtons, TwoFactorInput
│   │   ├── hooks/              # useAuth, useRequireAuth
│   │   ├── store/              # auth.store.ts (Zustand)
│   │   └── routes/             # login.tsx, register.tsx, verify.tsx
│   ├── profiles/
│   ├── catalog/
│   │   ├── components/         # TitleCard, Carousel, HeroBanner, FilterBar
│   │   ├── api/
│   │   └── routes/             # browse.tsx, title-detail.tsx, search.tsx
│   ├── player/
│   │   ├── components/         # Player, Controls, SubtitleMenu, QualityMenu
│   │   ├── hooks/              # useHls, useProgressSync, useKeyboardShortcuts
│   │   └── routes/             # watch.tsx
│   ├── watch-party/
│   ├── watchlist/
│   ├── notifications/
│   ├── billing/
│   └── admin/
├── shared/
│   ├── api/
│   │   ├── client.ts           # fetch wrapper + interceptor
│   │   ├── refresh-queue.ts    # chống race refresh token
│   │   └── errors.ts           # ApiError class, mapping code → message
│   ├── components/ui/          # Button, Dialog, Input, Skeleton...
│   ├── hooks/                  # useDebounce, useMediaQuery, useIntersection
│   ├── lib/                    # cn(), formatDuration(), slugify()
│   ├── socket/                 # socket provider + typed emitter
│   └── types/                  # type dùng chung, sinh từ OpenAPI
├── locales/
│   ├── vi/
│   └── en/
└── main.tsx
```

**Quy tắc phụ thuộc**:

- `features/*` import được `shared/*`
- `shared/*` **không** import `features/*`
- Feature này import feature kia chỉ qua `index.ts` được export rõ ràng (public API của feature)

## 4. Routing

```tsx
const router = createBrowserRouter([
  {
    path: '/',
    element: <PublicLayout />,
    children: [
      { index: true, element: <Landing /> },
      { path: 'login', element: <Login /> },
      { path: 'register', element: <Register /> },
      { path: 'verify', element: <VerifyEmail /> },
      { path: 'oauth/callback', element: <OAuthCallback /> },
    ],
  },

  // Đã đăng nhập, chưa chọn profile
  {
    path: '/profiles',
    element: <RequireAuth />,
    children: [
      { index: true, element: <ProfileSelect /> },
      { path: 'manage', element: <ProfileManage /> },
    ],
  },

  // Đã đăng nhập + đã chọn profile
  {
    path: '/',
    element: <RequireProfile />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: 'browse', element: <Browse /> },
          { path: 'search', element: <Search /> },
          { path: 'my-list', element: <MyList /> },
          { path: 'title/:slug', element: <TitleDetail /> },
          { path: 'account', element: <Account /> },
        ],
      },
      // Player full screen — layout riêng, không có navbar
      { path: 'watch/:playableId', element: <Watch /> },
    ],
  },

  {
    path: '/admin',
    element: <RequireRole roles={['moderator', 'admin']} />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { path: 'titles', element: <AdminTitles /> },
          { path: 'titles/:id', element: <AdminTitleEdit /> },
          { path: 'media', element: <AdminMedia /> },
          { path: 'users', element: <AdminUsers /> },
          { path: 'analytics', element: <AdminAnalytics /> },
        ],
      },
    ],
  },
]);
```

Mọi route ngoài `/`, `/login`, `/browse` đều `React.lazy()`. Admin là một chunk riêng — người dùng thường không bao giờ tải nó.

## 5. API client

```ts
// shared/api/client.ts
class ApiClient {
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchWithAuth(path, init);

    if (res.status === 401) {
      const body = await res
        .clone()
        .json()
        .catch(() => null);

      if (body?.error?.code === 'TOKEN_EXPIRED') {
        await refreshOnce(); // nhiều caller dùng chung 1 promise
        return this.request<T>(path, init); // thử lại ĐÚNG MỘT LẦN
      }
      authStore.getState().logout();
      throw new ApiError(body?.error);
    }

    if (!res.ok) throw new ApiError((await res.json()).error);
    return res.status === 204 ? (undefined as T) : res.json();
  }

  private fetchWithAuth(path: string, init: RequestInit) {
    const { accessToken, activeProfileId } = authStore.getState();
    return fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include', // để cookie refresh token đi kèm
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        ...(activeProfileId && { 'X-Profile-Id': activeProfileId }),
        ...init.headers,
      },
    });
  }
}
```

Chống vòng lặp vô hạn: chỉ retry **một lần** sau refresh. Nếu vẫn 401 → logout.

## 6. Query key convention

```ts
export const queryKeys = {
  catalog: {
    home: (profileId: string) => ['catalog', 'home', profileId] as const,
    title: (slug: string) => ['catalog', 'title', slug] as const,
    search: (q: string, f: Filters) => ['catalog', 'search', q, f] as const,
    episodes: (titleId: string, season: number) =>
      ['catalog', 'episodes', titleId, season] as const,
  },
  playback: {
    continue: (profileId: string) => ['playback', 'continue', profileId] as const,
  },
  watchlist: (profileId: string) => ['watchlist', profileId] as const,
} as const;
```

Key luôn bắt đầu từ chung đến riêng → `invalidateQueries({ queryKey: ['catalog'] })` xóa cả nhánh.

**Mọi key cá nhân hóa phải chứa `profileId`.** Nếu không, đổi profile sẽ thấy dữ liệu của profile cũ — bug kinh điển.

### Optimistic update

```ts
export function useToggleWatchlist(profileId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ titleId, add }) =>
      add ? api.addToWatchlist(titleId) : api.removeFromWatchlist(titleId),

    onMutate: async ({ titleId, add }) => {
      const key = queryKeys.catalog.title(titleId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (old) => ({
        ...old,
        userState: { ...old.userState, inWatchlist: add },
      }));
      return { prev, key };
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: (_d, _e, _v, ctx) => {
      qc.invalidateQueries({ queryKey: ctx.key });
      qc.invalidateQueries({ queryKey: queryKeys.watchlist(profileId) });
    },
  });
}
```

## 7. Zustand store

```ts
// features/auth/store/auth.store.ts
interface AuthState {
  accessToken: string | null; // CHỈ trong memory
  user: User | null;
  profiles: Profile[];
  activeProfileId: string | null; // persist localStorage — không nhạy cảm
  status: 'loading' | 'authenticated' | 'unauthenticated';

  setAuth(token: string, user: User, profiles: Profile[]): void;
  setActiveProfile(id: string): void;
  logout(): void;
}

export const authStore = create<AuthState>()(
  persist((set) => ({/* ... */}), {
    name: 'nekoflix-auth',
    // CHỈ persist activeProfileId. Token không bao giờ chạm localStorage.
    partialize: (s) => ({ activeProfileId: s.activeProfileId }),
  }),
);
```

Khi app khởi động: gọi `/auth/refresh` một lần. Thành công → `authenticated`; 401 → `unauthenticated`. Trong lúc chờ, hiện splash screen — tránh nháy từ trang login sang trang browse.

## 8. Player

### 8.1 Phân lớp

```
<Watch>                              route — fetch playback info
  └── <PlayerProvider>               context: hls instance, video ref, state
        ├── <VideoSurface>           <video> + hls.js attach
        ├── <ControlsOverlay>        tự ẩn sau 3s không cử động
        │     ├── <ProgressBar>      kèm seek preview sprite
        │     ├── <PlayButton> <VolumeControl> <TimeDisplay>
        │     └── <SubtitleMenu> <QualityMenu> <SpeedMenu> <FullscreenButton>
        ├── <SkipIntroButton>        hiện trong khoảng introStart..introEnd
        ├── <NextEpisodeCard>        hiện từ creditsStart
        ├── <BufferingSpinner>
        └── <WatchPartyPanel>        chat + member list (nếu đang trong party)
```

### 8.2 `useHls`

```ts
export function useHls(videoRef: RefObject<HTMLVideoElement>, src: string | null) {
  const [state, setState] = useState<HlsState>({ levels: [], currentLevel: -1, ready: false });
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // Safari: dùng HLS native
    if (!Hls.isSupported()) {
      video.src = src;
      return () => {
        video.src = '';
      };
    }

    const hls = new Hls(HLS_CONFIG);
    hlsRef.current = hls;
    hls.loadSource(src);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, (_, d) =>
      setState((s) => ({ ...s, levels: d.levels, ready: true })),
    );
    hls.on(Hls.Events.LEVEL_SWITCHED, (_, d) => setState((s) => ({ ...s, currentLevel: d.level })));
    hls.on(Hls.Events.ERROR, handleError);

    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [src]);

  return {
    ...state,
    setLevel: (l: number) => {
      if (hlsRef.current) hlsRef.current.currentLevel = l;
    },
  };
}
```

### 8.3 `useProgressSync`

```ts
export function useProgressSync(video: HTMLVideoElement | null, playable: PlayableRef) {
  const lastSent = useRef(0);

  useEffect(() => {
    if (!video) return;

    const send = (opts: { beacon?: boolean } = {}) => {
      if (!video.duration || video.currentTime < 1) return;
      const body = JSON.stringify({
        ...playable,
        positionSec: Math.floor(video.currentTime),
        durationSec: Math.floor(video.duration),
      });

      if (opts.beacon) {
        // beforeunload: fetch bị hủy, sendBeacon thì không
        navigator.sendBeacon(`${API_URL}/playback/progress?t=${getToken()}`, body);
      } else {
        api.updateProgress(body);
      }
      lastSent.current = video.currentTime;
    };

    const interval = setInterval(() => {
      if (!video.paused && Math.abs(video.currentTime - lastSent.current) >= 10) send();
    }, 10_000);

    const onPause = () => send();
    const onSeeked = () => send();
    const onEnded = () => send();
    const onUnload = () => send({ beacon: true });
    const onVisibility = () => {
      if (document.hidden) send();
    };

    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ended', onEnded);
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      send();
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('ended', onEnded);
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [video, playable.titleId, playable.episodeId]);
}
```

`visibilitychange` quan trọng trên mobile: `beforeunload` không đáng tin khi app bị đưa vào background.

### 8.4 Phím tắt

| Phím          | Hành động                    |
| ------------- | ---------------------------- |
| `Space` / `K` | Play / Pause                 |
| `←` / `→`     | Lùi / tiến 10s               |
| `J` / `L`     | Lùi / tiến 10s               |
| `↑` / `↓`     | Âm lượng ±10%                |
| `F`           | Fullscreen                   |
| `M`           | Mute                         |
| `C`           | Bật/tắt phụ đề               |
| `P`           | Picture-in-Picture           |
| `0`–`9`       | Nhảy tới 0%–90%              |
| `Esc`         | Thoát fullscreen / đóng menu |

Bỏ qua khi focus đang ở `<input>`, `<textarea>`, hoặc element `contenteditable`.

## 9. Carousel (hàng phim)

Yêu cầu: cuộn ngang mượt, lazy-load, snap, điều khiển được bằng bàn phím.

```tsx
<div className="group/row relative">
  <div
    ref={scrollRef}
    className="flex gap-2 overflow-x-auto scroll-smooth snap-x snap-mandatory
                  scrollbar-none [&>*]:snap-start"
  >
    {items.map((item) => (
      <TitleCard key={item.id} {...item} />
    ))}
    {hasMore && <div ref={sentinelRef} className="w-1" />}
  </div>
  <ScrollButton dir="left" onClick={() => scrollBy(-pageWidth)} />
  <ScrollButton dir="right" onClick={() => scrollBy(pageWidth)} />
</div>
```

- Dùng CSS `overflow-x-auto` + `scroll-snap` thay vì thư viện carousel — native, mượt, hoạt động với touch sẵn
- `IntersectionObserver` trên sentinel → `fetchNextPage()`
- `<img loading="lazy">` + `decoding="async"` cho poster
- Hover card (phóng to, hiện preview) chỉ bật trên thiết bị có `hover: hover` — tránh kẹt trên mobile

## 10. Hiệu năng

| Kỹ thuật                     | Áp dụng ở đâu                                                          |
| ---------------------------- | ---------------------------------------------------------------------- |
| Route-based code splitting   | Mọi route trừ Browse                                                   |
| `manualChunks`               | Tách `react`, `hls.js`, `framer-motion` thành vendor chunk riêng       |
| Image: WebP + AVIF, `srcset` | Poster, backdrop                                                       |
| Preload                      | Font chính, backdrop của hero                                          |
| `content-visibility: auto`   | Các row dưới màn hình đầu                                              |
| Prefetch                     | Hover vào TitleCard > 200ms → `queryClient.prefetchQuery` title detail |
| `React.memo`                 | TitleCard (render hàng trăm lần)                                       |
| Virtual list                 | **Không dùng** — carousel đã giới hạn số item render                   |

**Ngân sách** (ép ở CI bằng `size-limit`):

- JS ban đầu: < 250KB gzip
- CSS: < 50KB gzip
- LCP: < 2.5s trên Fast 3G giả lập

## 11. Accessibility

- Mọi control có `aria-label`; trạng thái dùng `aria-pressed`, `aria-expanded`
- Carousel: `role="region"` + `aria-label` tên hàng; mũi tên trái/phải điều hướng được bằng bàn phím
- Modal: focus trap, `Esc` đóng, trả focus về trigger
- Player: `aria-live="polite"` thông báo đổi chất lượng, bật/tắt phụ đề
- Tương phản màu >= 4.5:1 — kiểm tra kỹ vì theme tối nhiều chữ xám
- `prefers-reduced-motion` → tắt autoplay preview và animation carousel
- Có thể dùng toàn bộ app bằng bàn phím (test thủ công mỗi phase)

## 12. Error handling

```tsx
<ErrorBoundary fallback={<AppCrash />}>
  {' '}
  {/* lỗi render */}
  <Suspense fallback={<PageSkeleton />}>
    {' '}
    {/* lazy route */}
    <QueryErrorResetBoundary>
      {' '}
      {/* lỗi query, có nút Thử lại */}
      <Outlet />
    </QueryErrorResetBoundary>
  </Suspense>
</ErrorBoundary>
```

Map `error.code` → thông báo tiếng Việt tập trung ở một chỗ (`shared/api/error-messages.ts`), có fallback cho code lạ.

## 13. i18n

```
locales/vi/common.json, auth.json, catalog.json, player.json, errors.json
locales/en/...
```

- Namespace theo feature, lazy-load theo route
- Không hardcode chuỗi trong component — ESLint rule `i18next/no-literal-string` bật cho `features/`
- Số và ngày dùng `Intl.NumberFormat` / `Intl.DateTimeFormat`
- Ngôn ngữ lấy từ `profile.language`, fallback `navigator.language`, fallback `vi`

---

**Tiếp theo**: [09 — Project Structure](09-project-structure.md)
