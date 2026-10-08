import type { ListLinkedResponse, OAuthProvider } from '@nekoflix/contracts';
import { api } from '@/shared/api/client';

export const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: 'Google',
  github: 'GitHub',
};

export const oauthApi = {
  listLinked: () => api.get<ListLinkedResponse>('/v1/auth/oauth'),

  unlink: (provider: OAuthProvider) =>
    api.delete<{ unlinked: boolean }>(`/v1/auth/oauth/${provider}`),
};
