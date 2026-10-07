import { validateEnvironment } from './lib/env';
import * as Sentry from '@sentry/node';
import { buildApp } from './app';
import { pool } from './lib/db';
validateEnvironment();
if (process.env.SENTRY_DSN) Sentry.init({ dsn: process.env.SENTRY_DSN });
const app = await buildApp();
app.addHook('onClose', async () => {
  await pool.end();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close();
  });
}
await app.listen({ host: '0.0.0.0', port: Number(process.env.API_PORT ?? 3001) });
