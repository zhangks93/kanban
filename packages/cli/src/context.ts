import { normalizeServer, readCredentials, readPending, type Environment } from './config';
import { CliError, usage } from './errors';
import { request, type Fetch } from './http';
import type { CliContext, CliIO, Flags } from './types';

export function createContext(
  flags: Flags,
  io: CliIO,
  env: Environment,
  fetcher: Fetch,
): CliContext {
  let credentials: Awaited<ReturnType<typeof readCredentials>>;
  let loaded = false;
  const config = async () => {
    if (!loaded) {
      credentials = await readCredentials(env);
      loaded = true;
    }
    return credentials;
  };
  const server = async () => {
    const value =
      flags.server ||
      env.WORK_SERVER ||
      (await config())?.server ||
      (await readPending(env))?.server;
    if (typeof value !== 'string')
      usage('Select a server with --server URL, WORK_SERVER, or work auth login');
    return normalizeServer(value);
  };
  const authenticated = async () => {
    const origin = await server();
    if (env.WORK_TOKEN) return { origin, token: env.WORK_TOKEN, source: 'environment' };
    const saved = await config();
    if (!saved || saved.server !== origin)
      throw new CliError('UNAUTHENTICATED', 'Run work auth login for this server', 3, undefined, {
        recovery: 'work auth login --server URL --no-wait',
      });
    if (Date.parse(saved.expiresAt) <= io.now())
      throw new CliError(
        'UNAUTHENTICATED',
        'Authorization expired; run work auth login again',
        3,
        undefined,
        { recovery: 'work auth login --server URL --no-wait' },
      );
    return { origin, token: saved.accessToken, source: 'config' };
  };
  const api = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    const auth = await authenticated();
    return request<T>(fetcher, auth.origin, path, { token: auth.token, method, body });
  };
  return { io, env, fetcher, server, authenticated, api };
}
