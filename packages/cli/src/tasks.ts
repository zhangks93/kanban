import { CliError, usage } from './errors';
import { allowed, jsonBody, positiveInteger, uuid } from './input';
import { projectRow, readFlags, readOptions, readOutput, recordOutput } from './output';
import type { CliContext, Flags } from './types';

const filters = ['board', 'q', 'state-group', 'responsible-user', 'limit', 'cursor'];
interface Page {
  items: unknown[];
  nextCursor: string | null;
}
export async function taskCommand(
  args: string[],
  flags: Flags,
  context: CliContext,
): Promise<void> {
  const { io } = context;
  const command = args[1];
  if (args.length === 2 && (command === 'list' || command === '+mine')) {
    allowed(flags, [...filters, ...readFlags, 'page-all', 'page-limit']);
    const options = readOptions(flags);
    if (flags['page-limit'] && !flags['page-all']) usage('--page-limit requires --page-all');
    const pageLimit = flags['page-all']
      ? positiveInteger(flags['page-limit'] ?? 10, '--page-limit', 100)
      : 1;
    const query = new URLSearchParams();
    if (flags.board) query.set('boardId', uuid(flags.board, '--board'));
    if (flags.limit) query.set('limit', String(positiveInteger(flags.limit, '--limit', 100)));
    if (flags['responsible-user'])
      query.set('responsibleUserId', uuid(flags['responsible-user'], '--responsible-user'));
    if (command === '+mine') {
      if (flags['responsible-user'])
        usage('tasks +mine determines --responsible-user from the current identity');
      const me = await context.api<{ user: { id: string } }>('/api/agent/v1/me');
      query.set('responsibleUserId', uuid(me.user?.id, 'Current user ID'));
    }
    if (flags['state-group']) {
      const group = String(flags['state-group']);
      if (!['backlog', 'unstarted', 'started', 'waiting', 'completed', 'cancelled'].includes(group))
        usage('Invalid --state-group');
      query.set('stateGroup', group);
    }
    if (flags.q) query.set('q', String(flags.q));
    if (flags.cursor) query.set('cursor', String(flags.cursor));
    const seen = new Set<string>(flags.cursor ? [String(flags.cursor)] : []);
    const items: unknown[] = [];
    let itemsReturned = 0;
    let nextCursor: string | null = null;
    let pagesFetched = 0;
    let reason = 'complete';
    try {
      for (let pageIndex = 0; pageIndex < pageLimit; pageIndex++) {
        const page = await context.api<Page>(`/api/agent/v1/tasks${query.size ? '?' + query : ''}`);
        if (
          !Array.isArray(page.items) ||
          page.items.length > Number(query.get('limit') ?? 50) ||
          (page.nextCursor !== null && typeof page.nextCursor !== 'string')
        )
          throw new CliError('INVALID_RESPONSE', 'Invalid task page response', 6);
        pagesFetched++;
        itemsReturned += page.items.length;
        if (options.format !== 'ndjson') items.push(...page.items);
        nextCursor = page.nextCursor;
        if (options.format === 'ndjson') {
          recordOutput(io, {
            type: 'page',
            page: pagesFetched,
            itemCount: page.items.length,
            nextCursor,
          });
          for (const row of page.items)
            recordOutput(io, {
              type: 'row',
              page: pagesFetched,
              data: projectRow(row, options.fields),
            });
        }
        if (!nextCursor) {
          reason = 'complete';
          break;
        }
        if (seen.has(nextCursor)) {
          reason = 'repeated-cursor';
          break;
        }
        seen.add(nextCursor);
        reason = flags['page-all'] ? 'page-limit' : 'single-page';
        query.set('cursor', nextCursor);
      }
    } catch (error) {
      if (pagesFetched && error instanceof CliError)
        error.detail = {
          cause: error.detail,
          partial: {
            pagesFetched,
            itemsFetched: itemsReturned,
            emittedRows: options.format === 'ndjson' ? itemsReturned : 0,
            nextCursor,
          },
        };
      throw error;
    }
    const pagination = {
      pagesFetched,
      itemsReturned,
      truncated: nextCursor !== null,
      reason,
    };
    if (options.format === 'ndjson') recordOutput(io, { type: 'summary', pagination, nextCursor });
    else
      readOutput(io, { items, nextCursor, ...(flags['page-all'] ? { pagination } : {}) }, options);
    return;
  }
  if (args.length === 3 && command === 'get') {
    allowed(flags, readFlags);
    const options = readOptions(flags);
    readOutput(io, await context.api(`/api/agent/v1/tasks/${uuid(args[2], 'TASK_ID')}`), options);
    return;
  }
  let path: string;
  let method: string;
  let body: Record<string, unknown>;
  if (args.length === 2 && command === 'create') {
    allowed(flags, ['board', 'json', 'dry-run']);
    path = `/api/agent/v1/boards/${uuid(flags.board, '--board')}/tasks`;
    body = await jsonBody(flags.json, io);
    uuid(body.clientMutationId, 'clientMutationId');
    if (typeof body.title !== 'string' || !body.title.trim()) usage('Create JSON requires a title');
    uuid(body.responsibleUserId, 'responsibleUserId');
    method = 'POST';
  } else if (args.length === 3 && command === 'update') {
    allowed(flags, ['json', 'dry-run']);
    path = `/api/agent/v1/tasks/${uuid(args[2], 'TASK_ID')}`;
    body = await jsonBody(flags.json, io);
    if (typeof body.expectedVersion !== 'number') usage('expectedVersion must be a JSON integer');
    positiveInteger(body.expectedVersion, 'expectedVersion');
    if (Object.keys(body).length < 2) usage('Update JSON must include a change');
    method = 'PATCH';
  } else if (args.length === 3 && command === 'delete') {
    allowed(flags, ['expected-version', 'yes', 'dry-run']);
    path = `/api/agent/v1/tasks/${uuid(args[2], 'TASK_ID')}`;
    body = { expectedVersion: positiveInteger(flags['expected-version'], '--expected-version') };
    if (!flags.yes && !flags['dry-run'])
      usage('Deletion requires --yes after reviewing the intended task');
    method = 'DELETE';
  } else return usage(`Unknown tasks command: ${args.join(' ')}`);
  const result = flags['dry-run']
    ? { dryRun: true, server: await context.server(), method, path, body }
    : await context.api(path, method, body);
  io.stdout(JSON.stringify({ data: result }) + '\n');
}
