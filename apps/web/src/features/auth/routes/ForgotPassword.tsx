import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import { z } from 'zod';
import { Alert } from '@/shared/components/Alert';
import { Button } from '@/shared/components/Button';
import { Field } from '@/shared/components/Field';
import { authApi } from '../api/auth.api';
import { AuthLayout } from '../components/AuthLayout';

const schema = z.object({
  email: z.string().min(1, 'Vui lòng nhập email').email('Email không hợp lệ'),
});

export function ForgotPassword() {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const forgot = useMutation({
    mutationFn: (v: { email: string }) => authApi.forgotPassword(v.email),
  });

  /**
   * Màn hình xác nhận KHÔNG nói "đã gửi email tới X".
   *
   * Backend cố ý trả cùng một kết quả dù email có tồn tại hay không, để
   * không ai dò được danh sách người dùng. Nếu giao diện lại khẳng định
   * "đã gửi", toàn bộ công sức đó thành vô ích.
   */
  if (forgot.isSuccess) {
    return (
      <AuthLayout title="Kiểm tra hộp thư">
        <div className="flex flex-col gap-5">
          <Alert variant="info">
            Nếu email <strong>{form.getValues('email')}</strong> có trong hệ thống, chúng tôi đã gửi
            liên kết đặt lại mật khẩu. Liên kết có hiệu lực trong 1 giờ.
          </Alert>
          <p className="text-sm text-white/55">
            Không thấy email? Kiểm tra thư mục spam, hoặc thử lại sau vài phút.
          </p>
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
    <AuthLayout title="Quên mật khẩu">
      <p className="mb-6 text-sm leading-relaxed text-white/60">
        Nhập email của bạn. Chúng tôi sẽ gửi liên kết để đặt lại mật khẩu.
      </p>

      <form
        onSubmit={(e) => void form.handleSubmit((v) => forgot.mutate(v))(e)}
        className="flex flex-col gap-4"
        noValidate
      >
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="ban@example.com"
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />
        <Button type="submit" loading={forgot.isPending} className="mt-2">
          Gửi liên kết đặt lại
        </Button>
      </form>

      <Link
        to="/login"
        className="mt-6 inline-block text-sm text-white/60 hover:text-white hover:underline"
      >
        &larr; Quay lại đăng nhập
      </Link>
    </AuthLayout>
  );
}
