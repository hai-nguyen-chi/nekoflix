import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { passwordSchema } from '@nekoflix/contracts';
import { Alert } from '@/shared/components/Alert';
import { Button } from '@/shared/components/Button';
import { Field } from '@/shared/components/Field';
import { ApiError } from '@/shared/api/client';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../store/auth.store';
import { AuthLayout } from '../components/AuthLayout';

const schema = z
  .object({
    newPassword: passwordSchema,
    confirm: z.string(),
  })
  // Ô nhập lại chỉ tồn tại ở frontend — backend không cần biết.
  // Mục đích duy nhất: chặn người dùng gõ nhầm rồi mất quyền vào tài khoản.
  .refine((v) => v.newPassword === v.confirm, {
    message: 'Mật khẩu nhập lại không khớp',
    path: ['confirm'],
  });

const MESSAGES: Record<string, string> = {
  TOKEN_CONSUMED: 'Liên kết này đã được sử dụng. Hãy yêu cầu đặt lại mật khẩu lần nữa.',
  TOKEN_EXPIRED: 'Liên kết đã hết hạn. Hãy yêu cầu đặt lại mật khẩu lần nữa.',
  TOKEN_INVALID: 'Liên kết không hợp lệ.',
};

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const clear = useAuthStore((s) => s.clear);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: '', confirm: '' },
  });

  const reset = useMutation({
    mutationFn: (v: { newPassword: string }) =>
      authApi.resetPassword({ token, newPassword: v.newPassword }),
    onSuccess: () => {
      // Backend đã thu hồi MỌI phiên — phiên hiện tại (nếu có) cũng chết.
      // Xoá state local cho khớp, nếu không app tưởng vẫn đang đăng nhập.
      clear();
    },
  });

  if (!token) {
    return (
      <AuthLayout title="Đặt lại mật khẩu">
        <Alert>Liên kết thiếu mã xác thực.</Alert>
      </AuthLayout>
    );
  }

  if (reset.isSuccess) {
    return (
      <AuthLayout title="Đã đổi mật khẩu">
        <div className="flex flex-col gap-5">
          <Alert variant="success">
            Mật khẩu đã được đặt lại. Vì lý do bảo mật, bạn đã bị đăng xuất khỏi mọi thiết bị.
          </Alert>
          <Button onClick={() => void navigate('/login', { replace: true })} className="w-full">
            Đăng nhập lại
          </Button>
        </div>
      </AuthLayout>
    );
  }

  const code = reset.error instanceof ApiError ? reset.error.code : '';
  const serverError = reset.error
    ? (MESSAGES[code] ??
      (reset.error instanceof ApiError ? reset.error.message : 'Đã có lỗi xảy ra.'))
    : null;

  return (
    <AuthLayout title="Đặt lại mật khẩu">
      <form
        onSubmit={(e) =>
          void form.handleSubmit((v) => reset.mutate({ newPassword: v.newPassword }))(e)
        }
        className="flex flex-col gap-4"
        noValidate
      >
        {serverError && (
          <div className="flex flex-col gap-3">
            <Alert>{serverError}</Alert>
            <Link to="/forgot-password" className="text-sm text-white hover:underline">
              Yêu cầu liên kết mới &rarr;
            </Link>
          </div>
        )}

        <Field
          label="Mật khẩu mới"
          type="password"
          autoComplete="new-password"
          autoFocus
          hint="Tối thiểu 8 ký tự, có cả chữ và số"
          error={form.formState.errors.newPassword?.message}
          {...form.register('newPassword')}
        />

        <Field
          label="Nhập lại mật khẩu mới"
          type="password"
          autoComplete="new-password"
          error={form.formState.errors.confirm?.message}
          {...form.register('confirm')}
        />

        <Button type="submit" loading={reset.isPending} className="mt-2">
          Đặt lại mật khẩu
        </Button>
      </form>
    </AuthLayout>
  );
}
