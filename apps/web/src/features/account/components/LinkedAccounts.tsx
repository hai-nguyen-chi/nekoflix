import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ListLinkedResponse, OAuthProvider } from '@nekoflix/contracts';
import { Alert } from '@/shared/components/Alert';
import { Button } from '@/shared/components/Button';
import { ApiError } from '@/shared/api/client';
import { PROVIDER_LABEL, oauthApi } from '@/features/auth/api/oauth.api';

const ALL_PROVIDERS: OAuthProvider[] = ['google', 'github'];

/**
 * Danh sách tài khoản mạng xã hội đã liên kết, và nút gỡ.
 *
 * CỐ Ý KHÔNG có nút "Liên kết thêm". Backend liên kết theo ĐỊA CHỈ EMAIL:
 * đăng nhập Google bằng một email khác email tài khoản hiện tại sẽ tạo ra
 * một tài khoản MỚI, chứ không gắn vào tài khoản đang mở. Một nút ghi
 * "Liên kết" mà kết quả là bị chuyển sang tài khoản khác thì tệ hơn là
 * không có nút.
 */
export function LinkedAccounts({ data }: { data: ListLinkedResponse }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<OAuthProvider | null>(null);

  const unlink = useMutation({
    mutationFn: oauthApi.unlink,
    onSuccess: () => {
      setConfirming(null);
      void qc.invalidateQueries({ queryKey: ['linked'] });
    },
  });

  const linkedOf = (p: OAuthProvider) => data.items.find((i) => i.provider === p);

  return (
    <div className="flex flex-col gap-3">
      {unlink.error && (
        <Alert>
          {unlink.error instanceof ApiError ? unlink.error.message : 'Không gỡ liên kết được.'}
        </Alert>
      )}

      <ul className="flex flex-col divide-y divide-white/10">
        {ALL_PROVIDERS.map((p) => {
          const linked = linkedOf(p);

          return (
            <li key={p} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{PROVIDER_LABEL[p]}</p>
                <p className="truncate text-xs text-white/45">
                  {linked ? linked.email : 'Chưa liên kết'}
                </p>
              </div>

              {linked && confirming === p && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="ghost"
                    className="px-3 py-2 text-xs"
                    onClick={() => setConfirming(null)}
                  >
                    Huỷ
                  </Button>
                  <Button
                    variant="danger"
                    className="px-3 py-2 text-xs"
                    loading={unlink.isPending}
                    onClick={() => unlink.mutate(p)}
                  >
                    Gỡ thật
                  </Button>
                </div>
              )}

              {linked && confirming !== p && (
                <Button
                  variant="danger"
                  className="shrink-0 px-3 py-2 text-xs"
                  // Gỡ nốt đường vào cuối cùng = tự khoá mình khỏi tài khoản.
                  // Backend chặn bằng lỗi CONFLICT; chặn sớm ở đây để người
                  // dùng không phải thử rồi mới biết.
                  disabled={!data.canUnlink}
                  onClick={() => {
                    unlink.reset();
                    setConfirming(p);
                  }}
                >
                  Gỡ
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {data.items.length === 0 ? (
        <p className="text-xs text-white/45">
          Để liên kết, hãy đăng xuất rồi đăng nhập bằng Google/GitHub{' '}
          <strong>với đúng email</strong> của tài khoản này. Email phải đã được xác thực.
        </p>
      ) : (
        !data.canUnlink && (
          <p className="text-xs text-white/45">
            Đây là cách duy nhất để vào tài khoản. Đặt mật khẩu ở trên thì mới gỡ được.
          </p>
        )
      )}
    </div>
  );
}
