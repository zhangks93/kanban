import {
  clearCredentials,
  readCredentials,
  saveCredentials,
  savePending,
  readPending,
  clearPending,
  type PendingAuthorization,
} from './config';
import { CliError, usage } from './errors';
import { request } from './http';
import { allowed } from './input';
import type { CliContext, Flags } from './types';

export async function runAuth(
  command: string,
  flags: Flags,
  context: CliContext,
): Promise<unknown> {
  const { env, fetcher, server } = context;
  const config = () => readCredentials(env);
  if (command === 'logout') {
    allowed(flags, []);
    const origin = await server();
    const saved = await config();
    const token = env.WORK_TOKEN || (saved?.server === origin ? saved.accessToken : undefined);
    let remoteStatus: 'revoked' | 'unavailable' | 'no-token' = 'no-token';
    if (token) {
      try {
        await request(fetcher, origin, '/api/agent/v1/authorization', {
          token,
          method: 'DELETE',
        });
        remoteStatus = 'revoked';
      } catch (error) {
        if (!(error instanceof CliError) || error.code !== 'UNAUTHENTICATED') throw error;
        remoteStatus = 'unavailable';
      }
    }
    const matchingSaved =
      saved?.server === origin && (!env.WORK_TOKEN || saved.accessToken === env.WORK_TOKEN);
    if (matchingSaved) await clearCredentials(env);
    const pending = await readPending(env);
    if (pending?.server === origin) await clearPending(env);
    return {
      loggedOut: true,
      server: origin,
      remoteStatus,
      ...(saved?.server === origin && !matchingSaved ? { savedCredentialsRetained: true } : {}),
      ...(remoteStatus === 'unavailable'
        ? {
            warning:
              'Remote revocation could not be confirmed; review and revoke the authorization in Agent access',
          }
        : {}),
      ...(env.WORK_TOKEN ? { note: 'Remove WORK_TOKEN from the caller environment' } : {}),
    };
  }

  return runOtherAuth(command, flags, context);
}

