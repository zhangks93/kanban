import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CliError, usage } from './errors';

export interface Credentials {
  server: string;
  accessToken: string;
  expiresAt: string;
}
export interface PendingAuthorization {
  server: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  interval: number;
  scopes: string[];
}
export type Environment = Record<string, string | undefined>;

export function normalizeServer(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return usage('Server must be an absolute HTTPS origin, e.g. https://work.example.com');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    usage(
      'Server must be an HTTPS origin without credentials, path, query or fragment; HTTP is allowed on loopback only',
    );
  return url.origin;
}

export function configFile(env: Environment) {
  const home = homedir();
  const base =
    env.WORK_CONFIG_DIR ??
    (process.platform === 'win32'
      ? join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'work')
      : join(env.XDG_CONFIG_HOME || join(home, '.config'), 'work'));
  const directory = resolve(base);
  if (directory === parse(directory).root || directory === resolve(home))
    throw new CliError('CONFIG_ERROR', 'WORK_CONFIG_DIR must be a dedicated directory', 6);
  return join(directory, 'credentials.json');
}

export async function readCredentials(env: Environment): Promise<Credentials | undefined> {
  const file = configFile(env);
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new CliError('CONFIG_ERROR', 'Credential file must be a regular file', 6);
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
      throw new CliError(
        'CONFIG_ERROR',
        'Credential file is accessible to other users; set its mode to 600',
        6,
      );
    const data = JSON.parse(await readFile(file, 'utf8')) as Partial<Credentials>;
    if (
      typeof data.server !== 'string' ||
      typeof data.accessToken !== 'string' ||
      !data.accessToken ||
      typeof data.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(data.expiresAt))
    )
      throw new CliError('CONFIG_ERROR', 'Credential file is invalid; sign in again', 6);
    return {
      server: normalizeServer(data.server),
      accessToken: data.accessToken,
      expiresAt: data.expiresAt,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof CliError) throw error;
    throw new CliError(
      'CONFIG_ERROR',
      'Unable to read credentials; inspect WORK_CONFIG_DIR or sign in again',
      6,
    );
  }
}

async function saveSecret(file: string, data: unknown) {
  const directory = dirname(file);
  const temporary = join(directory, `.credentials-${randomUUID()}.tmp`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new CliError('CONFIG_ERROR', 'Credential directory must be a regular directory', 6);
    await chmod(directory, 0o700);
    await writeFile(temporary, JSON.stringify(data) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
    await chmod(file, 0o600);
  } catch {
    throw new CliError('CONFIG_ERROR', 'Unable to securely save credentials', 6);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function saveCredentials(env: Environment, credentials: Credentials) {
  await saveSecret(configFile(env), credentials);
}

export const pendingFile = (env: Environment) => join(dirname(configFile(env)), 'pending.json');
export async function savePending(env: Environment, pending: PendingAuthorization) {
  await saveSecret(pendingFile(env), pending);
}
export async function readPending(env: Environment): Promise<PendingAuthorization | undefined> {
  try {
    const file = pendingFile(env);
    const stat = await lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
    )
      throw new CliError(
        'CONFIG_ERROR',
        'Pending authorization must be a regular file with mode 600',
        6,
      );
    const data = JSON.parse(await readFile(file, 'utf8')) as Partial<PendingAuthorization>;
    if (
      typeof data.server !== 'string' ||
      typeof data.deviceCode !== 'string' ||
      !data.deviceCode ||
      typeof data.userCode !== 'string' ||
      typeof data.verificationUri !== 'string' ||
      typeof data.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(data.expiresAt)) ||
      typeof data.interval !== 'number' ||
      data.interval < 1 ||
      data.interval > 60 ||
      !Array.isArray(data.scopes) ||
      data.scopes.some((scope) => scope !== 'read' && scope !== 'write')
    )
      throw new CliError('CONFIG_ERROR', 'Invalid pending authorization; start login again', 6);
    const server = normalizeServer(data.server);
    const verification = new URL(data.verificationUri);
    if (verification.origin !== server || verification.username || verification.password)
      throw new CliError('CONFIG_ERROR', 'Invalid pending authorization origin', 6);
    return { ...data, server } as PendingAuthorization;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof CliError) throw error;
    throw new CliError('CONFIG_ERROR', 'Unable to read pending authorization', 6);
  }
}
export async function clearPending(env: Environment) {
  try {
    await unlink(pendingFile(env));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new CliError('CONFIG_ERROR', 'Unable to clear pending authorization', 6);
  }
}

export async function clearCredentials(env: Environment) {
  try {
    await unlink(configFile(env));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new CliError('CONFIG_ERROR', 'Unable to remove credentials', 6);
  }
}
