import type { Environment } from './config';
import { createContext } from './context';
import { runAuth } from './auth';
import { commandCatalog, operationSchema } from './catalog';
import { allowed, parse, uuid } from './input';
import { defaultIO } from './io';
import { errorOutput, jsonOutput, readFlags, readOptions, readOutput } from './output';
import { listSkills, readSkill } from './skills';
import { taskCommand } from './tasks';
import { usage } from './errors';
import type { Fetch } from './http';
import type { CliIO } from './types';
export type { CliIO } from './types';

const help = `Work CLI — human-authorized Agent access (Node.js 22.13+)

Discover before executing:
  work commands [--json]
  work schema [OPERATION_ID]
  work skills list
  work skills read NAME

Authorization:
  work auth login --server URL [--name NAME] [--write] [--no-wait]
  work auth complete [--server URL]
  work auth check --scope read|write
  work auth status
  work auth logout

Reads:
  work me | workspace | boards list | boards get BOARD_ID
  work tasks list | tasks +mine [--board ID] [--q TEXT] [--state-group GROUP]
       [--responsible-user ID] [--limit 1..100] [--cursor CURSOR]
       [--page-all --page-limit 1..100] [--format json|ndjson|table]
       [--fields id,title,version]
  work tasks get TASK_ID [--format json|ndjson|table] [--fields FIELDS]

Writes (JSON output only):
  work tasks create --board ID --json FILE|-|JSON [--dry-run]
  work tasks update TASK_ID --json FILE|-|JSON [--dry-run]
  work tasks delete TASK_ID --expected-version N --yes [--dry-run]

Create JSON requires clientMutationId UUID; reuse it for retries.
Update JSON requires expectedVersion from a fresh read. Conflicts require rereading.
--dry-run only checks the local request. --page-all defaults to 10 pages, max 100.
NDJSON task lists stream page/row records and a final summary; failures exit nonzero.
Discovery and skill reading work offline without credentials. Data output defaults to
{"data":...}; errors use stderr {"error":...}. Fields are allowlisted, no expressions.
Use --server/WORK_SERVER and an existing human-approved WORK_TOKEN for headless use.
WORK_CONFIG_DIR selects the dedicated private config directory; tokens are never printed.
Exit: 0 success, 2 usage, 3 authentication, 4 forbidden, 5 conflict,
6 network/config/response, 1 other server or authorization-flow failure.
`;

export async function runCli(
  argv: string[],
  io: CliIO = defaultIO,
  env: Environment = process.env,
  fetcher: Fetch = fetch,
): Promise<number> {
  try {
    const { args, flags } = parse(argv);
    if (flags.help || !args.length || args[0] === 'help') {
      io.stdout(help);
      return 0;
    }
    const command = args.join(' ');
    if (args[0] === 'commands' && args.length === 1) {
      allowed(flags, ['json']);
      jsonOutput(io, commandCatalog());
    } else if (args[0] === 'schema' && args.length <= 2) {
      allowed(flags, []);
      jsonOutput(io, operationSchema(args[1]));
    } else if (command === 'skills list') {
      allowed(flags, []);
      jsonOutput(io, listSkills());
    } else if (args[0] === 'skills' && args[1] === 'read' && args.length === 3) {
      allowed(flags, []);
      const markdown = await readSkill(args[2]);
      io.stdout(markdown + (markdown.endsWith('\n') ? '' : '\n'));
    } else {
      const context = createContext(flags, io, env, fetcher);
      if (args[0] === 'auth' && args.length === 2)
        jsonOutput(io, await runAuth(args[1], flags, context));
      else if (args[0] === 'tasks') await taskCommand(args, flags, context);
      else {
        allowed(flags, readFlags);
        const options = readOptions(flags);
        let path: string;
        if (command === 'me' || command === 'workspace') path = `/api/agent/v1/${command}`;
        else if (command === 'boards list') path = '/api/agent/v1/boards';
        else if (args[0] === 'boards' && args[1] === 'get' && args.length === 3)
          path = `/api/agent/v1/boards/${uuid(args[2], 'BOARD_ID')}`;
        else return usage(`Unknown command: ${command}. Run work commands --json`);
        readOutput(io, await context.api(path), options);
      }
    }
    return 0;
  } catch (error) {
    return errorOutput(io, error);
  }
}
