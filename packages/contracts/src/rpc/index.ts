import type { z } from 'zod';
import {
  createEchoRequest,
  createEchoResponse,
  listEchoesResponse,
  listReceivedResponse,
  pingRequest,
  pingResponse,
} from './ping';
import {
  getUserRequest,
  getUserResponse,
  listSessionsRequest,
  listSessionsResponse,
  loginRequest,
  loginResponse,
  logoutRequest,
  logoutResponse,
  refreshRequest,
  refreshResponse,
  registerRequest,
  registerResponse,
  verifyEmailRequest,
  verifyEmailResponse,
} from './identity';
import {
  createProfileRequest,
  deleteProfileRequest,
  deleteProfileResponse,
  listProfilesRequest,
  listProfilesResponse,
  okResponse,
  profileResponse,
  removePinRequest,
  selectProfileRequest,
  selectProfileResponse,
  setPinRequest,
  updateProfileRequest,
  verifyProfileRequest,
  verifyProfileResponse,
} from './profile';
import {
  listLinkedRequest,
  listLinkedResponse,
  oauthCallbackRequest,
  oauthCallbackResponse,
  oauthExchangeRequest,
  oauthExchangeResponse,
  oauthStartRequest,
  oauthStartResponse,
  unlinkRequest,
  unlinkResponse,
} from './oauth';
import {
  changePasswordRequest,
  changePasswordResponse,
  forgotPasswordRequest,
  forgotPasswordResponse,
  resetPasswordRequest,
  resetPasswordResponse,
} from './password';

export * from './ping';
export * from './identity';
export * from './profile';
export * from './oauth';
export * from './password';

const empty = { parse: (v: unknown) => v } as unknown as z.ZodType<Record<string, never>>;

/**
 * Nguồn sự thật cho mọi NATS request/reply.
 *
 * Key chính là NATS subject. Client typed trong service-kit dùng registry này
 * để suy ra kiểu request/response, nên gọi sai subject hoặc sai payload là
 * lỗi compile-time, không phải lỗi runtime lúc 2 giờ sáng.
 */
export const RPC_REGISTRY = {
  'ping.echo.ping': { request: pingRequest, response: pingResponse },
  'ping.echo.create': { request: createEchoRequest, response: createEchoResponse },
  'ping.echo.list': { request: empty, response: listEchoesResponse },
  'pong.received.list': { request: empty, response: listReceivedResponse },

  'identity.auth.register': { request: registerRequest, response: registerResponse },
  'identity.auth.login': { request: loginRequest, response: loginResponse },
  'identity.auth.refresh': { request: refreshRequest, response: refreshResponse },
  'identity.auth.logout': { request: logoutRequest, response: logoutResponse },
  'identity.auth.verifyEmail': { request: verifyEmailRequest, response: verifyEmailResponse },
  'identity.user.get': { request: getUserRequest, response: getUserResponse },
  'identity.session.list': { request: listSessionsRequest, response: listSessionsResponse },

  'identity.profile.list': { request: listProfilesRequest, response: listProfilesResponse },
  'identity.profile.create': { request: createProfileRequest, response: profileResponse },
  'identity.profile.update': { request: updateProfileRequest, response: profileResponse },
  'identity.profile.delete': { request: deleteProfileRequest, response: deleteProfileResponse },
  'identity.profile.select': { request: selectProfileRequest, response: selectProfileResponse },
  'identity.profile.setPin': { request: setPinRequest, response: okResponse },
  'identity.profile.removePin': { request: removePinRequest, response: okResponse },
  'identity.profile.verify': { request: verifyProfileRequest, response: verifyProfileResponse },

  'identity.oauth.start': { request: oauthStartRequest, response: oauthStartResponse },
  'identity.oauth.callback': { request: oauthCallbackRequest, response: oauthCallbackResponse },
  'identity.oauth.exchange': { request: oauthExchangeRequest, response: oauthExchangeResponse },
  'identity.oauth.listLinked': { request: listLinkedRequest, response: listLinkedResponse },
  'identity.oauth.unlink': { request: unlinkRequest, response: unlinkResponse },

  'identity.password.forgot': { request: forgotPasswordRequest, response: forgotPasswordResponse },
  'identity.password.reset': { request: resetPasswordRequest, response: resetPasswordResponse },
  'identity.password.change': { request: changePasswordRequest, response: changePasswordResponse },
} as const;

export type RpcRegistry = typeof RPC_REGISTRY;
export type RpcSubject = keyof RpcRegistry;

export type RpcRequest<T extends RpcSubject> = z.infer<RpcRegistry[T]['request']>;
export type RpcResponse<T extends RpcSubject> = z.infer<RpcRegistry[T]['response']>;

export const ALL_RPC_SUBJECTS = Object.keys(RPC_REGISTRY) as RpcSubject[];
