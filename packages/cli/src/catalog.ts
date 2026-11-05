import { agentManifest, agentOperationSchema } from '@work/shared/agent';
import { usage } from './errors';
import { entityFields } from './output';
const invocation: Record<string, string> = {
  schema: 'work schema',
  'schema.get': 'work schema OPERATION_ID',
  me: 'work me',
  'workspace.get': 'work workspace',
  'boards.list': 'work boards list',
  'boards.get': 'work boards get BOARD_ID',
  'tasks.list': 'work tasks list [filters]',
  'tasks.get': 'work tasks get TASK_ID',
  'tasks.create': 'work tasks create --board BOARD_ID --json FILE|-|JSON',
  'tasks.update': 'work tasks update TASK_ID --json FILE|-|JSON',
  'tasks.delete': 'work tasks delete TASK_ID --expected-version N --yes',
  'authorization.revoke': 'work auth logout',
};
export function commandCatalog() {
  return {
    apiVersion: agentManifest.apiVersion,
    discovery: 'Discover commands, inspect an operation schema, check authorization, then execute.',
    commands: [
      ...agentManifest.commands.map((operation) => ({
        id: operation.id,
        command: invocation[operation.id] ?? operation.id,
        scope: operation.scope,
        method: operation.method,
        path: operation.path,
        ...(['schema', 'schema.get'].includes(operation.id)
          ? { local: true, requiresAuthentication: false }
          : {}),
      })),
      { id: 'commands', command: 'work commands [--json]', local: true },
      {
        id: 'auth.login',
        command: 'work auth login --server URL [--write] [--name NAME] [--no-wait]',
        humanApproval: true,
      },
      { id: 'auth.complete', command: 'work auth complete [--server URL]', humanApproval: true },
      { id: 'auth.status', command: 'work auth status', scope: 'read' },
      { id: 'auth.check', command: 'work auth check --scope read|write', scope: 'read' },
      { id: 'tasks.+mine', command: 'work tasks +mine [filters]', scope: 'read' },
      { id: 'skills.list', command: 'work skills list', local: true },
      { id: 'skills.read', command: 'work skills read NAME', local: true },
    ],
    readOptions: {
      format: ['json', 'ndjson', 'table'],
      fields: 'Comma-separated allowlisted entity fields; no nested expressions',
      allowedFields: entityFields,
    },
    taskFilters: ['--board', '--q', '--state-group', '--responsible-user', '--limit', '--cursor'],
    pagination: {
      pageAll: '--page-all',
      pageLimit: '--page-limit 1..100 (default 10, requires --page-all)',
      maxPageSize: 100,
    },
    safety: {
      writeFormat: 'JSON only',
      dryRun: 'Local validation only; no authorization or concurrency check',
      rawRequests: false,
    },
  };
}
export function operationSchema(id?: string) {
  if (!id) return agentManifest;
  const schema = agentOperationSchema(id);
  if (!schema) usage(`Unknown operation: ${id}. Run work commands --json`);
  return schema;
}
