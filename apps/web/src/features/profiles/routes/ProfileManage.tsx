import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { MAX_PROFILES_PER_USER } from '@nekoflix/contracts';
import { Alert } from '@/shared/components/Alert';
import { Button } from '@/shared/components/Button';
import { Field } from '@/shared/components/Field';
import { Spinner } from '@/shared/components/Spinner';
import { ApiError } from '@/shared/api/client';
import { profilesApi } from '../api/profiles.api';

export function ProfileManage() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [isKid, setIsKid] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const profiles = useQuery({ queryKey: ['profiles'], queryFn: profilesApi.list });

  // Mọi mutation đều invalidate cùng một key — danh sách luôn khớp server,
  // không phải tự sửa cache bằng tay rồi lệch.
  const invalidate = () => qc.invalidateQueries({ queryKey: ['profiles'] });

  const create = useMutation({
    mutationFn: profilesApi.create,
    onSuccess: () => {
      setName('');
      setIsKid(false);
      void invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: profilesApi.remove,
    onSuccess: () => {
      setConfirmDelete(null);
      void invalidate();
    },
  });

  if (profiles.isPending) return <Spinner label="Đang tải hồ sơ..." />;
  if (profiles.isError) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Alert>Không tải được danh sách hồ sơ.</Alert>
      </div>
    );
  }

  const errorOf = (e: unknown) =>
    e instanceof ApiError ? e.message : e ? 'Đã có lỗi xảy ra.' : null;
  const canAdd = profiles.data.remaining > 0;

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <Link to="/profiles" className="text-sm text-white/55 hover:text-white hover:underline">
        &larr; Quay lại chọn hồ sơ
      </Link>

      <h1 className="mt-5 mb-1 text-3xl font-bold">Quản lý hồ sơ</h1>
      <p className="mb-8 text-sm text-white/50">
        Đã dùng {profiles.data.items.length}/{MAX_PROFILES_PER_USER} hồ sơ
      </p>

      <ul className="mb-10 flex flex-col divide-y divide-white/10 rounded-lg bg-white/5">
        {profiles.data.items.map((p) => (
          <li key={p.id} className="flex items-center gap-4 p-4">
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded bg-white/15 text-lg font-bold"
            >
              {p.name.charAt(0).toUpperCase()}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.name}</p>
              <p className="text-xs text-white/45">
                {p.isKid ? `Trẻ em • tối đa ${p.maturityLimit}` : `Người lớn • ${p.maturityLimit}`}
                {p.hasPin && ' • có PIN'}
              </p>
            </div>

            {confirmDelete === p.id ? (
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="ghost"
                  className="px-3 py-2 text-xs"
                  onClick={() => setConfirmDelete(null)}
                >
                  Huỷ
                </Button>
                <Button
                  variant="danger"
                  className="px-3 py-2 text-xs"
                  loading={remove.isPending}
                  onClick={() => remove.mutate(p.id)}
                >
                  Xoá thật
                </Button>
              </div>
            ) : (
              <Button
                variant="danger"
                className="shrink-0 px-3 py-2 text-xs"
                onClick={() => {
                  remove.reset();
                  setConfirmDelete(p.id);
                }}
              >
                Xoá
              </Button>
            )}
          </li>
        ))}
      </ul>

      {remove.error && (
        <div className="mb-6">
          <Alert>{errorOf(remove.error)}</Alert>
        </div>
      )}

      <section className="rounded-lg bg-white/5 p-5">
        <h2 className="mb-4 text-lg font-semibold">Thêm hồ sơ mới</h2>

        {!canAdd ? (
          <Alert variant="info">
            Bạn đã dùng hết {MAX_PROFILES_PER_USER} hồ sơ. Xoá bớt một hồ sơ để thêm mới.
          </Alert>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({ name: name.trim(), isKid });
            }}
            className="flex flex-col gap-4"
          >
            {create.error && <Alert>{errorOf(create.error)}</Alert>}

            <Field
              label="Tên hồ sơ"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              placeholder="Vd: Bé Na"
            />

            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={isKid}
                onChange={(e) => setIsKid(e.target.checked)}
                className="mt-0.5 size-4 accent-[#e50914]"
              />
              <span>
                Hồ sơ trẻ em
                <span className="block text-xs text-white/45">
                  Chỉ xem được nội dung từ PG trở xuống. Không đổi được sau khi tạo.
                </span>
              </span>
            </label>

            <Button type="submit" loading={create.isPending} disabled={name.trim().length === 0}>
              Tạo hồ sơ
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
