import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ServiceKitModule } from '@nekoflix/service-kit';
import { AuthController } from './api/auth.controller';
import { ProfileController } from './api/profile.controller';
import { OAuthController } from './api/oauth.controller';
import { AuthService } from './application/auth.service';
import { ProfileService } from './application/profile.service';
import { OAuthService } from './application/oauth.service';
import { GoogleProvider } from './domain/providers/google.provider';
import { GitHubProvider } from './domain/providers/github.provider';
import { PasswordService } from './domain/password.service';
import { TokenService } from './domain/token.service';
import { User, UserSchema } from './persistence/schemas/user.schema';
import { Session, SessionSchema } from './persistence/schemas/session.schema';
import { Profile, ProfileSchema } from './persistence/schemas/profile.schema';
import {
  OAuthExchangeCode,
  OAuthExchangeCodeSchema,
  OAuthState,
  OAuthStateSchema,
} from './persistence/schemas/oauth-state.schema';
import {
  VerificationToken,
  VerificationTokenSchema,
} from './persistence/schemas/verification-token.schema';

@Module({
  imports: [
    ServiceKitModule.forRoot({
      name: 'identity-service',
      version: '0.1.0',
      database: 'nekoflix_identity',
      // Phát event: user.registered, user.logged_in, security.alert
      outbox: true,
      // Chưa nghe event nào. Phase 5 sẽ bật để nghe billing.subscription.*
      consumeEvents: false,
    }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema },
      { name: Profile.name, schema: ProfileSchema },
      { name: OAuthState.name, schema: OAuthStateSchema },
      { name: OAuthExchangeCode.name, schema: OAuthExchangeCodeSchema },
      { name: VerificationToken.name, schema: VerificationTokenSchema },
    ]),
  ],
  controllers: [AuthController, ProfileController, OAuthController],
  providers: [
    AuthService,
    ProfileService,
    OAuthService,
    PasswordService,
    TokenService,
    GoogleProvider,
    GitHubProvider,
  ],
})
export class AppModule {}
