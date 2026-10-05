import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import {
  listLinkedRequest,
  oauthCallbackRequest,
  oauthExchangeRequest,
  oauthStartRequest,
  unlinkRequest,
  type ListLinkedResponse,
  type OAuthCallbackResponse,
  type OAuthExchangeResponse,
  type OAuthStartResponse,
  type UnlinkResponse,
} from '@nekoflix/contracts';
import { RpcData } from '@nekoflix/service-kit';
import { OAuthService } from '../application/oauth.service';

@Controller()
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @MessagePattern('identity.oauth.start')
  start(@RpcData() raw: unknown): Promise<OAuthStartResponse> {
    return this.oauth.start(oauthStartRequest.parse(raw));
  }

  @MessagePattern('identity.oauth.callback')
  callback(@RpcData() raw: unknown): Promise<OAuthCallbackResponse> {
    return this.oauth.callback(oauthCallbackRequest.parse(raw));
  }

  @MessagePattern('identity.oauth.exchange')
  exchange(@RpcData() raw: unknown): Promise<OAuthExchangeResponse> {
    return this.oauth.exchange(oauthExchangeRequest.parse(raw));
  }

  @MessagePattern('identity.oauth.listLinked')
  listLinked(@RpcData() raw: unknown): Promise<ListLinkedResponse> {
    return this.oauth.listLinked(listLinkedRequest.parse(raw).userId);
  }

  @MessagePattern('identity.oauth.unlink')
  unlink(@RpcData() raw: unknown): Promise<UnlinkResponse> {
    const { userId, provider } = unlinkRequest.parse(raw);
    return this.oauth.unlink(userId, provider);
  }
}
