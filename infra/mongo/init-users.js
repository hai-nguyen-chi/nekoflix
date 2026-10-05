/**
 * Tạo một DB user cho mỗi service.
 *
 * Mỗi user CHỈ có quyền readWrite trên đúng database của service mình.
 * Đây là cơ chế ép ranh giới service ở tầng hạ tầng (ADR-012):
 * nếu activity-service lỡ tay đọc nekoflix_catalog, MongoDB trả
 *   "not authorized on nekoflix_catalog to execute command find"
 * — vi phạm ranh giới thành lỗi runtime ngay lập tức, không thể lỡ tay.
 *
 * Chạy tự động bởi container `mongo-init` trong docker-compose.
 * Idempotent: chạy lại nhiều lần không lỗi.
 */

const SERVICES = [
  'identity',
  'catalog',
  'media',
  'activity',
  'realtime',
  'billing',
  'notification',
  'reco',
  // Service tạm của Phase 0 — xóa khi sang Phase 1
  'ping',
  'pong',
];

const password = globalThis.SERVICE_DB_PASSWORD || 'devpassword';
const admin = db.getSiblingDB('admin');

for (const svc of SERVICES) {
  const username = `${svc}_svc`;
  const database = `nekoflix_${svc}`;

  const exists = admin.getUser(username);
  if (exists) {
    print(`  = ${username} đã tồn tại, bỏ qua`);
    continue;
  }

  admin.createUser({
    user: username,
    pwd: password,
    roles: [{ role: 'readWrite', db: database }],
  });
  print(`  + ${username} -> ${database}`);
}

print(`\nĐã cấu hình ${SERVICES.length} DB user.`);
