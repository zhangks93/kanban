import * as Sentry from '@sentry/node';
import { buildApp } from './app';
if (process.env.SENTRY_DSN) Sentry.init({ dsn: process.env.SENTRY_DSN });
const app = await buildApp();
await app.listen({ host: '0.0.0.0', port: Number(process.env.API_PORT ?? 3001) });
