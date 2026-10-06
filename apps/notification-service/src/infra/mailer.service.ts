import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { getLogger } from '@nekoflix/service-kit';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class MailerService implements OnApplicationShutdown {
  private transporter?: Transporter;

  private get client(): Transporter {
    if (this.transporter) return this.transporter;

    const url = process.env.SMTP_URL ?? 'smtp://localhost:1025';

    // Mailpit ở local không có TLS. Production dùng smtps:// nên
    // nodemailer tự bật TLS từ scheme.
    //
    // Pool + rate limit: gửi chậm hơn nhưng không bị nhà cung cấp chặn
    // vì gửi dồn một lúc.
    const parsed = new URL(url);
    this.transporter = nodemailer.createTransport({
      host: parsed.hostname,
      port: Number(parsed.port) || (parsed.protocol === 'smtps:' ? 465 : 587),
      secure: parsed.protocol === 'smtps:',
      ...(parsed.username
        ? {
            auth: {
              user: decodeURIComponent(parsed.username),
              pass: decodeURIComponent(parsed.password),
            },
          }
        : {}),
      // Mailpit không yêu cầu xác thực; nodemailer mặc định đòi TLS
      // khi server quảng cáo STARTTLS -> tắt để chạy được ở local.
      ignoreTLS: parsed.protocol === 'smtp:',
      pool: true,
      maxConnections: 3,
      rateDelta: 1000,
      rateLimit: 10,
    });

    getLogger().info({ smtp: url.replace(/\/\/[^@]*@/, '//***@') }, 'mailer đã sẵn sàng');
    return this.transporter;
  }

  async send(email: OutgoingEmail): Promise<string> {
    const info = (await this.client.sendMail({
      from: process.env.MAIL_FROM ?? 'Nekoflix <no-reply@nekoflix.local>',
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    })) as { messageId: string };

    return info.messageId;
  }

  /** Kiểm tra kết nối SMTP — dùng cho /health/ready nếu cần */
  async verify(): Promise<boolean> {
    try {
      await this.client.verify();
      return true;
    } catch {
      return false;
    }
  }

  onApplicationShutdown(): void {
    this.transporter?.close();
  }
}
