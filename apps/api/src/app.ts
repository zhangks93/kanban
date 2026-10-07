import { requestContext } from './lib/request-context';
import { registerInbox } from './modules/inbox';
import * as Sentry from '@sentry/node';
import { buildRegistry, installedPlugins } from './plugins/registry';
import { registerPlugins } from './modules/plugins';
import { registerFocus } from './modules/focus';
import { registerBoards } from './modules/boards';
import { registerTasks } from './modules/tasks';
import { registerWorkLogs } from './modules/work-logs';
import { registerCollaboration } from './modules/collaboration';
import { registerAuthMiddleware } from './middleware/auth';
import { registerAuth } from './modules/auth';
import { registerWorkspaces } from './modules/workspaces';
import Fastify from 'fastify';
import { pool } from './lib/db';
import { AppError, databaseCode } from './lib/errors';
import { errorStatus, messages } from '@work/shared';
import { ZodError } from 'zod';
export async function buildApp(plugins = installedPlugins) {
  const registry = buildRegistry(plugins);
  const app = Fastify({
    logger:
      process.env.NODE_ENV === 'test'
        ? false
        : { redact: ['req.headers.cookie', 'req.headers.authorization'] },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });
  app.addHook('onRequest', (req, _reply, done) => {
    requestContext.run({ requestId: req.id }, done);
  });
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-request-id', req.id);
    return payload;
  });
  app.setErrorHandler((e, req, reply) => {
    const code =
      e instanceof AppError
        ? e.code
        : e instanceof ZodError
          ? 'VALIDATION_FAILED'
          : databaseCode(e);
    if (code)
      return reply.status(errorStatus[code]).send({
        error: {
          code,
          message: messages[code],
          detail: e instanceof AppError ? e.detail : undefined,
          requestId: req.id,
        },
      });
    req.log.error({ err: e }, 'request failed');
    Sentry.captureException(e);
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId: req.id } });
  });
  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  });
  await registerAuthMiddleware(app);
  await registerAuth(app);
  await registerWorkspaces(app);
  await registerBoards(app, registry.templates);
  await registerPlugins(app, registry);
  await registerTasks(app);
  await registerWorkLogs(app);
  await registerFocus(app);
  await registerInbox(app);
  await registerCollaboration(app);
  return app;
}
