import type { EventData, EventType } from './events';

/**
 * Payload mẫu chuẩn cho mỗi event.
 *
 * Vì sao nằm trong `contracts` chứ không nằm trong thư mục test của từng
 * service: producer và consumer phải dùng CÙNG một ví dụ. Mỗi bên tự bịa
 * fixture riêng thì hai bên trôi xa nhau dần mà test cả hai vẫn xanh —
 * đúng cái bẫy mà contract test sinh ra để tránh.
 *
 * Dùng ở:
 *  - contract test của consumer: dữ liệu đầu vào, không cần producer chạy
 *  - contract test của chính package này: mọi fixture phải parse được
 *
 * Giá trị phải THỰC TẾ: email đúng dạng, thời gian ISO, token trông như
 * token thật. Fixture kiểu `'x'` sẽ lọt qua schema nhưng không phát hiện
 * được lỗi khi consumer cắt chuỗi hay dựng URL.
 */
const T0 = '2026-01-15T08:30:00.000Z';

export const EVENT_FIXTURES: { [T in EventType]: EventData<T> } = {
  'identity.user.registered': {
    userId: '65a1f0c3e4b0a1d2c3e4b0a1',
    email: 'an.nguyen@example.com',
    displayName: 'An Nguyễn',
    verificationToken: 'xQ8vK3mZ9pL1nR5tY7wB2cF4hJ6kN0sD',
    verificationExpiresAt: '2026-01-16T08:30:00.000Z',
    registeredAt: T0,
  },

  'identity.user.verified': {
    userId: '65a1f0c3e4b0a1d2c3e4b0a1',
    email: 'an.nguyen@example.com',
    verifiedAt: T0,
  },

  'identity.user.logged_in': {
    userId: '65a1f0c3e4b0a1d2c3e4b0a1',
    email: 'an.nguyen@example.com',
    deviceLabel: 'Chrome trên Windows',
    ip: '203.0.113.42',
    isNewDevice: true,
    loggedInAt: T0,
  },

  'identity.security.alert': {
    userId: '65a1f0c3e4b0a1d2c3e4b0a1',
    email: 'an.nguyen@example.com',
    type: 'token_reuse_detected',
    ip: '203.0.113.42',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    detail: 'Refresh token đã dùng rồi lại được dùng tiếp.',
    occurredAt: T0,
  },

  'identity.profile.created': {
    profileId: '65a1f0c3e4b0a1d2c3e4b0b2',
    userId: '65a1f0c3e4b0a1d2c3e4b0a1',
    name: 'Bé Na',
    isKid: true,
    createdAt: T0,
  },

  'identity.profile.deleted': {
    profileId: '65a1f0c3e4b0a1d2c3e4b0b2',
    userId: '65a1f0c3e4b0a1d2c3e4b0a1',
    deletedAt: T0,
  },

  'identity.password.reset_requested': {
    userId: '65a1f0c3e4b0a1d2c3e4b0a1',
    email: 'an.nguyen@example.com',
    displayName: 'An Nguyễn',
    resetToken: 'rT4bN8mX2qW6zA0cE5gJ9kP3sV7yD1fH',
    expiresAt: '2026-01-15T09:30:00.000Z',
    ip: '203.0.113.42',
    requestedAt: T0,
  },
};

/** Lấy fixture kèm đúng kiểu — tránh `as` ở nơi gọi */
export function eventFixture<T extends EventType>(type: T): EventData<T> {
  return EVENT_FIXTURES[type];
}
