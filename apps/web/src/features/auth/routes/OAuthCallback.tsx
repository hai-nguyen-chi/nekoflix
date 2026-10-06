import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert } from '@/shared/components/Alert';
import { Button } from '@/shared/components/Button';
import { Spinner } from '@/shared/components/Spinner';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../store/auth.store';
import { AuthLayout } from '../components/AuthLayout';

/**
 * Nhận mã đổi từ gateway rồi lấy token qua POST.
 *
 * Mã này nằm trong URL — nên nó KHÔNG phải token. Nó sống 60 giây và dùng
 * được đúng một lần. Token thật chỉ đi qua thân request POST và cookie.
 */
export function OAuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const code = params.get('code');
  const next = params.get('next') ?? '/profiles';
  const isNew = params.get('new') === '1';

  const exchange = useMutation({
    mutationFn: authApi.exchangeOAuth,
    onSuccess: (data) => {
      setSession(data.accessToken, data.user);
      // replace: true — bấm Back không quay lại URL còn chứa mã đổi
      void navigate(isNew ? '/profiles' : next, { replace: true });
    },
  });

  /**
   * Chỉ chạy MỘT lần.
   *
   * React StrictMode gọi effect hai lần ở môi trường dev. Mã đổi dùng một
   * lần, nên lần thứ hai sẽ thất bại và người dùng thấy báo lỗi dù vừa
   * đăng nhập thành công.
   */
  const fired = useRef(false);

  useEffect(() => {
    if (!code || fired.current) return;
    fired.current = true;
    exchange.mutate(code);
  }, [code, exchange]);

  if (!code) {
    return (
      <AuthLayout title="Đăng nhập không thành công">
        <div className="flex flex-col gap-5">
          <Alert>Thiếu mã đăng nhập. Vui lòng thử lại.</Alert>
          <Link to="/login">
            <Button variant="ghost" className="w-full">
              Về trang đăng nhập
            </Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (exchange.isError) {
    return (
      <AuthLayout title="Đăng nhập không thành công">
        <div className="flex flex-col gap-5">
          <Alert>Mã đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.</Alert>
          <Link to="/login">
            <Button variant="ghost" className="w-full">
              Về trang đăng nhập
            </Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Đang đăng nhập">
      <Spinner label="Đang hoàn tất đăng nhập..." />
    </AuthLayout>
  );
}
