import type { ComponentType } from 'react';
import type { StateGroup, Task } from '@work/shared';
export interface TaskTypeDefinition {
  key: string;
  name: string;
  isContainer?: boolean;
}
export interface BoardTemplateDefinition {
  key: string;
  name: string;
  pluginKey?: string;
  laneMode: 'none' | 'manual';
  states: { key: string; name: string; group: StateGroup }[];
  taskTypes: TaskTypeDefinition[];
  defaultLanes?: { key: string; name: string }[];
}
export interface PluginLaneExtensionDefinition {
  key: string;
  name: string;
}
export interface PluginGroupProviderDefinition {
  key: string;
  name: string;
  field: string;
}
export interface WorkPluginManifest {
  key: string;
  name: string;
  boardTemplates?: BoardTemplateDefinition[];
  taskTypes?: TaskTypeDefinition[];
  laneExtensions?: PluginLaneExtensionDefinition[];
  groupProviders?: PluginGroupProviderDefinition[];
}
export interface PluginServerContext {
  registerTaskExtension(definition: {
    key: string;
    table: string;
    fields: string[];
    domainTables: string[];
  }): void;
}
export interface WorkPluginServer {
  key: string;
  register(ctx: PluginServerContext): void;
}
export interface PluginRoute {
  path: string;
  title: string;
}
export interface PluginNavItem {
  path: string;
  title: string;
}
export interface PanelProps {
  task: Task;
  mutate: (fields: Record<string, unknown>) => Promise<void>;
  options: Record<string, { id: string; name: string }[]>;
  disabled?: boolean;
}
export interface PluginTaskPanel {
  key: string;
  component: ComponentType<PanelProps>;
}
export interface PluginBoardPanel {
  key: string;
  title: string;
}
export interface PluginGroupProviderUI {
  key: string;
  label: string;
  field: string;
}
export interface WorkPluginWeb {
  key: string;
  routes?: PluginRoute[];
  navItems?: PluginNavItem[];
  taskPanels?: PluginTaskPanel[];
  boardPanels?: PluginBoardPanel[];
  groupProviders?: PluginGroupProviderUI[];
}
export function assertPluginKeys(manifest: WorkPluginManifest, entry: { key: string }) {
  if (manifest.key !== entry.key) throw new Error('Plugin entry key mismatch');
}
export const coreTemplates: BoardTemplateDefinition[] = ['general', 'project'].map((key) => ({
  key: `core.${key}`,
  name: key === 'general' ? '通用工作' : '项目工作',
  laneMode: key === 'project' ? 'manual' : 'none',
  states: [
    { key: 'todo', name: key === 'general' ? '待处理' : '待办', group: 'unstarted' },
    { key: 'doing', name: '进行中', group: 'started' },
    { key: 'waiting', name: '等待中', group: 'waiting' },
    { key: 'done', name: '已完成', group: 'completed' },
    { key: 'cancelled', name: '已取消', group: 'cancelled' },
  ],
  taskTypes: [{ key: 'task', name: '任务' }],
}));
