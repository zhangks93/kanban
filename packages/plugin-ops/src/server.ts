import type { WorkPluginServer } from '@work/plugin-sdk';
export const server: WorkPluginServer = {
  key: 'ops',
  register(ctx) {
    ctx.registerTaskExtension({
      key: 'ops',
      table: 'ops_task_ext',
      fields: ['severity', 'impact', 'detected_at', 'recovered_at', 'service_id'],
      domainTables: ['ops_service'],
    });
  },
};