function safePending(pending: PendingAuthorization) {
  const { server, userCode, verificationUri, expiresAt, scopes } = pending;
  return { status: 'pending', server, userCode, verificationUri, expiresAt, scopes };
}
async function complete(pending: PendingAuthorization, context: CliContext) {
  const { io, env, fetcher } = context;
  const deadline = Date.parse(pending.expiresAt);
  while (io.now() < deadline) {
    await io.wait(Math.min(pending.interval * 1000, deadline - io.now()));
    if (io.now() >= deadline) break;
    const result = await request<{
      status: string;
      accessToken?: string;
      expiresAt?: string;
      authorization?: unknown;
    }>(fetcher, pending.server, '/api/agent/device/token', {
      method: 'POST',
      body: { deviceCode: pending.deviceCode },
    });
    if (result.status === 'pending') continue;
    if (result.status === 'denied' || result.status === 'expired') {
      await clearPending(env);
      throw new CliError(
        result.status === 'denied' ? 'ACCESS_DENIED' : 'AUTHORIZATION_EXPIRED',
        result.status === 'denied'
          ? 'Human authorization was denied'
          : 'Authorization request expired; start login again',
        result.status === 'denied' ? 1 : 3,
      );
    }
    if (
      result.status !== 'approved' ||
      typeof result.accessToken !== 'string' ||
      !result.accessToken ||
      typeof result.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(result.expiresAt)) ||
      Date.parse(result.expiresAt) <= io.now()
    )
      throw new CliError('INVALID_RESPONSE', 'Invalid authorization response', 6);
    await saveCredentials(env, {
      server: pending.server,
      accessToken: result.accessToken,
      expiresAt: result.expiresAt,
    });
    await clearPending(env);
    return {
      authorized: true,
      server: pending.server,
      expiresAt: result.expiresAt,
      authorization: result.authorization,
    };
  }
  await clearPending(env);
  throw new CliError(
    'AUTHORIZATION_EXPIRED',
    'Authorization request expired; start login again',
    3,
  );
}
async function runOtherAuth(command: string, flags: Flags, context: CliContext): Promise<unknown> {
  const { io, env, fetcher, server, authenticated } = context;
  if (command === 'login') {
    allowed(flags, ['name', 'write', 'no-wait']);
    const origin = await server();
    const clientName = flags.name ?? 'Work CLI';
    if (typeof clientName !== 'string' || !clientName.trim() || clientName.length > 100)
      usage('--name must contain 1 to 100 characters');
    const scopes = flags.write ? ['read', 'write'] : ['read'];
    const device = await request<{
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      expiresIn: number;
      interval: number;
    }>(fetcher, origin, '/api/agent/device', { method: 'POST', body: { clientName, scopes } });
    if (
      typeof device.deviceCode !== 'string' ||
      !device.deviceCode ||
      typeof device.userCode !== 'string' ||
      typeof device.verificationUri !== 'string' ||
      !Number.isFinite(device.expiresIn) ||
      device.expiresIn < 1 ||
      device.expiresIn > 600 ||
      !Number.isFinite(device.interval) ||
      device.interval < 1 ||
      device.interval > 60
    )
      throw new CliError('INVALID_RESPONSE', 'Invalid device authorization response', 6);
    let verification: URL;
    try {
      verification = new URL(device.verificationUri);
    } catch {
      throw new CliError('INVALID_RESPONSE', 'Invalid verification URL', 6);
    }
    if (verification.origin !== origin || verification.username || verification.password)
      throw new CliError('INVALID_RESPONSE', 'Verification URL must match the selected server', 6);
    const pending: PendingAuthorization = {
      server: origin,
      deviceCode: device.deviceCode,
      userCode: device.userCode,
      verificationUri: verification.toString(),
      expiresAt: new Date(io.now() + device.expiresIn * 1000).toISOString(),
      interval: device.interval,
      scopes,
    };
    await savePending(env, pending);
    if (flags['no-wait']) return safePending(pending);
    io.stderr(
      JSON.stringify({ authorization: { ...safePending(pending), expiresIn: device.expiresIn } }) +
        '\n',
    );
    return complete(pending, context);
  }
  if (command === 'complete') {
    allowed(flags, []);
    const pending = await readPending(env);
    if (!pending)
      throw new CliError(
        'UNAUTHENTICATED',
        'No pending authorization; run work auth login --no-wait',
        3,
      );
    if (pending.server !== (flags.server || env.WORK_SERVER ? await server() : pending.server))
      throw new CliError('UNAUTHENTICATED', 'Pending authorization belongs to another server', 3);
    return complete(pending, context);
  }
  if (command === 'status' || command === 'check') {
    allowed(flags, command === 'check' ? ['scope'] : []);
    const scope = flags.scope ?? 'read';
    if (scope !== 'read' && scope !== 'write') usage('--scope must be read or write');
    const auth = await authenticated();
    const me = await request<{
      user?: unknown;
      authorization?: { scopes?: string[]; [key: string]: unknown };
    }>(fetcher, auth.origin, '/api/agent/v1/me', { token: auth.token });
    if (command === 'status') return { server: auth.origin, source: auth.source, ...me };
    const granted = me.authorization?.scopes ?? [];
    const missing = granted.includes(scope) ? [] : [scope];
    const recovery = missing.length
      ? [
          `work auth login --server ${auth.origin}${scope === 'write' ? ' --write' : ''} --no-wait`,
          'Approve the request in the browser, then run work auth complete',
        ]
      : [];
    const detail = {
      server: auth.origin,
      granted,
      missing,
      recovery,
      authorization: me.authorization,
    };
    if (missing.length)
      throw new CliError(
        'FORBIDDEN',
        'Current authorization lacks the requested scope',
        4,
        undefined,
        detail,
      );
    return detail;
  }
  return usage(`Unknown auth command: ${command}`);
}
