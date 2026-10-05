import helmet from 'helmet';
import { createService } from '@nekoflix/service-kit';

void createService({
  name: 'gateway',
  version: '0.1.0',
  moduleFactory: async () => (await import('./app.module')).AppModule,
  healthPort: Number(process.env.PORT ?? 4000),
  // Gateway KHÔNG phục vụ NATS request — nó chỉ gọi đi
  enableRpcServer: false,
  configure: (app) => {
    app.use(helmet());
    app.enableCors({
      origin: (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(','),
      credentials: true,
    });
  },
});
