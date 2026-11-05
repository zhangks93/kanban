import { readFile } from 'node:fs/promises';
import { CliError, usage } from './errors';
import type { Flags, CliIO } from './types';
const booleanFlags = new Set(['write', 'yes', 'dry-run', 'help', 'no-wait', 'page-all']);
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
  'scope',
  'format',
  'fields',
  'page-limit',
]);
export function parse(argv: string[]) {
  const args: string[] = [];
  const flags: Flags = {};
  // Locate the command while skipping option values, so a global --server can
  // precede discovery without treating its value as a command or JSON input.
  let firstCommand: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '-h') continue;
    if (!value.startsWith('--')) {
      firstCommand = value;
      break;
    }
    const separator = value.indexOf('=');
    const key = value.slice(2, separator < 0 ? undefined : separator);
    if (separator < 0 && stringFlags.has(key)) index++;
  }
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
    if (booleanFlags.has(key) || (key === 'json' && firstCommand === 'commands')) {
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
export function allowed(flags: Flags, keys: string[]) {
  for (const key of Object.keys(flags))
    if (!['help', 'server', ...keys].includes(key))
      usage(`Option --${key} is not valid for this command`);
}
export function uuid(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    usage(`${label} must be a UUID`);
  return value;
}
export function positiveInteger(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER) {
  const number = typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1 || number > max)
    usage(`${label} must be an integer between 1 and ${max}`);
  return number;
}

export async function jsonBody(
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
