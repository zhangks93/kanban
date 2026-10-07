import type { WorkPluginManifest } from '@work/plugin-sdk';
export const manifest: WorkPluginManifest = {
  key: 'rnd',
  name: '研发管理',
  boardTemplates: [
    {
      key: 'rnd.development',
      name: '研发综合',
      pluginKey: 'rnd',
      laneMode: 'manual',
      states: [
        { key: 'analysis', name: '待分析', group: 'backlog' },
        { key: 'todo', name: '待开发', group: 'unstarted' },
        { key: 'doing', name: '开发中', group: 'started' },
        { key: 'review', name: '评审中', group: 'started' },
        { key: 'testing', name: '测试中', group: 'started' },
        { key: 'acceptance', name: '验收中', group: 'started' },
        { key: 'done', name: '已完成', group: 'completed' },
        { key: 'cancelled', name: '已取消', group: 'cancelled' },
      ],
      taskTypes: [
        { key: 'epic', name: 'Epic', isContainer: true },
        { key: 'story', name: 'Story' },
        { key: 'bug', name: 'Bug' },
        { key: 'subtask', name: 'Subtask' },
        { key: 'task', name: '任务' },
      ],
    },
  ],
  laneExtensions: [{ key: 'project', name: '研发项目' }],
  groupProviders: [
    { key: 'system', name: '系统', field: 'system_id' },
    { key: 'module', name: '模块', field: 'module_id' },
  ],
};
