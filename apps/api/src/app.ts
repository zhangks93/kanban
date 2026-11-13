import { requestContext } from './lib/request-context';
import { registerInbox } from './modules/inbox';
import * as Sentry from '@sentry/node';
import { buildRegistry, installedPlugins } from './plugins/registry';
import { registerPlugins } from './modules/plugins';
import { registerFocus } from './modules/focus';
import { registerBoards } from './modules/boards';
import { registerBoardSharing } from './modules/board-sharing';
import { registerFoundationData } from './modules/foundation-data';
import { registerTasks } from './modules/tasks';
import { registerWorkLogs } from './modules/work-logs';
import { registerCollaboration } from './modules/collaboration';
import { registerAuthMiddleware } from './middleware/auth';
import { registerAuth } from './modules/auth';
import { registerAgentAuth } from './modules/agent-auth';
import { registerAgentData } from './modules/agent-data';
import { registerWorkspaces } from './modules/workspaces';
import Fastify from 'fastify';
import { pool } from './lib/db';
import { AppError, databaseCode } from './lib/errors';
import { errorStatus, messages } from '@work/shared';
import { ZodError } from 'zod';
import { getCloudBaseConfig } from './lib/cloudbase-config';
import { cloudbaseRpc, CloudBaseError } from './lib/cloudbase';
import { registerCloudbase } from './modules/cloudbase';
import { recordCloudbaseFailure } from './lib/cloudbase-diagnostics';
export async function buildApp(plugins = installedPlugins) {
  const registry = buildRegistry(plugins);
  const app = Fastify({
    trustProxy:
      process.env.TRUSTED_PROXY_CIDRS?.split(',')
        .map((value) => value.trim())
        .filter(Boolean) ?? false,
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
  app.setErrorHandler(async (e, req, reply) => {
    if (e instanceof CloudBaseError) {
      if (e.code.startsWith('CLOUDBASE_')) {
        req.log.error({ code: e.code, upstream: e.upstream }, 'CloudBase request failed');
        await recordCloudbaseFailure(req.id, e).catch(() => {
          req.log.error('Could not save CloudBase diagnostics');
        });
      }
      const status =
        e.code === 'RATE_LIMITED' ? 429 : (errorStatus[e.code as keyof typeof errorStatus] ?? 503);
      return reply.status(status).send({
        error: {
          code: e.code,
          message:
            messages[e.code as keyof typeof messages] ??
            (e.code === 'RATE_LIMITED'
              ? '提交较频繁，请稍后再试'
              : 'CloudBase 数据服务暂时不可用，请检查服务端配置与初始化 SQL'),
          detail: e.detail ?? e.upstream,
          requestId: req.id,
        },
      });
    }
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
    if (getCloudBaseConfig()) await cloudbaseRpc({ method: 'GET', path: '/api/health' });
    else await pool.query('SELECT 1');
    return { status: 'ok' };
  });
  await registerAuthMiddleware(app);
  await registerAuth(app);
  if (getCloudBaseConfig()) {
    await registerCloudbase(app);
    return app;
  }
  await registerAgentAuth(app);
  await registerAgentData(app);
  await registerWorkspaces(app);
  await registerBoards(app, registry.templates);
  await registerBoardSharing(app);
  await registerFoundationData(app);
  await registerPlugins(app, registry);
  await registerTasks(app);
  await registerWorkLogs(app);
  await registerFocus(app);
  await registerInbox(app);
  await registerCollaboration(app);
  return app;
}
