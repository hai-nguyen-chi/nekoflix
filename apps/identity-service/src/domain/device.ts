import { createHash } from 'node:crypto';

/**
 * Đặt tên thiết bị cho dễ đọc, vd "Chrome trên Windows".
 *
 * Cố ý KHÔNG dùng thư viện parse User-Agent: ta chỉ cần một nhãn hiển thị
 * trong trang "thiết bị đang đăng nhập", không cần phân tích chính xác.
 * Thêm một dependency 2MB cho việc này là không đáng.
 */
export function deviceLabel(userAgent: string): string {
  if (!userAgent) return 'Thiết bị không xác định';

  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl\//i.test(ua)
              ? 'curl'
              : /PostmanRuntime/i.test(ua)
                ? 'Postman'
                : 'Trình duyệt khác';

  const os = /Windows NT/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;

  return os ? `${browser} trên ${os}` : browser;
}

/**
 * Vân tay thiết bị để nhận biết "đăng nhập từ thiết bị mới".
 *
 * Chỉ lưu hash, không lưu User-Agent thô: nhãn thiết bị là thông tin định
 * danh, không cần tích trữ nguyên văn khi chỉ dùng để so khớp.
 *
 * KHÔNG trộn IP vào: IP động đổi liên tục, trộn vào thì lần nào cũng báo
 * "thiết bị mới" và cảnh báo mất hết ý nghĩa.
 */
export function deviceFingerprint(userAgent: string): string {
  return createHash('sha256')
    .update(userAgent || 'unknown')
    .digest('hex')
    .slice(0, 32);
}
