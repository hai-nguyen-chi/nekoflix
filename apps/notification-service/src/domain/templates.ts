/**
 * Template email.
 *
 * Viết tay bằng chuỗi thay vì dùng thư viện template (Handlebars, MJML):
 * dự án có 5 email, và email HTML phải dùng `<table>` với inline CSS để
 * chạy được trên Outlook — thư viện template không giúp được chỗ khó đó,
 * chỉ thêm một bước build.
 *
 * Mỗi email trả CẢ html lẫn text. Thiếu bản text, nhiều bộ lọc thư rác
 * cho điểm trừ, và người đọc bằng trình đọc màn hình nhận được mớ thẻ HTML.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const BRAND = '#e50914';

function webOrigin(): string {
  return (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(',')[0]!;
}

function layout(opts: {
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  footer?: string;
}): string {
  const cta = opts.cta
    ? `<tr><td style="padding:8px 0 24px">
         <a href="${opts.cta.url}"
            style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;
                   padding:12px 28px;border-radius:4px;font-weight:600;font-size:15px">
           ${opts.cta.label}
         </a>
       </td></tr>
       <tr><td style="padding-bottom:24px;color:#777;font-size:13px;line-height:1.6">
         Nút không bấm được? Sao chép liên kết này vào trình duyệt:<br>
         <span style="color:#555;word-break:break-all">${opts.cta.url}</span>
       </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;
             font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4">
<tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:560px;background:#fff;border-radius:8px;overflow:hidden">
    <tr><td style="background:#141414;padding:20px 32px">
      <span style="color:${BRAND};font-size:22px;font-weight:800;letter-spacing:-0.5px">NEKOFLIX</span>
    </td></tr>
    <tr><td style="padding:32px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding-bottom:12px">
          <h1 style="margin:0;font-size:20px;color:#141414">${opts.heading}</h1>
        </td></tr>
        <tr><td style="padding-bottom:20px;color:#444;font-size:15px;line-height:1.7">
          ${opts.body}
        </td></tr>
        ${cta}
      </table>
    </td></tr>
    <tr><td style="background:#fafafa;padding:20px 32px;color:#999;font-size:12px;line-height:1.6;
                   border-top:1px solid #eee">
      ${opts.footer ?? 'Email tự động từ Nekoflix. Vui lòng không trả lời email này.'}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

// ─────────────────────────────────────────────────────────────────
export function welcomeEmail(p: { displayName: string; verificationToken: string }): RenderedEmail {
  const url = `${webOrigin()}/verify?token=${encodeURIComponent(p.verificationToken)}`;

  return {
    subject: 'Xác thực email Nekoflix của bạn',
    html: layout({
      heading: `Chào ${p.displayName}!`,
      body: `Cảm ơn bạn đã tạo tài khoản Nekoflix.
             <br><br>
             Hãy xác thực địa chỉ email để <strong>mở khoá tính năng xem phim</strong>.
             Liên kết có hiệu lực trong <strong>24 giờ</strong>.`,
      cta: { label: 'Xác thực email', url },
      footer: 'Nếu bạn không tạo tài khoản này, hãy bỏ qua email.',
    }),
    text: `Chào ${p.displayName}!

Cảm ơn bạn đã tạo tài khoản Nekoflix.
Xác thực email để mở khoá tính năng xem phim (liên kết có hiệu lực 24 giờ):

${url}

Nếu bạn không tạo tài khoản này, hãy bỏ qua email.`,
  };
}

export function emailVerifiedEmail(p: { email: string }): RenderedEmail {
  return {
    subject: 'Email đã được xác thực',
    html: layout({
      heading: 'Xác thực thành công',
      body: `Địa chỉ <strong>${p.email}</strong> đã được xác thực.
             Giờ bạn có thể xem phim trên Nekoflix.`,
      cta: { label: 'Bắt đầu xem', url: `${webOrigin()}/browse` },
    }),
    text: `Địa chỉ ${p.email} đã được xác thực. Giờ bạn có thể xem phim trên Nekoflix.

${webOrigin()}/browse`,
  };
}

export function newDeviceLoginEmail(p: {
  displayName: string;
  deviceLabel: string;
  ip: string;
  loggedInAt: string;
}): RenderedEmail {
  const when = formatTime(p.loggedInAt);

  return {
    subject: 'Đăng nhập từ thiết bị mới',
    html: layout({
      heading: 'Có đăng nhập mới vào tài khoản của bạn',
      body: `Chào ${p.displayName}, chúng tôi ghi nhận một lần đăng nhập từ thiết bị chưa từng dùng:
        <br><br>
        <table cellpadding="0" cellspacing="0" style="font-size:14px;color:#444">
          <tr><td style="padding:4px 16px 4px 0;color:#888">Thiết bị</td><td><strong>${p.deviceLabel}</strong></td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#888">Địa chỉ IP</td><td><strong>${p.ip || 'không rõ'}</strong></td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#888">Thời điểm</td><td><strong>${when}</strong></td></tr>
        </table>
        <br>
        <strong>Nếu đây là bạn</strong>, không cần làm gì cả.`,
      cta: { label: 'Xem các thiết bị đang đăng nhập', url: `${webOrigin()}/account/sessions` },
      footer: 'Nếu KHÔNG phải bạn: hãy đổi mật khẩu ngay và đăng xuất khỏi tất cả thiết bị.',
    }),
    text: `Chào ${p.displayName},

Có đăng nhập từ thiết bị mới vào tài khoản Nekoflix của bạn:
  Thiết bị : ${p.deviceLabel}
  IP       : ${p.ip || 'không rõ'}
  Thời điểm: ${when}

Nếu đây là bạn, không cần làm gì.
Nếu KHÔNG phải bạn, hãy đổi mật khẩu ngay: ${webOrigin()}/account/sessions`,
  };
}

const ALERT_TEXT: Record<string, { heading: string; body: string }> = {
  token_reuse_detected: {
    heading: 'Cảnh báo bảo mật nghiêm trọng',
    body: `Chúng tôi phát hiện một phiên đăng nhập của bạn bị sử dụng bất thường —
           dấu hiệu cho thấy ai đó có thể đã lấy được thông tin đăng nhập.
           <br><br>
           <strong>Toàn bộ phiên đăng nhập đã bị thu hồi để bảo vệ tài khoản.</strong>
           Bạn cần đăng nhập lại.`,
  },
  password_changed: {
    heading: 'Mật khẩu của bạn đã được thay đổi',
    body: `Mật khẩu tài khoản Nekoflix vừa được thay đổi.
           <br><br>
           Nếu bạn không thực hiện việc này, tài khoản có thể đã bị xâm nhập —
           hãy đặt lại mật khẩu ngay lập tức.`,
  },
  all_sessions_revoked: {
    heading: 'Đã đăng xuất khỏi mọi thiết bị',
    body: 'Toàn bộ phiên đăng nhập của tài khoản đã bị thu hồi theo yêu cầu.',
  },
};

export function securityAlertEmail(p: {
  type: string;
  detail: string;
  ip: string;
  occurredAt: string;
}): RenderedEmail {
  const t = ALERT_TEXT[p.type] ?? {
    heading: 'Cảnh báo bảo mật',
    body: 'Có một hoạt động bảo mật trên tài khoản của bạn.',
  };
  const when = formatTime(p.occurredAt);

  return {
    subject: `[Nekoflix] ${t.heading}`,
    html: layout({
      heading: t.heading,
      body: `${t.body}
        <br><br>
        <table cellpadding="0" cellspacing="0" style="font-size:14px;color:#444">
          <tr><td style="padding:4px 16px 4px 0;color:#888">Thời điểm</td><td><strong>${when}</strong></td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#888">Địa chỉ IP</td><td><strong>${p.ip || 'không rõ'}</strong></td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#888">Chi tiết</td><td>${p.detail}</td></tr>
        </table>`,
      cta: { label: 'Đặt lại mật khẩu', url: `${webOrigin()}/forgot-password` },
      footer: 'Nếu bạn không nhận ra hoạt động này, hãy đặt lại mật khẩu ngay.',
    }),
    text: `${t.heading}

${t.body
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ')
  .trim()}

Thời điểm: ${when}
IP       : ${p.ip || 'không rõ'}
Chi tiết : ${p.detail}

Đặt lại mật khẩu: ${webOrigin()}/forgot-password`,
  };
}

export function passwordResetEmail(p: {
  displayName: string;
  resetToken: string;
  ip: string;
}): RenderedEmail {
  const url = `${webOrigin()}/reset-password?token=${encodeURIComponent(p.resetToken)}`;

  return {
    subject: 'Đặt lại mật khẩu Nekoflix',
    html: layout({
      heading: 'Yêu cầu đặt lại mật khẩu',
      body: `Chào ${p.displayName}, có yêu cầu đặt lại mật khẩu cho tài khoản này
             (từ IP <strong>${p.ip || 'không rõ'}</strong>).
             <br><br>
             Liên kết có hiệu lực trong <strong>1 giờ</strong> và chỉ dùng được
             <strong>một lần</strong>.`,
      cta: { label: 'Đặt lại mật khẩu', url },
      footer: 'Nếu bạn không yêu cầu việc này, hãy bỏ qua email — mật khẩu hiện tại vẫn an toàn.',
    }),
    text: `Chào ${p.displayName},

Có yêu cầu đặt lại mật khẩu cho tài khoản Nekoflix (từ IP ${p.ip || 'không rõ'}).
Liên kết có hiệu lực 1 giờ và chỉ dùng được một lần:

${url}

Nếu bạn không yêu cầu việc này, hãy bỏ qua email — mật khẩu hiện tại vẫn an toàn.`,
  };
}
