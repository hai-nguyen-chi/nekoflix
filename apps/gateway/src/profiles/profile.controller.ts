import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  createProfileRequest,
  removePinRequest,
  selectProfileRequest,
  setPinRequest,
  updateProfileRequest,
} from '@nekoflix/contracts';
import { RpcClient, zodPipe } from '@nekoflix/service-kit';
import { CurrentUser, type AuthUser } from '../auth/jwt.guard';

/**
 * Mọi route ở đây đều cần đăng nhập (guard toàn cục lo), và `userId` LUÔN
 * lấy từ access token đã ký — không bao giờ từ body hay URL.
 *
 * Nếu nhận userId từ client, ai cũng sửa được profile của người khác chỉ
 * bằng cách đổi một con số trong request.
 */
@Controller('v1/profiles')
export class ProfileController {
  constructor(private readonly rpc: RpcClient) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return { data: await this.rpc.request('identity.profile.list', { userId: user.userId }) };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(zodPipe(createProfileRequest.omit({ userId: true })))
    body: Omit<typeof createProfileRequest._output, 'userId'>,
  ) {
    const { profile } = await this.rpc.request('identity.profile.create', {
      ...body,
      userId: user.userId,
    });
    return { data: { profile } };
  }

  @Patch(':profileId')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('profileId') profileId: string,
    @Body(zodPipe(updateProfileRequest.omit({ userId: true, profileId: true })))
    body: Record<string, unknown>,
  ) {
    const { profile } = await this.rpc.request('identity.profile.update', {
      ...body,
      userId: user.userId,
      profileId,
    });
    return { data: { profile } };
  }

  @Delete(':profileId')
  async remove(@CurrentUser() user: AuthUser, @Param('profileId') profileId: string) {
    return {
      data: await this.rpc.request('identity.profile.delete', {
        userId: user.userId,
        profileId,
      }),
    };
  }

  /**
   * Chọn profile -> nhận access token MỚI có claim `pid`.
   *
   * Client phải THAY access token đang giữ bằng token này. Token cũ vẫn
   * hợp lệ nhưng không có profileId, nên các API cá nhân hoá sẽ từ chối.
   */
  @Post(':profileId/select')
  async select(
    @CurrentUser() user: AuthUser,
    @Param('profileId') profileId: string,
    @Body(zodPipe(selectProfileRequest.pick({ pin: true }))) body: { pin?: string },
  ) {
    return {
      data: await this.rpc.request('identity.profile.select', {
        userId: user.userId,
        sessionId: user.sessionId,
        profileId,
        ...(body.pin ? { pin: body.pin } : {}),
      }),
    };
  }

  @Put(':profileId/pin')
  async setPin(
    @CurrentUser() user: AuthUser,
    @Param('profileId') profileId: string,
    @Body(zodPipe(setPinRequest.pick({ pin: true }))) body: { pin: string },
  ) {
    return {
      data: await this.rpc.request('identity.profile.setPin', {
        userId: user.userId,
        profileId,
        pin: body.pin,
      }),
    };
  }

  @Delete(':profileId/pin')
  async removePin(
    @CurrentUser() user: AuthUser,
    @Param('profileId') profileId: string,
    @Body(zodPipe(removePinRequest.pick({ password: true }))) body: { password: string },
  ) {
    return {
      data: await this.rpc.request('identity.profile.removePin', {
        userId: user.userId,
        profileId,
        password: body.password,
      }),
    };
  }
}
