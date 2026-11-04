import { readFile } from 'node:fs/promises';
import {
  clearCredentials,
  normalizeServer,
  readCredentials,
  saveCredentials,
  type Environment,
} from './config';
import { CliError, usage } from './errors';
import { request, type Fetch } from './http';

const help = `Work CLI — human-authorized Agent access (Node.js 22.13+)

Usage:
  work auth login --server URL [--name NAME] [--write]
  work auth status
  work auth logout
  work schema
  work me
  work workspace
  work boards list
  work boards get BOARD_ID
  work tasks list [--board ID] [--q TEXT] [--state-group GROUP]
                  [--responsible-user ID] [--limit 1..100] [--cursor CURSOR]
  work tasks get TASK_ID
  work tasks create --board ID --json FILE|-|JSON [--dry-run]
  work tasks update TASK_ID --json FILE|-|JSON [--dry-run]
  work tasks delete TASK_ID --expected-version N --yes [--dry-run]

Create JSON requires a caller-generated clientMutationId UUID; reuse it for retries.
Update JSON requires expectedVersion from a fresh task read. Conflicts require rereading.
--dry-run validates locally and prints the request; it does not check server permissions.
Reads require human-approved read access; writes additionally require write access.
Use --server URL or WORK_SERVER to select an origin. WORK_TOKEN supplies an existing
human-approved token without writing it to disk. WORK_CONFIG_DIR selects the config
directory (default $XDG_CONFIG_HOME/work or ~/.config/work; Windows %APPDATA%/work).
Data goes to stdout as {"data":...}; errors go to stderr as {"error":...}.
Exit codes: 0 success; 2 usage; 3 authentication; 4 forbidden; 5 conflict;
6 network/config/response; 1 other server or authorization-flow failure.
`;

const booleanFlags = new Set(['write', 'yes', 'dry-run', 'help']);
const stringFlags = new Set([
  'server',
  'name',
  'board',
  'q',
  'state-group',
  'responsible-user',
  'limit',
  'cursor',
  'json',
  'expected-version',
]);
type Flags = Record<string, string | boolean>;
function parse(argv: string[]) {
  const args: string[] = [];
  const flags: Flags = {};
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '-h') {
      flags.help = true;
      continue;
    }
    if (!value.startsWith('--')) {
      if (value.startsWith('-')) usage(`Unknown option: ${value}`);
      args.push(value);
      continue;
    }
    const separator = value.indexOf('=');
    const key = value.slice(2, separator < 0 ? undefined : separator);
    if (key in flags) usage(`Duplicate option: --${key}`);
    if (booleanFlags.has(key)) {
      if (separator >= 0) usage(`--${key} does not accept a value`);
      flags[key] = true;
    } else if (stringFlags.has(key)) {
      const argument = separator >= 0 ? value.slice(separator + 1) : argv[++index];
      if (!argument || argument.startsWith('--')) usage(`--${key} requires a value`);
      flags[key] = argument;
    } else usage(`Unknown option: --${key}`);
  }
  return { args, flags };
}
function allowed(flags: Flags, keys: string[]) {
  for (const key of Object.keys(flags))
    if (!['help', 'server', ...keys].includes(key))
      usage(`Option --${key} is not valid for this command`);
}
function uuid(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    usage(`${label} must be a UUID`);
  return value;
}
function positiveInteger(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER) {
  const number = typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1 || number > max)
    usage(`${label} must be an integer between 1 and ${max}`);
  return number;
}

export interface CliIO {
  stdout(value: string): void;
  stderr(value: string): void;
  stdin(): Promise<string>;
  wait(milliseconds: number): Promise<void>;
  now(): number;
}
export const defaultIO: CliIO = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
  stdin: async () => {
    let data = '';
    for await (const chunk of process.stdin) {
      data += chunk.toString();
      if (Buffer.byteLength(data) > 1024 * 1024) usage('JSON input must not exceed 1 MiB');
    }
    return data;
  },
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: () => Date.now(),
};

