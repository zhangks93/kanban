// Standalone fake identity provider. Never registered on the application API.
import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
export function buildFakeFeishu() {
  const app = Fastify();
  const codes = new Map<string, string>();
  const tokens = new Map<string, string>();
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/authorize', async (req, reply) => {
    const q = req.query as { redirect_uri: string; state: string };
    const escaped = (s: string) =>
      s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    return reply
      .type('text/html')
      .send(
        `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><h1>本地飞书测试登录</h1><form action="/approve"><input type="hidden" name="redirect_uri" value="${escaped(q.redirect_uri)}"><input type="hidden" name="state" value="${escaped(q.state)}"><label>测试用户<select name="user"><option value="user_a">林知远 · user_a</option><option value="user_b">陈默 · user_b</option><option value="user_c">周宁 · user_c</option><option value="user_d">许晴 · user_d</option><option value="platform_admin">平台管理员</option><option value="new_user">首次登录用户</option></select></label><button type="submit">授权登录</button></form></body></html>`,
      );
  });
  app.get('/approve', async (req, reply) => {
    const q = req.query as { redirect_uri: string; state: string; user: string };
    const code = randomBytes(16).toString('hex');
    codes.set(code, q.user);
    setTimeout(() => codes.delete(code), 600000).unref();
    const url = new URL(q.redirect_uri);
    if (!['http://localhost:5173', 'http://localhost:3001'].includes(url.origin))
      return reply.code(422).send({ error: 'invalid redirect' });
    url.searchParams.set('code', code);
    url.searchParams.set('state', q.state);
    return reply.redirect(url.toString());
  });
  app.post('/open-apis/auth/v3/app_access_token/internal', async () => ({
    code: 0,
    app_access_token: 'fake-app-token',
  }));
  app.post('/open-apis/authen/v1/access_token', async (req, reply) => {
    const user = codes.get((req.body as { code: string }).code);
    if (!user) return reply.code(401).send({ code: 1 });
    codes.delete((req.body as { code: string }).code);
    const token = randomBytes(16).toString('hex');
    tokens.set(token, user);
    setTimeout(() => tokens.delete(token), 60000).unref();
    return { code: 0, data: { access_token: token } };
  });
  app.get('/open-apis/authen/v1/user_info', async (req, reply) => {
    const token = req.headers.authorization?.slice(7) ?? '';
    const user = tokens.get(token);
    if (!user) return reply.code(401).send({ code: 1 });
    tokens.delete(token);
    const names: Record<string, string> = {
      user_a: '林知远',
      user_b: '陈默',
      user_c: '周宁',
      user_d: '许晴',
      platform_admin: '平台管理员',
      new_user: '新用户',
    };
    return {
      code: 0,
      data: {
        open_id: user,
        user_id: user,
        name: names[user] ?? user,
        email: `${user}@example.test`,
      },
    };
  });
  return app;
}
