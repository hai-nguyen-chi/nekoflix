import type { PublicProfile } from '@nekoflix/contracts';
import { api } from '@/shared/api/client';

export const profilesApi = {
  list: () => api.get<{ items: PublicProfile[]; remaining: number }>('/v1/profiles'),

  create: (body: { name: string; avatarKey?: string; isKid?: boolean; pin?: string }) =>
    api.post<{ profile: PublicProfile }>('/v1/profiles', body),

  update: (id: string, body: { name?: string; avatarKey?: string }) =>
    api.patch<{ profile: PublicProfile }>(`/v1/profiles/${id}`, body),

  remove: (id: string) => api.delete<{ deleted: boolean }>(`/v1/profiles/${id}`),

  select: (id: string, pin?: string) =>
    api.post<{ profile: PublicProfile; accessToken: string; expiresIn: number }>(
      `/v1/profiles/${id}/select`,
      pin ? { pin } : {},
    ),

  setPin: (id: string, pin: string) => api.put<{ ok: boolean }>(`/v1/profiles/${id}/pin`, { pin }),

  removePin: (id: string, password: string) =>
    api.delete<{ ok: boolean }>(`/v1/profiles/${id}/pin`, { password }),
};