async function jsonBody(
  value: string | boolean | undefined,
  io: CliIO,
): Promise<Record<string, unknown>> {
  if (typeof value !== 'string') usage('--json FILE|-|JSON is required');
  let input: string;
  try {
    input =
      value === '-'
        ? await io.stdin()
        : value.trimStart().startsWith('{')
          ? value
          : await readFile(value, 'utf8');
  } catch (error) {
    if (error instanceof CliError) throw error;
    return usage('Unable to read JSON input file');
  }
  if (Buffer.byteLength(input) > 1024 * 1024) usage('JSON input must not exceed 1 MiB');
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    return usage('JSON input is invalid');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    usage('JSON input must be an object');
  return data as Record<string, unknown>;
}

export async function runCli(
  argv: string[],
  io: CliIO = defaultIO,
  env: Environment = process.env,
  fetcher: Fetch = fetch,
): Promise<number> {
  const output = (data: unknown) => io.stdout(JSON.stringify({ data }) + '\n');
  try {
    const { args, flags } = parse(argv);
    if (flags.help || !args.length || args[0] === 'help') {
      io.stdout(help);
      return 0;
    }
    const command = args.join(' ');
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
      const value = flags.server || env.WORK_SERVER || (await config())?.server;
      if (typeof value !== 'string')
        usage('Select a server with --server URL, WORK_SERVER, or work auth login');
      return normalizeServer(value);
    };
    const authenticated = async () => {
      const origin = await server();
      if (env.WORK_TOKEN) return { origin, token: env.WORK_TOKEN, source: 'environment' };
      const saved = await config();
      if (!saved || saved.server !== origin)
        throw new CliError('UNAUTHENTICATED', 'Run work auth login for this server', 3);
      if (Date.parse(saved.expiresAt) <= io.now())
        throw new CliError(
          'UNAUTHENTICATED',
          'Authorization expired; run work auth login again',
          3,
        );
      return { origin, token: saved.accessToken, source: 'config' };
    };
    const api = async (path: string, method = 'GET', body?: unknown) => {
      const auth = await authenticated();
      return request(fetcher, auth.origin, path, { token: auth.token, method, body });
    };
    if (command === 'auth login') {
      allowed(flags, ['name', 'write']);
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
        throw new CliError(
          'INVALID_RESPONSE',
          'Verification URL must match the selected server',
          6,
        );
      io.stderr(
        JSON.stringify({
          authorization: {
            verificationUri: verification.toString(),
            userCode: device.userCode,
            scopes,
            expiresIn: device.expiresIn,
          },
        }) + '\n',
      );
      const deadline = io.now() + device.expiresIn * 1000;
      while (io.now() < deadline) {
        await io.wait(Math.min(device.interval * 1000, deadline - io.now()));
        if (io.now() >= deadline) break;
        const result = await request<{
          status: string;
          accessToken?: string;
          expiresAt?: string;
          authorization?: unknown;
        }>(fetcher, origin, '/api/agent/device/token', {
          method: 'POST',
          body: { deviceCode: device.deviceCode },
        });
        if (result.status === 'pending') continue;
        if (result.status === 'denied')
          throw new CliError('ACCESS_DENIED', 'Human authorization was denied');
        if (result.status === 'expired')
          throw new CliError(
            'AUTHORIZATION_EXPIRED',
            'Authorization request expired; start login again',
            3,
          );
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
          server: origin,
          accessToken: result.accessToken,
          expiresAt: result.expiresAt,
        });
        output({
          authorized: true,
          server: origin,
          expiresAt: result.expiresAt,
          authorization: result.authorization,
        });
        return 0;
      }
      throw new CliError(
        'AUTHORIZATION_EXPIRED',
        'Authorization request expired; start login again',
        3,
      );
    }
    if (command === 'auth status') {
      allowed(flags, []);
      const auth = await authenticated();
      output({
        server: auth.origin,
        source: auth.source,
        ...(await request<Record<string, unknown>>(fetcher, auth.origin, '/api/agent/v1/me', {
          token: auth.token,
        })),
      });
      return 0;
    }
    if (command === 'auth logout') {
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
      output({
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
      });
      return 0;
    }

    let path: string;
    let method = 'GET';
    let body: Record<string, unknown> | undefined;
    if (['schema', 'me', 'workspace'].includes(command)) {
      allowed(flags, []);
      path = `/api/agent/v1${command === 'schema' ? '' : `/${command}`}`;
    } else if (command === 'boards list') {
      allowed(flags, []);
      path = '/api/agent/v1/boards';
    } else if (args.length === 3 && args[0] === 'boards' && args[1] === 'get') {
      allowed(flags, []);
      path = `/api/agent/v1/boards/${uuid(args[2], 'BOARD_ID')}`;
    } else if (command === 'tasks list') {
      allowed(flags, ['board', 'q', 'state-group', 'responsible-user', 'limit', 'cursor']);
      const query = new URLSearchParams();
      if (flags.board) query.set('boardId', uuid(flags.board, '--board'));
      if (flags['responsible-user'])
        query.set('responsibleUserId', uuid(flags['responsible-user'], '--responsible-user'));
      if (flags.limit) query.set('limit', String(positiveInteger(flags.limit, '--limit', 100)));
      if (flags['state-group']) {
        const group = String(flags['state-group']);
        if (
          !['backlog', 'unstarted', 'started', 'waiting', 'completed', 'cancelled'].includes(group)
        )
          usage('Invalid --state-group');
        query.set('stateGroup', group);
      }
      if (flags.q) query.set('q', String(flags.q));
      if (flags.cursor) query.set('cursor', String(flags.cursor));
      path = `/api/agent/v1/tasks${query.size ? `?${query}` : ''}`;
    } else if (args.length === 3 && args[0] === 'tasks' && args[1] === 'get') {
      allowed(flags, []);
      path = `/api/agent/v1/tasks/${uuid(args[2], 'TASK_ID')}`;
    } else if (command === 'tasks create') {
      allowed(flags, ['board', 'json', 'dry-run']);
      path = `/api/agent/v1/boards/${uuid(flags.board, '--board')}/tasks`;
      body = await jsonBody(flags.json, io);
      uuid(body.clientMutationId, 'clientMutationId');
      if (typeof body.title !== 'string' || !body.title.trim())
        usage('Create JSON requires a title');
      uuid(body.responsibleUserId, 'responsibleUserId');
      method = 'POST';
    } else if (args.length === 3 && args[0] === 'tasks' && args[1] === 'update') {
      allowed(flags, ['json', 'dry-run']);
      path = `/api/agent/v1/tasks/${uuid(args[2], 'TASK_ID')}`;
      body = await jsonBody(flags.json, io);
      if (typeof body.expectedVersion !== 'number') usage('expectedVersion must be a JSON integer');
      positiveInteger(body.expectedVersion, 'expectedVersion');
      if (Object.keys(body).length < 2) usage('Update JSON must include a change');
      method = 'PATCH';
    } else if (args.length === 3 && args[0] === 'tasks' && args[1] === 'delete') {
      allowed(flags, ['expected-version', 'yes', 'dry-run']);
      path = `/api/agent/v1/tasks/${uuid(args[2], 'TASK_ID')}`;
      body = { expectedVersion: positiveInteger(flags['expected-version'], '--expected-version') };
      if (!flags.yes && !flags['dry-run'])
        usage('Deletion requires --yes after reviewing the intended task');
      method = 'DELETE';
    } else return usage(`Unknown command: ${command}. Run work --help`);
    if (flags['dry-run']) output({ dryRun: true, server: await server(), method, path, body });
    else output(await api(path, method, body));
    return 0;
  } catch (error) {
    const failure =
      error instanceof CliError ? error : new CliError('CLI_ERROR', 'Command failed', 1);
    io.stderr(
      JSON.stringify({
        error: {
          code: failure.code,
          message: failure.message,
          ...(failure.requestId ? { requestId: failure.requestId } : {}),
          ...(failure.detail === undefined ? {} : { detail: failure.detail }),
        },
      }) + '\n',
    );
    return failure.exitCode;
  }
}
