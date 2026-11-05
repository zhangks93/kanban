import { CliError, usage } from './errors';
import type { CliIO, Flags } from './types';

const safeFields = new Set([
  'id',
  'title',
  'version',
  'name',
  'key',
  'description_text',
  'board_id',
  'board_key',
  'board_name',
  'workspace_id',
  'workspace_key',
  'workspace_name',
  'seq',
  'responsible_id',
  'responsible_name',
  'state_id',
  'state_group',
  'lane_id',
  'type_id',
  'type_name',
  'priority',
  'start_date',
  'due_date',
  'estimate_days',
  'logged_hours',
  'milestone_id',
  'parent_id',
  'sort_key',
  'can_edit',
  'can_focus',
  'created_at',
  'updated_at',
  'status',
  'access_mode',
  'lane_mode',
  'template_key',
  'plugin_key',
  'display_name',
  'role',
  'wip_limit',
  'used_wip',
]);
export const entityFields = [...safeFields];
export const readFlags = ['format', 'fields'];
export interface ReadOptions {
  format: 'json' | 'ndjson' | 'table';
  fields?: string[];
}
export function readOptions(flags: Flags): ReadOptions {
  const format = flags.format ?? 'json';
  if (format !== 'json' && format !== 'ndjson' && format !== 'table')
    usage('--format must be json, ndjson, or table');
  let fields: string[] | undefined;
  if (flags.fields !== undefined) {
    fields = String(flags.fields).split(',');
    if (
      !fields.length ||
      fields.some((field) => !safeFields.has(field)) ||
      new Set(fields).size !== fields.length
    )
      usage(
        '--fields must be a comma-separated list of distinct supported entity fields; nested paths are not allowed',
      );
  }
  return { format, fields };
}
export function projectRow(value: unknown, fields?: string[]) {
  if (!fields || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(value, field))
      .map((field) => [field, (value as Record<string, unknown>)[field]]),
  );
}
export function projectData(value: unknown, fields?: string[]): unknown {
  if (!fields) return value;
  if (Array.isArray(value)) return value.map((row) => projectRow(row, fields));
  if (!value || typeof value !== 'object') return value;
  const data = value as Record<string, unknown>;
  if (Array.isArray(data.items))
    return { ...data, items: data.items.map((row) => projectRow(row, fields)) };
  if (data.board && typeof data.board === 'object')
    return { ...data, board: projectRow(data.board, fields) };
  if (data.user && typeof data.user === 'object')
    return { ...data, user: projectRow(data.user, fields) };
  return projectRow(value, fields);
}
export const jsonOutput = (io: CliIO, data: unknown) => io.stdout(JSON.stringify({ data }) + '\n');
export const recordOutput = (io: CliIO, record: unknown) =>
  io.stdout(JSON.stringify(record) + '\n');
function cell(value: unknown): string {
  const text =
    value === undefined || value === null
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return text.replace(/\p{Cc}/gu, ' ').replace(/\|/g, '\\|');
}
export function readOutput(io: CliIO, value: unknown, options: ReadOptions) {
  const data = projectData(value, options.fields);
  if (options.format === 'json') return jsonOutput(io, data);
  if (options.format === 'ndjson') {
    if (Array.isArray(data)) {
      for (const row of data) recordOutput(io, { type: 'row', data: row });
      recordOutput(io, { type: 'summary', itemsReturned: data.length });
    } else recordOutput(io, { type: 'data', data });
    return;
  }
  const object = data as Record<string, unknown> | null;
  const rows = Array.isArray(data)
    ? data
    : object && Array.isArray(object.items)
      ? object.items
      : [data];
  const fields =
    options.fields ??
    [
      ...new Set(
        rows.flatMap((row) => (row && typeof row === 'object' ? Object.keys(row) : ['value'])),
      ),
    ].slice(0, 8);
  io.stdout(fields.join(' | ') + '\n' + fields.map(() => '---').join(' | ') + '\n');
  for (const row of rows)
    io.stdout(
      fields
        .map((field) =>
          cell(row && typeof row === 'object' ? (row as Record<string, unknown>)[field] : row),
        )
        .join(' | ') + '\n',
    );
  if (object && !Array.isArray(data) && Object.hasOwn(object, 'nextCursor'))
    io.stdout(
      '# ' +
        JSON.stringify({
          nextCursor: object.nextCursor,
          ...(object.pagination ? { pagination: object.pagination } : {}),
        }) +
        '\n',
    );
}
export function errorOutput(io: CliIO, error: unknown) {
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
