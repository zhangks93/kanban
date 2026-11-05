import {
  Activity,
  Bot,
  Database,
  FolderKanban,
  Inbox,
  Layers,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Board, User, Workspace } from '@work/shared';

export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  icon?: LucideIcon;
  active: boolean;
  count?: number;
}
export interface NavigationGroup {
  id: string;
  label: string;
  items: NavigationItem[];
  boardList?: boolean;
}
export interface ShellLocation {
  label: string;
  workspace?: Workspace;
  board?: Board;
}

export function buildNavigation({
  pathname,
  me,
  workspace,
  boards,
}: {
  pathname: string;
  me: User;
  workspace?: Workspace;
  boards: Board[];
}): NavigationGroup[] {
  const item = (
    id: string,
    label: string,
    href: string,
    icon: LucideIcon,
    active = pathname === href,
  ): NavigationItem => ({ id, label, href, icon, active });
  const groups: NavigationGroup[] = [
    {
      id: 'personal',
      label: '个人工作',
      items: [
        { ...item('my', '我的工作', '/my', Inbox), count: me.used_wip },
        item('work-logs', '工时统计', '/work-logs', Activity),
      ],
    },
    {
      id: 'collaboration',
      label: '空间协作',
      items: [
        item(
          'workspaces',
          '全部工作空间',
          '/workspaces',
          Layers,
          pathname === '/' || pathname === '/workspaces',
        ),
        ...(workspace
          ? [
              item(
                'boards',
                '看板总览',
                `/workspaces/${workspace.key}/boards`,
                FolderKanban,
                pathname === `/workspaces/${workspace.key}` ||
                  pathname === `/workspaces/${workspace.key}/boards`,
              ),
              item('search', '搜索工作项', `/workspaces/${workspace.key}/search`, Search),
              item(
                'data',
                '基础数据',
                `/workspaces/${workspace.key}/data`,
                Database,
                pathname === `/workspaces/${workspace.key}/data` ||
                  pathname.startsWith(`/workspaces/${workspace.key}/rnd/`) ||
                  pathname.startsWith(`/workspaces/${workspace.key}/ops/`),
              ),
            ]
          : []),
      ],
    },
  ];
  if (workspace && boards.length) {
    groups.push({
      id: 'boards',
      label: '当前空间看板',
      boardList: true,
      items: boards.map((board) => {
        const href = `/workspaces/${workspace.key}/boards/${board.key}`;
        return {
          id: board.id,
          label: board.name,
          href,
          active: pathname === href || pathname.startsWith(`${href}/`),
        };
      }),
    });
  }
  const management: NavigationItem[] = [];
  if (workspace) {
    management.push(
      item('members', '空间成员', `/workspaces/${workspace.key}/settings/members`, Users),
    );
    if (['owner', 'admin'].includes(workspace.role)) {
      management.push(
        item('plugins', '插件与设置', `/workspaces/${workspace.key}/settings/plugins`, Settings2),
        item('audit', '审计记录', `/workspaces/${workspace.key}/settings/audit`, ShieldCheck),
      );
    }
  }
  if (me.is_platform_admin) management.push(item('users', '平台用户', '/admin/users', Users));
  if (management.length) groups.push({ id: 'management', label: '管理', items: management });
  groups.push({
    id: 'connections',
    label: '集成与访问',
    items: [item('agent-access', 'Agent 访问', '/agent-access', Bot)],
  });
  return groups;
}

export function resolveShellLocation(
  pathname: string,
  groups: NavigationGroup[],
  workspace?: Workspace,
  boards: Board[] = [],
): ShellLocation {
  const board = workspace
    ? boards.find((entry) => {
        const href = `/workspaces/${workspace.key}/boards/${entry.key}`;
        return pathname === href || pathname.startsWith(`${href}/`);
      })
    : undefined;
  if (board) return { label: /\/tasks\//.test(pathname) ? '任务详情' : '看板', workspace, board };
  const current = groups.flatMap((group) => group.items).find((entry) => entry.active);
  return { label: current?.label ?? '工作台', workspace };
}
