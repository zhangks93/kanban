import { z } from 'zod';
export * from './effort';
export const errorStatus = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  VALIDATION_FAILED: 422,
  INVALID_TRANSITION: 422,
  LANE_NOT_ALLOWED: 422,
  LANE_HAS_ACTIVE_TASKS: 409,
  RESPONSIBLE_NOT_ALLOWED: 422,
  PARTICIPANT_NOT_ALLOWED: 422,
  WIP_CAPACITY_EXCEEDED: 409,
  TASK_NOT_WORKER: 403,
  TASK_NOT_FOCUSABLE: 422,
  PLUGIN_NOT_ENABLED: 422,
  PLUGIN_HAS_DEPENDENCIES: 409,
  DEPENDENCY_CONFLICT: 409,
  LAST_WORKSPACE_OWNER: 409,
  WORK_LOG_DAILY_LIMIT: 422,
} as const;
export type ErrorCode = keyof typeof errorStatus;
export const messages: Record<ErrorCode, string> = {
  UNAUTHENTICATED: '请先登录',
  FORBIDDEN: '你没有执行此操作的权限',
  NOT_FOUND: '内容不存在或已不可见',
  VERSION_CONFLICT: '任务已被他人修改，请刷新后重试',
  VALIDATION_FAILED: '请检查填写的内容',
  INVALID_TRANSITION: '目标状态不可用',
  LANE_NOT_ALLOWED: '此泳道不可用',
  LANE_HAS_ACTIVE_TASKS: '泳道仍有未完成的任务',
  RESPONSIBLE_NOT_ALLOWED: '该成员没有当前工作权限',
  PARTICIPANT_NOT_ALLOWED: '该成员不能参与此任务',
  WIP_CAPACITY_EXCEEDED: '全局 WIP 已满，请先熄灭或替换一个任务',
  TASK_NOT_WORKER: '只有当前有效负责人或参与人可以点亮',
  TASK_NOT_FOCUSABLE: '此任务当前不能点亮',
  PLUGIN_NOT_ENABLED: '工作空间尚未启用该插件',
  PLUGIN_HAS_DEPENDENCIES: '请先归档依赖此插件的看板',
  DEPENDENCY_CONFLICT: '此资源仍被使用',
  LAST_WORKSPACE_OWNER: '工作空间必须保留至少一位有效所有者',
  WORK_LOG_DAILY_LIMIT: '同一天在所有任务上的累计工时不能超过 24 小时',
};
export const uuid = z.string().uuid();
export const versionBody = z.object({ expectedVersion: z.number().int().positive() });
export type StateGroup =
  'backlog' | 'unstarted' | 'started' | 'waiting' | 'completed' | 'cancelled';
export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export interface User {
  id: string;
  display_name: string;
  avatar_url?: string | null;
  status: 'active' | 'deactivated';
  is_platform_admin: boolean;
  wip_limit: number;
  used_wip: number;
}
export interface Workspace {
  id: string;
  key: string;
  name: string;
  description?: string;
  status: string;
  role: string;
}
export interface Board {
  id: string;
  workspace_id: string;
  key: string;
  name: string;
  access_mode: string;
  lane_mode: string;
  plugin_key?: string | null;
  template_key: string;
  status: string;
  intake_enabled: boolean;
  can_manage?: boolean;
}
export interface State {
  id: string;
  key: string;
  name: string;
  state_group: StateGroup;
  sort_order: number;
  is_initial: boolean;
}
export interface Lane {
  id: string;
  name: string;
  key: string;
  sort_order: number;
  status: string;
}
export interface TaskType {
  id: string;
  key: string;
  name: string;
  is_container: boolean;
}
export interface Worker {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  boardRole?: string;
  usedWip: number;
  wipLimit: number;
}
export interface Person {
  id: string;
  display_name: string;
  eligible: boolean;
  focused: boolean;
}
export interface Task {
  id: string;
  workspace_id: string;
  board_id: string;
  board_key: string;
  board_name: string;
  workspace_key: string;
  workspace_name: string;
  seq: number;
  title: string;
  description: Record<string, unknown> | null;
  description_text: string | null;
  responsible_id: string;
  responsible_name: string;
  responsible_eligible: boolean;
  participants: Person[];
  focus_user_ids: string[];
  state_id: string;
  state_group: StateGroup;
  lane_id: string | null;
  type_id: string;
  type_name: string;
  priority: Priority;
  start_date: string | null;
  due_date: string | null;
  estimate_days: number | null;
  logged_hours: number;
  milestone_id: string | null;
  parent_id: string | null;
  sort_key: string;
  version: number;
  can_edit: boolean;
  can_focus: boolean;
  relation?: 'responsible' | 'participant';
  plugin_fields?: Record<string, unknown>;
  labels?: { id: string; name: string }[];
}
export interface BoardData {
  board: Board;
  states: State[];
  lanes: Lane[];
  types: TaskType[];
  milestones: { id: string; name: string; due_date: string }[];
  labels: { id: string; name: string; color: string }[];
}
