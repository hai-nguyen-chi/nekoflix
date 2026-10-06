import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { Alert } from '@/shared/components/Alert';
import { Button } from '@/shared/components/Button';
import { Field } from '@/shared/components/Field';
import { ApiError } from '@/shared/api/client';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../store/auth.store';
import { AuthLayout } from '../components/AuthLayout';
import { OAuthButtons } from '../components/OAuthButtons';

/**
 * Schema RIÊNG cho form đăng nhập, không dùng `passwordSchema` của backend.
 *
 * Nếu policy mật khẩu siết lại sau này, người đăng ký từ trước vẫn phải
 * đăng nhập được bằng mật khẩu cũ. Chỉ form ĐĂNG KÝ mới áp policy.
 */
const schema = z.object({
  email: z.string().min(1, 'Vui lòng nhập email').email('Email không hợp lệ'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});

type FormValues = z.infer<typeof schema>;

/** Lỗi OAuth trả về qua query — dịch sang thông báo người đọc hiểu được */
const OAUTH_ERRORS: Record<string, string> = {
  oauth_cancelled: 'Bạn đã huỷ đăng nhập.',
  oauth_invalid: 'Liên kết đăng nhập không hợp lệ. Vui lòng thử lại.',
  EMAIL_NOT_VERIFIED:
    'Email này đã được đăng ký nhưng chưa xác thực. Hãy xác thực email trước khi liên kết tài khoản.',
  SERVICE_UNAVAILABLE: 'Dịch vụ đăng nhập này chưa sẵn sàng. Vui lòng thử cách khác.',
  TOKEN_INVALID: 'Phiên đăng nhập đã hết hạn. Vui lòng thử lại.',
};

export function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);

  const oauthError = params.get('error');
  const next = params.get('next') ?? '/profiles';

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const login = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      setSession(data.accessToken, data.user);
      void navigate(next, { replace: true });
    },
  });

  const serverError =
    login.error instanceof ApiError
      ? login.error.message
      : login.error
        ? 'Đã có lỗi xảy ra.'
        : null;

  return (
    <AuthLayout title="Đăng nhập">
      {oauthError && (
        <div className="mb-5">
          <Alert>{OAUTH_ERRORS[oauthError] ?? 'Đăng nhập không thành công.'}</Alert>
        </div>
      )}

      <form
        onSubmit={(e) => void form.handleSubmit((v) => login.mutate(v))(e)}
        className="flex flex-col gap-4"
        noValidate
      >
        {serverError && <Alert>{serverError}</Alert>}

        <Field
          label="Email"
          type="email"
          autoComplete="email"
          // Nhảy thẳng vào ô email khi mở trang — bớt một lần bấm chuột
          autoFocus
          placeholder="ban@example.com"
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />

        <Field
          label="Mật khẩu"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          error={form.formState.errors.password?.message}
          {...form.register('password')}
        />

        <Button type="submit" loading={login.isPending} className="mt-2">
          Đăng nhập
        </Button>
      </form>

      <Link
        to="/forgot-password"
        className="mt-4 inline-block text-sm text-white/60 hover:text-white hover:underline"
      >
        Quên mật khẩu?
      </Link>

      <div className="my-7 flex items-center gap-4">
        <span className="h-px flex-1 bg-white/15" />
        <span className="text-xs uppercase tracking-wider text-white/40">hoặc</span>
        <span className="h-px flex-1 bg-white/15" />
      </div>

      <OAuthButtons next={next} />

      <p className="mt-8 text-sm text-white/60">
        Chưa có tài khoản?{' '}
        <Link to="/register" className="font-medium text-white hover:underline">
          Đăng ký ngay
        </Link>
      </p>
    </AuthLayout>
  );
}
