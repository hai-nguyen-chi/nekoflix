import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import {
  changePasswordRequest,
  forgotPasswordRequest,
  resetPasswordRequest,
  type ChangePasswordResponse,
  type ForgotPasswordResponse,
  type ResetPasswordResponse,
} from '@nekoflix/contracts';
import { RpcData } from '@nekoflix/service-kit';
import { PasswordResetService } from '../application/password.service';

@Controller()
export class PasswordController {
  constructor(private readonly passwords: PasswordResetService) {}

  @MessagePattern('identity.password.forgot')
  forgot(@RpcData() raw: unknown): Promise<ForgotPasswordResponse> {
    return this.passwords.forgot(forgotPasswordRequest.parse(raw));
  }

  @MessagePattern('identity.password.reset')
  reset(@RpcData() raw: unknown): Promise<ResetPasswordResponse> {
    return this.passwords.reset(resetPasswordRequest.parse(raw));
  }

  @MessagePattern('identity.password.change')
  change(@RpcData() raw: unknown): Promise<ChangePasswordResponse> {
    return this.passwords.change(changePasswordRequest.parse(raw));
  }
}
