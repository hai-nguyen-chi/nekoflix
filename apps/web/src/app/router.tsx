import { useEffect } from 'react';
import { Navigate, Outlet, createBrowserRouter, useLocation } from 'react-router';
import { Spinner } from '@/shared/components/Spinner';
import { refreshOnce } from '@/shared/api/client';
import { useAuthStore } from '@/features/auth/store/auth.store';
import { Login } from '@/features/auth/routes/Login';
import { Register } from '@/features/auth/routes/Register';
import { VerifyEmail } from '@/features/auth/routes/VerifyEmail';
import { ForgotPassword } from '@/features/auth/routes/ForgotPassword';
import { ResetPassword } from '@/features/auth/routes/ResetPassword';
import { OAuthCallback } from '@/features/auth/routes/OAuthCallback';
import { ProfileSelect } from '@/features/profiles/routes/ProfileSelect';
import { ProfileManage } from '@/features/profiles/routes/ProfileManage';
import { Browse } from '@/features/browse/routes/Browse';
import { Account } from '@/features/account/routes/Account';

/**
 * Khôi phục phiên lúc app khởi động.
 *
 * Access token chỉ nằm trong bộ nhớ nên tải lại tab là mất. Nhưng refresh
 * token nằm trong httpOnly cookie, nên gọi /auth/refresh một lần là lấy
 * lại được phiên — người dùng không phải đăng nhập lại sau mỗi lần F5.
 *
 * Trong lúc chờ, hiện spinner thay vì render luôn. Render ngay sẽ làm
 * người dùng thấy trang đăng nhập nháy lên rồi mới nhảy vào app.
 */
function SessionBootstrap() {
  const status = useAuthStore((s) => s.status);
  const token = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (status !== 'loading') return;

    refreshOnce()
      .then(() => undefined)
      .catch(() => {
        // Không có cookie hợp lệ -> chưa đăng nhập. Đây là trạng thái
        // BÌNH THƯỜNG của khách vãng lai, không phải lỗi.
        useAuthStore.getState().clear();
      });
  }, [status]);

  if (status === 'loading' && !token) return <Spinner label="Đang khôi phục phiên..." />;
  return <Outlet />;
}

/** Chặn route cần đăng nhập */
function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status === 'loading') return <Spinner />;

  if (status !== 'authenticated') {
    // Nhớ nơi người dùng định tới, để sau khi đăng nhập quay lại đúng chỗ
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <Outlet />;
}

/** Route cần đã chọn profile */
function RequireProfile() {
  const profile = useAuthStore((s) => s.profile);
  if (!profile) return <Navigate to="/profiles" replace />;
  return <Outlet />;
}

/** Đã đăng nhập thì không vào trang đăng nhập/đăng ký nữa */
function GuestOnly() {
  const status = useAuthStore((s) => s.status);
  if (status === 'authenticated') return <Navigate to="/profiles" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    element: <SessionBootstrap />,
    children: [
      { path: '/', element: <Navigate to="/profiles" replace /> },

      // Công khai hoàn toàn: dùng được cả khi đang đăng nhập.
      // Người dùng bấm link xác thực trong email lúc đang mở app vẫn phải chạy.
      { path: '/verify', element: <VerifyEmail /> },
      { path: '/reset-password', element: <ResetPassword /> },
      { path: '/oauth/callback', element: <OAuthCallback /> },

      {
        element: <GuestOnly />,
        children: [
          { path: '/login', element: <Login /> },
          { path: '/register', element: <Register /> },
          { path: '/forgot-password', element: <ForgotPassword /> },
        ],
      },

      {
        element: <RequireAuth />,
        children: [
          { path: '/profiles', element: <ProfileSelect /> },
          { path: '/profiles/manage', element: <ProfileManage /> },
          { path: '/account', element: <Account /> },
          {
            element: <RequireProfile />,
            children: [{ path: '/browse', element: <Browse /> }],
          },
        ],
      },

      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
