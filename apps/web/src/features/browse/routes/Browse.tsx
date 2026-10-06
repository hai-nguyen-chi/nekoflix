import { Link } from 'react-router';
import { useAuthStore } from '@/features/auth/store/auth.store';
import { Alert } from '@/shared/components/Alert';

/**
 * Chỗ giữ sẵn cho Phase 2 (catalog-service).
 *
 * Hiện chỉ xác nhận phiên và profile đã thiết lập đúng — tức là toàn bộ
 * đường dây auth hoạt động từ đầu đến cuối.
 */
export function Browse() {
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <span className="text-xl font-black tracking-tight text-brand">NEKOFLIX</span>
        <nav className="flex items-center gap-5 text-sm">
          <Link to="/account" className="text-white/65 hover:text-white">
            Tài khoản
          </Link>
          <button
            onClick={() => setProfile(null)}
            className="flex items-center gap-2 text-white/65 hover:text-white"
          >
            <span className="flex size-8 items-center justify-center rounded bg-white/15 text-sm font-bold">
              {profile?.name.charAt(0).toUpperCase()}
            </span>
            Đổi hồ sơ
          </button>
        </nav>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="mb-2 text-3xl font-bold">Xin chào, {profile?.name}</h1>
        <p className="mb-8 text-white/55">Đăng nhập bằng {user?.email}</p>

        {!user?.emailVerified && (
          <div className="mb-6">
            <Alert variant="info">
              Email chưa được xác thực. Hãy kiểm tra hộp thư và bấm liên kết xác thực để mở khoá
              tính năng xem phim.
            </Alert>
          </div>
        )}

        <div className="rounded-lg border border-dashed border-white/20 p-10 text-center">
          <p className="text-white/45">
            Thư viện phim sẽ xuất hiện ở đây sau khi hoàn thành Phase 2 (catalog-service).
          </p>
        </div>
      </main>
    </div>
  );
}
