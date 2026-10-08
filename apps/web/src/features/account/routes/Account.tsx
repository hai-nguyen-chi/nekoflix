import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Alert } from '@/shared/components/Alert';
import { Button } from '@/shared/components/Button';
import { Spinner } from '@/shared/components/Spinner';
import { authApi } from '@/features/auth/api/auth.api';
import { oauthApi } from '@/features/auth/api/oauth.api';
import { useAuthStore } from '@/features/auth/store/auth.store';
import { ChangePassword } from '../components/ChangePassword';
import { LinkedAccounts } from '../components/LinkedAccounts';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

export function Account() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);

  const sessions = useQuery({ queryKey: ['sessions'], queryFn: authApi.sessions });
  const linked = useQuery({ queryKey: ['linked'], queryFn: oauthApi.listLinked });

  const toLogin = () => {
    clear();
    void navigate('/login', { replace: true });
  };

  const logout = useMutation({
    mutationFn: authApi.logout,
    /**
     * onSettled chứ không phải onSuccess.
     *
     * Dù server lỗi vẫn phải xoá state local. Giữ lại chỉ làm app tưởng
     * còn đăng nhập, rồi mọi request sau đó đều 401.
     */
    onSettled: toLogin,
  });

  const logoutAll = useMutation({ mutationFn: authApi.logoutAll, onSettled: toLogin });

  const busy = logout.isPending || logoutAll.isPending;

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
        <h2 className="mb-4 text-lg font-semibold">Bảo mật</h2>

        {linked.isPending && <Spinner label="Đang tải..." />}
        {linked.isError && <Alert>Không tải được thiết lập bảo mật.</Alert>}

        {linked.data && (
          <div className="flex flex-col gap-6">
            <ChangePassword hasPassword={linked.data.hasPassword} />

            <div>
              <h3 className="mb-1 text-sm font-semibold text-white/80">Tài khoản liên kết</h3>
              <p className="mb-2 text-xs text-white/45">
                Đăng nhập nhanh bằng tài khoản mạng xã hội.
              </p>
              <LinkedAccounts data={linked.data} />
            </div>
          </div>
        )}
      </section>

      <section className="mb-8 rounded-lg bg-white/5 p-5">
        <h2 className="mb-1 text-lg font-semibold">Thiết bị đang đăng nhập</h2>
        <p className="mb-4 text-xs text-white/45">
          Thấy thiết bị lạ? Đăng xuất khỏi tất cả, rồi đổi mật khẩu ở mục Bảo mật.
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

        {/* Thu hồi TẤT CẢ, kể cả thiết bị này — nên phải hỏi lại. Khác với
            đổi mật khẩu (giữ phiên hiện tại), ở đây người dùng sẽ bị đăng
            xuất ngay tại chỗ. */}
        <div className="mt-5 border-t border-white/10 pt-5">
          {confirmLogoutAll ? (
            <div className="flex flex-col gap-3">
              <Alert variant="info">
                Mọi thiết bị sẽ bị đăng xuất, <strong>kể cả thiết bị này</strong>. Bạn sẽ phải đăng
                nhập lại.
              </Alert>
              <div className="flex gap-3">
                <Button
                  variant="ghost"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => setConfirmLogoutAll(false)}
                >
                  Huỷ
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  loading={logoutAll.isPending}
                  onClick={() => logoutAll.mutate()}
                >
                  Đăng xuất tất cả
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="danger"
              className="px-4 py-2 text-xs"
              disabled={busy}
              onClick={() => setConfirmLogoutAll(true)}
            >
              Đăng xuất khỏi mọi thiết bị
            </Button>
          )}
        </div>
      </section>

      <Button
        variant="danger"
        loading={logout.isPending}
        disabled={busy}
        onClick={() => logout.mutate()}
      >
        Đăng xuất
      </Button>
    </div>
  );
}
