import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Alert } from '@/shared/components/Alert';
import { Button } from '@/shared/components/Button';
import { Spinner } from '@/shared/components/Spinner';
import { authApi } from '@/features/auth/api/auth.api';
import { useAuthStore } from '@/features/auth/store/auth.store';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

export function Account() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);

  const sessions = useQuery({ queryKey: ['sessions'], queryFn: authApi.sessions });

  const logout = useMutation({
    mutationFn: authApi.logout,
    /**
     * onSettled chứ không phải onSuccess.
     *
     * Dù server lỗi vẫn phải xoá state local. Giữ lại chỉ làm app tưởng
     * còn đăng nhập, rồi mọi request sau đó đều 401.
     */
    onSettled: () => {
      clear();
      void navigate('/login', { replace: true });
    },
  });

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <Link to="/browse" className="text-sm text-white/55 hover:text-white hover:underline">
        &larr; Quay lại
      </Link>

      <h1 className="mt-5 mb-8 text-3xl font-bold">Tài khoản</h1>

      <section className="mb-8 rounded-lg bg-white/5 p-5">
        <h2 className="mb-4 text-lg font-semibold">Thông tin</h2>
        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-white/50">Email</dt>
            <dd className="text-right">{user?.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-white/50">Tên hiển thị</dt>
            <dd className="text-right">{user?.displayName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-white/50">Trạng thái email</dt>
            <dd className="text-right">
              {user?.emailVerified ? (
                <span className="text-emerald-400">Đã xác thực</span>
              ) : (
                <span className="text-amber-400">Chưa xác thực</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mb-8 rounded-lg bg-white/5 p-5">
        <h2 className="mb-1 text-lg font-semibold">Thiết bị đang đăng nhập</h2>
        <p className="mb-4 text-xs text-white/45">
          Thấy thiết bị lạ? Hãy đổi mật khẩu — mọi thiết bị khác sẽ bị đăng xuất.
        </p>

        {sessions.isPending && <Spinner label="Đang tải..." />}
        {sessions.isError && <Alert>Không tải được danh sách thiết bị.</Alert>}

        {sessions.data && (
          <ul className="flex flex-col divide-y divide-white/10">
            {sessions.data.items.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {s.deviceLabel}
                    {s.current && (
                      <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
                        Hiện tại
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-white/45">
                    {s.ip || 'IP không rõ'} &bull; hoạt động {formatTime(s.lastUsedAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Button variant="danger" loading={logout.isPending} onClick={() => logout.mutate()}>
        Đăng xuất
      </Button>
    </div>
  );
}
