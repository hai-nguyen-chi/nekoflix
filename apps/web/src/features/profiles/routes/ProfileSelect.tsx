import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import type { PublicProfile } from '@nekoflix/contracts';
import { Alert } from '@/shared/components/Alert';
import { Button } from '@/shared/components/Button';
import { Field } from '@/shared/components/Field';
import { Spinner } from '@/shared/components/Spinner';
import { ApiError } from '@/shared/api/client';
import { useAuthStore } from '@/features/auth/store/auth.store';
import { profilesApi } from '../api/profiles.api';

/** Màu avatar suy từ tên — tất định, nên mỗi profile luôn cùng một màu */
const AVATAR_COLORS = [
  'bg-red-600',
  'bg-blue-600',
  'bg-emerald-600',
  'bg-amber-500',
  'bg-violet-600',
  'bg-pink-600',
  'bg-cyan-600',
  'bg-orange-600',
];

function avatarColor(key: string): string {
  const n = [...key].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_COLORS[n % AVATAR_COLORS.length]!;
}

export function ProfileSelect() {
  const navigate = useNavigate();
  const setProfile = useAuthStore((s) => s.setProfile);
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const [pinFor, setPinFor] = useState<PublicProfile | null>(null);
  const [pin, setPin] = useState('');

  const profiles = useQuery({
    queryKey: ['profiles'],
    queryFn: profilesApi.list,
  });

  const select = useMutation({
    mutationFn: ({ id, pin }: { id: string; pin?: string }) => profilesApi.select(id, pin),
    onSuccess: (data) => {
      // Access token MỚI có claim pid. Phải thay token đang giữ, nếu không
      // mọi API cá nhân hoá vẫn thấy một phiên chưa chọn profile.
      setAccessToken(data.accessToken);
      setProfile(data.profile);
      void navigate('/browse', { replace: true });
    },
  });

  function onPick(profile: PublicProfile) {
    if (profile.hasPin) {
      setPin('');
      setPinFor(profile);
      select.reset();
      return;
    }
    select.mutate({ id: profile.id });
  }

  if (profiles.isPending) return <Spinner label="Đang tải hồ sơ..." />;

  if (profiles.isError) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Alert>Không tải được danh sách hồ sơ. Vui lòng tải lại trang.</Alert>
      </div>
    );
  }

  const pinError =
    select.error instanceof ApiError
      ? select.error.code === 'INVALID_CREDENTIALS'
        ? 'Mã PIN không đúng'
        : select.error.message
      : null;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-16">
      <h1 className="mb-10 text-center text-3xl font-bold sm:text-4xl">Ai đang xem?</h1>

      <ul className="flex flex-wrap justify-center gap-6">
        {profiles.data.items.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => onPick(p)}
              disabled={select.isPending}
              className="group flex w-28 flex-col items-center gap-3 disabled:opacity-50 sm:w-32"
            >
              <span
                aria-hidden
                className={`flex size-28 items-center justify-center rounded-md text-4xl font-bold text-white/90 transition-all group-hover:ring-4 group-hover:ring-white sm:size-32 ${avatarColor(p.avatarKey)}`}
              >
                {p.name.charAt(0).toUpperCase()}
              </span>
              <span className="flex items-center gap-1.5 text-sm text-white/70 transition-colors group-hover:text-white">
                {p.name}
                {p.isKid && (
                  <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                    Trẻ em
                  </span>
                )}
                {p.hasPin && <span aria-label="Có mã PIN">🔒</span>}
              </span>
            </button>
          </li>
        ))}

        {profiles.data.remaining > 0 && (
          <li>
            <Link
              to="/profiles/manage"
              className="group flex w-28 flex-col items-center gap-3 sm:w-32"
            >
              <span
                aria-hidden
                className="flex size-28 items-center justify-center rounded-md border-2 border-dashed border-white/25 text-4xl text-white/40 transition-colors group-hover:border-white/60 group-hover:text-white/70 sm:size-32"
              >
                +
              </span>
              <span className="text-sm text-white/50 transition-colors group-hover:text-white">
                Thêm hồ sơ
              </span>
            </Link>
          </li>
        )}
      </ul>

      <Link
        to="/profiles/manage"
        className="mt-12 rounded border border-white/30 px-6 py-2 text-sm tracking-wide text-white/60 transition-colors hover:border-white hover:text-white"
      >
        Quản lý hồ sơ
      </Link>

      {/* Hộp thoại nhập PIN */}
      {pinFor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pin-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-5"
        >
          <div className="w-full max-w-sm rounded-lg bg-ink-soft p-6">
            <h2 id="pin-title" className="mb-2 text-xl font-bold">
              Nhập mã PIN
            </h2>
            <p className="mb-5 text-sm text-white/55">
              Hồ sơ <strong>{pinFor.name}</strong> được bảo vệ bằng mã PIN.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                select.mutate({ id: pinFor.id, pin });
              }}
              className="flex flex-col gap-4"
            >
              <Field
                label="Mã PIN (4 số)"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                error={pinError ?? undefined}
                className="text-center text-2xl tracking-[0.5em]"
              />
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => setPinFor(null)}
                >
                  Huỷ
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  loading={select.isPending}
                  disabled={pin.length !== 4}
                >
                  Xác nhận
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
