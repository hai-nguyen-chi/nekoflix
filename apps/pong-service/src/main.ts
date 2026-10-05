import { createService } from '@nekoflix/service-kit';

void createService({
  name: 'pong-service',
  version: '0.1.0',
  moduleFactory: async () => (await import('./app.module')).AppModule,
  healthPort: Number(process.env.PORT ?? 4102),
});
