import type { WorkPluginManifest } from '@work/plugin-sdk';
export const manifest: WorkPluginManifest = {
  key: 'ops',
  name: '运维管理',
  boardTemplates: [
    {
      key: 'ops.operations',
      name: '运维响应',
      pluginKey: 'ops',
      laneMode: 'manual',
      states: [
        { key: 'todo', name: '待处理', group: 'unstarted' },
        { key: 'doing', name: '处理中', group: 'started' },
        { key: 'observing', name: '观察中', group: 'waiting' },
        { key: 'recovered', name: '已恢复', group: 'completed' },
        { key: 'closed', name: '已关闭', group: 'completed' },
      ],
      taskTypes: [
        { key: 'incident', name: 'Incident' },
        { key: 'maintenance', name: 'Maintenance' },
        { key: 'task', name: '任务' },
      ],
    },
  ],
  laneExtensions: [{ key: 'service-lane', name: '运维泳道' }],
  groupProviders: [
    { key: 'severity', name: '严重程度', field: 'severity' },
    { key: 'service', name: '服务', field: 'service_id' },
  ],
};
