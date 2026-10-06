import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import type {
  EventEnvelope,
  PasswordResetRequestedV1,
  SecurityAlertV1,
  UserLoggedInV1,
  UserRegisteredV1,
  UserVerifiedV1,
} from '@nekoflix/contracts';
import { OnEvent, getLogger } from '@nekoflix/service-kit';
import { EmailOutbox } from '../persistence/schemas/email-outbox.schema';
import { Notification, type NotificationType } from '../persistence/schemas/notification.schema';
import {
  emailVerifiedEmail,
  newDeviceLoginEmail,
  passwordResetEmail,
  securityAlertEmail,
  welcomeEmail,
  type RenderedEmail,
} from '../domain/templates';

/**
 * Consumer của mọi event từ identity-service.
 *
 * Service này KHÔNG gọi ngược về identity để lấy email hay tên — mọi thứ
 * cần đã nằm trong payload event. Nhờ vậy identity có chết thì email vẫn
 * gửi được bình thường.
 *
 * Handler chạy TRONG transaction do IdempotencyService mở, và phải ghi qua
 * `session` được truyền vào. Email KHÔNG gửi ở đây — chỉ ghi vào hàng đợi,
 * relay riêng lo gửi (xem email-outbox.schema.ts).
 */
@Injectable()
export class IdentityHandlers {
  constructor(
    @InjectModel(EmailOutbox.name) private readonly emails: Model<EmailOutbox>,
    @InjectModel(Notification.name) private readonly notifications: Model<Notification>,
  ) {}

  @OnEvent('identity.user.registered')
  async onRegistered(
    event: EventEnvelope<UserRegisteredV1>,
    session: ClientSession,
  ): Promise<void> {
    const d = event.data;

    await this.notify(session, d.userId, 'welcome', {
      title: 'Chào mừng đến với Nekoflix',
      body: `Xin chào ${d.displayName}! Hãy xác thực email để bắt đầu xem phim.`,
    });

    // Tài khoản tạo qua OAuth đã được nhà cung cấp xác thực email ->
    // identity gửi token rỗng, không cần email xác thực.
    if (!d.verificationToken) {
      getLogger().debug({ userId: d.userId }, 'đăng ký qua OAuth, bỏ qua email xác thực');
      return;
    }

    await this.queueEmail(
      session,
      event.id,
      d.email,
      'welcome',
      welcomeEmail({ displayName: d.displayName, verificationToken: d.verificationToken }),
    );
  }

  @OnEvent('identity.user.verified')
  async onVerified(event: EventEnvelope<UserVerifiedV1>, session: ClientSession): Promise<void> {
    const d = event.data;

    await this.notify(session, d.userId, 'email_verified', {
      title: 'Email đã được xác thực',
      body: 'Bạn đã có thể xem phim trên Nekoflix.',
    });

    await this.queueEmail(
      session,
      event.id,
      d.email,
      'email_verified',
      emailVerifiedEmail({ email: d.email }),
    );
  }

  @OnEvent('identity.user.logged_in')
  async onLoggedIn(event: EventEnvelope<UserLoggedInV1>, session: ClientSession): Promise<void> {
    const d = event.data;

    // CHỈ cảnh báo khi thiết bị lạ. Gửi email mỗi lần đăng nhập sẽ làm
    // người dùng quen tay bỏ qua, và cảnh báo thật mất tác dụng.
    if (!d.isNewDevice) return;

    await this.notify(session, d.userId, 'new_device_login', {
      title: 'Đăng nhập từ thiết bị mới',
      body: `${d.deviceLabel} • ${d.ip || 'IP không rõ'}`,
      data: { deviceLabel: d.deviceLabel, ip: d.ip },
    });

    await this.queueEmail(
      session,
      event.id,
      d.email,
      'new_device_login',
      newDeviceLoginEmail({
        displayName: d.email.split('@')[0] ?? 'bạn',
        deviceLabel: d.deviceLabel,
        ip: d.ip,
        loggedInAt: d.loggedInAt,
      }),
    );
  }

  @OnEvent('identity.security.alert')
  async onSecurityAlert(
    event: EventEnvelope<SecurityAlertV1>,
    session: ClientSession,
  ): Promise<void> {
    const d = event.data;

    await this.notify(session, d.userId, 'security_alert', {
      title: 'Cảnh báo bảo mật',
      body: d.detail,
      data: { type: d.type, ip: d.ip },
    });

    await this.queueEmail(
      session,
      event.id,
      d.email,
      `security_${d.type}`,
      securityAlertEmail({ type: d.type, detail: d.detail, ip: d.ip, occurredAt: d.occurredAt }),
    );
  }

  @OnEvent('identity.password.reset_requested')
  async onPasswordReset(
    event: EventEnvelope<PasswordResetRequestedV1>,
    session: ClientSession,
  ): Promise<void> {
    const d = event.data;

    // KHÔNG tạo thông báo in-app cho việc này: người yêu cầu đặt lại mật
    // khẩu thường không đăng nhập được, nên sẽ không bao giờ thấy nó.
    await this.queueEmail(
      session,
      event.id,
      d.email,
      'password_reset',
      passwordResetEmail({
        displayName: d.displayName,
        resetToken: d.resetToken,
        ip: d.ip,
      }),
    );
  }

  // ───────────────────────────────────────────────────────────────
  private async notify(
    session: ClientSession,
    userId: string,
    type: NotificationType,
    content: { title: string; body: string; data?: Record<string, unknown> },
  ): Promise<void> {
    await this.notifications.create(
      [{ userId, type, title: content.title, body: content.body, data: content.data ?? {} }],
      { session },
    );
  }

  /**
   * Đưa email vào hàng đợi — KHÔNG gửi ở đây.
   *
   * `eventId` unique: event bị giao lại không tạo thêm email thứ hai.
   */
  private async queueEmail(
    session: ClientSession,
    eventId: string,
    to: string,
    template: string,
    rendered: RenderedEmail,
  ): Promise<void> {
    await this.emails.create(
      [
        {
          eventId,
          to,
          template,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          status: 'pending',
        },
      ],
      { session },
    );
  }
}
