import type { WorkPluginServer } from '@work/plugin-sdk';
export const server: WorkPluginServer = {
  key: 'rnd',
  register(ctx) {
    ctx.registerTaskExtension({
      key: 'rnd',
      table: 'rnd_task_ext',
      fields: ['system_id', 'module_id'],
      domainTables: ['rnd_system', 'rnd_module'],
    });
  },
};
