import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import {
  createProfileRequest,
  deleteProfileRequest,
  listProfilesRequest,
  removePinRequest,
  selectProfileRequest,
  setPinRequest,
  updateProfileRequest,
  verifyProfileRequest,
  type DeleteProfileResponse,
  type ListProfilesResponse,
  type OkResponse,
  type ProfileResponse,
  type SelectProfileResponse,
  type VerifyProfileResponse,
} from '@nekoflix/contracts';
import { RpcData } from '@nekoflix/service-kit';
import { ProfileService } from '../application/profile.service';

@Controller()
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @MessagePattern('identity.profile.list')
  list(@RpcData() raw: unknown): Promise<ListProfilesResponse> {
    return this.profiles.list(listProfilesRequest.parse(raw).userId);
  }

  @MessagePattern('identity.profile.create')
  create(@RpcData() raw: unknown): Promise<ProfileResponse> {
    return this.profiles.create(createProfileRequest.parse(raw));
  }

  @MessagePattern('identity.profile.update')
  update(@RpcData() raw: unknown): Promise<ProfileResponse> {
    return this.profiles.update(updateProfileRequest.parse(raw));
  }

  @MessagePattern('identity.profile.delete')
  remove(@RpcData() raw: unknown): Promise<DeleteProfileResponse> {
    const { userId, profileId } = deleteProfileRequest.parse(raw);
    return this.profiles.remove(userId, profileId);
  }

  @MessagePattern('identity.profile.select')
  select(@RpcData() raw: unknown): Promise<SelectProfileResponse> {
    return this.profiles.select(selectProfileRequest.parse(raw));
  }

  @MessagePattern('identity.profile.setPin')
  setPin(@RpcData() raw: unknown): Promise<OkResponse> {
    const { userId, profileId, pin } = setPinRequest.parse(raw);
    return this.profiles.setPin(userId, profileId, pin);
  }

  @MessagePattern('identity.profile.removePin')
  removePin(@RpcData() raw: unknown): Promise<OkResponse> {
    const { userId, profileId, password } = removePinRequest.parse(raw);
    return this.profiles.removePin(userId, profileId, password);
  }

  @MessagePattern('identity.profile.verify')
  verify(@RpcData() raw: unknown): Promise<VerifyProfileResponse> {
    const { userId, profileId } = verifyProfileRequest.parse(raw);
    return this.profiles.verify(userId, profileId);
  }
}
