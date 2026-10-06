import { createService } from '@nekoflix/service-kit';

/**
 * `moduleFactory` là dynamic import có CHỦ ĐÍCH, không phải import ở đầu file.
 *
 * OpenTelemetry vá mongoose/http lúc `require`. Import AppModule ở trên cùng
 * nghĩa là mongoose đã vào cache của Node trước khi SDK kịp khởi động — trace
 * sẽ thiếu hẳn tầng database, im lặng, không báo lỗi gì.
 */
void createService({
  name: 'notification-service',
  version: '0.1.0',
  moduleFactory: async () => (await import('./app.module')).AppModule,
  healthPort: Number(process.env.PORT ?? 4007),
});
