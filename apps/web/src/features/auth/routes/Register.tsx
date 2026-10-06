import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { passwordSchema } from '@nekoflix/contracts';
import { Alert } from '@/shared/components/Alert';
import { Button } from '@/shared/components/Button';
import { Field } from '@/shared/components/Field';
import { ApiError } from '@/shared/api/client';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../store/auth.store';
import { AuthLayout } from '../components/AuthLayout';
import { OAuthButtons } from '../components/OAuthButtons';

/**
 * Dùng LẠI `passwordSchema` từ @nekoflix/contracts — chính schema mà
 * backend validate.
 *
 * Đây là lợi ích cụ thể của monorepo: siết policy mật khẩu ở một chỗ,
 * cả hai đầu đổi theo, và thông báo lỗi giống hệt nhau.
 */
const schema = z.object({
  displayName: z.string().min(2, 'Tên quá ngắn').max(50, 'Tên quá dài'),
  email: z.string().min(1, 'Vui lòng nhập email').email('Email không hợp lệ'),
  password: passwordSchema,
});

type FormValues = z.infer<typeof schema>;

export function Register() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { displayName: '', email: '', password: '' },
    // Kiểm tra lại ngay khi gõ SAU khi đã lỗi một lần — người dùng thấy
    // lỗi biến mất lúc sửa đúng, thay vì phải bấm gửi lại mới biết.
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const register = useMutation({
    mutationFn: authApi.register,
    onSuccess: (data) => {
      setSession(data.accessToken, data.user);
      void navigate('/profiles', { replace: true });
    },
  });

  const serverError =
    register.error instanceof ApiError
      ? register.error.message
      : register.error
        ? 'Đã có lỗi xảy ra.'
        : null;

  return (
    <AuthLayout title="Tạo tài khoản">
      <form
        onSubmit={(e) => void form.handleSubmit((v) => register.mutate(v))(e)}
        className="flex flex-col gap-4"
        noValidate
      >
        {serverError && <Alert>{serverError}</Alert>}

        <Field
          label="Tên hiển thị"
          autoComplete="name"
          autoFocus
          placeholder="Nguyễn Văn A"
          error={form.formState.errors.displayName?.message}
          {...form.register('displayName')}
        />

        <Field
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="ban@example.com"
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />

        <Field
          label="Mật khẩu"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          hint="Tối thiểu 8 ký tự, có cả chữ và số"
          error={form.formState.errors.password?.message}
          {...form.register('password')}
        />

        <Button type="submit" loading={register.isPending} className="mt-2">
          Đăng ký
        </Button>
      </form>

      <p className="mt-4 text-xs leading-relaxed text-white/45">
        Sau khi đăng ký, chúng tôi sẽ gửi email xác thực. Bạn cần xác thực email để xem phim.
      </p>

      <div className="my-7 flex items-center gap-4">
        <span className="h-px flex-1 bg-white/15" />
        <span className="text-xs uppercase tracking-wider text-white/40">hoặc</span>
        <span className="h-px flex-1 bg-white/15" />
      </div>

      <OAuthButtons />

      <p className="mt-8 text-sm text-white/60">
        Đã có tài khoản?{' '}
        <Link to="/login" className="font-medium text-white hover:underline">
          Đăng nhập
        </Link>
      </p>
    </AuthLayout>
  );
}
