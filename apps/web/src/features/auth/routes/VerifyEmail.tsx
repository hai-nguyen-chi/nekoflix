import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Alert } from '@/shared/components/Alert';
import { Button } from '@/shared/components/Button';
import { Spinner } from '@/shared/components/Spinner';
import { ApiError } from '@/shared/api/client';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../store/auth.store';
import { AuthLayout } from '../components/AuthLayout';

const MESSAGES: Record<string, string> = {
  TOKEN_CONSUMED: 'Liên kết này đã được sử dụng. Email của bạn có thể đã được xác thực rồi.',
  TOKEN_EXPIRED: 'Liên kết đã hết hạn. Hãy đăng nhập và yêu cầu gửi lại email xác thực.',
  TOKEN_INVALID: 'Liên kết xác thực không hợp lệ.',
};

export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const setUser = useAuthStore((s) => s.setUser);

  const verify = useMutation({
    mutationFn: authApi.verifyEmail,
    onSuccess: (data) => setUser(data.user),
  });

  /**
   * Chỉ chạy MỘT lần, kể cả khi React StrictMode gọi effect hai lần.
   *
   * Thiếu cờ này, lần gọi thứ hai sẽ nhận TOKEN_CONSUMED và người dùng
   * thấy báo lỗi dù vừa xác thực thành công.
   */
  const fired = useRef(false);

  useEffect(() => {
    if (!token || fired.current) return;
    fired.current = true;
    verify.mutate(token);
  }, [token, verify]);

  if (!token) {
    return (
      <AuthLayout title="Xác thực email">
        <Alert>Liên kết thiếu mã xác thực.</Alert>
      </AuthLayout>
    );
  }

  if (verify.isPending || verify.isIdle) {
    return (
      <AuthLayout title="Xác thực email">
        <Spinner label="Đang xác thực email..." />
      </AuthLayout>
    );
  }

  if (verify.isError) {
    const code = verify.error instanceof ApiError ? verify.error.code : '';
    return (
      <AuthLayout title="Không xác thực được">
        <div className="flex flex-col gap-5">
          <Alert>{MESSAGES[code] ?? 'Đã có lỗi xảy ra khi xác thực email.'}</Alert>
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
    <AuthLayout title="Xác thực thành công">
      <div className="flex flex-col gap-5">
        <Alert variant="success">
          Email <strong>{verify.data.user.email}</strong> đã được xác thực. Bạn đã có thể xem phim.
        </Alert>
        <Link to="/profiles">
          <Button className="w-full">Tiếp tục</Button>
        </Link>
      </div>
    </AuthLayout>
  );
}
