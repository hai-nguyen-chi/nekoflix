import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { passwordSchema } from '@nekoflix/contracts';
import { Alert } from '@/shared/components/Alert';
import { Button } from '@/shared/components/Button';
import { Field } from '@/shared/components/Field';
import { ApiError } from '@/shared/api/client';
import { authApi } from '@/features/auth/api/auth.api';

/**
 * Đổi mật khẩu — hoặc ĐẶT mật khẩu lần đầu với tài khoản tạo qua OAuth.
 *
 * Hai trường hợp khác nhau ở đúng một chỗ: có mật khẩu cũ để xác nhận hay
 * không. Backend đã xử lý cả hai (`currentPassword` là tuỳ chọn khi
 * `passwordHash === null`), nên ở đây chỉ cần đừng hỏi thứ người dùng
 * không thể trả lời.
 */
const schemaFor = (hasPassword: boolean) =>
  z
    .object({
      currentPassword: hasPassword
        ? z.string().min(1, 'Vui lòng nhập mật khẩu hiện tại')
        : z.string().optional(),
      newPassword: passwordSchema,
      confirm: z.string(),
    })
    .refine((v) => v.newPassword === v.confirm, {
      message: 'Mật khẩu nhập lại không khớp',
      path: ['confirm'],
    });

type FormValues = {
  currentPassword?: string;
  newPassword: string;
  confirm: string;
};

export function ChangePassword({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schemaFor(hasPassword)),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });

  const change = useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: () => form.reset(),
  });

  function close() {
    setOpen(false);
    change.reset();
    form.reset();
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{hasPassword ? 'Mật khẩu' : 'Chưa có mật khẩu'}</p>
          <p className="text-xs text-white/45">
            {hasPassword
              ? 'Đổi mật khẩu sẽ đăng xuất mọi thiết bị khác'
              : 'Tài khoản tạo qua mạng xã hội. Đặt mật khẩu để đăng nhập được cả bằng email.'}
          </p>
        </div>
        <Button
          variant="ghost"
          className="shrink-0 px-4 py-2 text-xs"
          onClick={() => setOpen(true)}
        >
          {hasPassword ? 'Đổi mật khẩu' : 'Đặt mật khẩu'}
        </Button>
      </div>
    );
  }

  if (change.isSuccess) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="success">
          {hasPassword ? 'Đã đổi mật khẩu.' : 'Đã đặt mật khẩu.'} Đã đăng xuất{' '}
          <strong>{change.data.revokedSessions}</strong> thiết bị khác. Thiết bị này vẫn đăng nhập.
        </Alert>
        <Button variant="ghost" onClick={close}>
          Xong
        </Button>
      </div>
    );
  }

  const serverError =
    change.error instanceof ApiError
      ? change.error.code === 'INVALID_CREDENTIALS'
        ? 'Mật khẩu hiện tại không đúng'
        : change.error.message
      : change.error
        ? 'Đã có lỗi xảy ra.'
        : null;

  return (
    <form
      onSubmit={(e) =>
        void form.handleSubmit((v) =>
          change.mutate({
            // Chuỗi rỗng khác undefined: backend coi '' là một lần thử sai,
            // còn undefined mới là "tài khoản này không có mật khẩu".
            ...(hasPassword ? { currentPassword: v.currentPassword } : {}),
            newPassword: v.newPassword,
          }),
        )(e)
      }
      className="flex flex-col gap-4"
      noValidate
    >
      {serverError && <Alert>{serverError}</Alert>}

      {hasPassword && (
        <Field
          label="Mật khẩu hiện tại"
          type="password"
          autoComplete="current-password"
          autoFocus
          error={form.formState.errors.currentPassword?.message}
          {...form.register('currentPassword')}
        />
      )}

      <Field
        label="Mật khẩu mới"
        type="password"
        autoComplete="new-password"
        autoFocus={!hasPassword}
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

      <div className="flex gap-3">
        <Button type="button" variant="ghost" className="flex-1" onClick={close}>
          Huỷ
        </Button>
        <Button type="submit" className="flex-1" loading={change.isPending}>
          {hasPassword ? 'Đổi mật khẩu' : 'Đặt mật khẩu'}
        </Button>
      </div>
    </form>
  );
}
