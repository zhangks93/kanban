import { SearchPage } from '../features/SearchPage';
import { FoundationDataPage } from '../features/PluginDomainPage';
import { PublicBoard } from '../features/PublicBoard';
import { AuditPage } from '../features/AuditPage';
import { AgentAccess } from '../features/AgentAccess';
import { installedPlugins } from '../plugins/registry';
import { PluginSettings } from '../features/PluginSettings';
import { MyWork } from '../features/MyWork';
import { WorkReportPage } from '../features/WorkReportPage';
import { BoardsPage } from '../features/BoardsPage';
import { BoardScreen } from '../features/BoardScreen';

import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AppShell } from '../layouts/AppShell';
import { Login } from '../layouts/Login';
import { WorkspaceList, MemberSettings, AdminUsers } from '../features/WorkspacePages';
function NotFound() {
  return (
    <div className="empty">
      页面不存在或无访问权限。<a href="/my">返回我的工作</a>
    </div>
  );
}
function AuthComplete() {
  useEffect(() => {
    window.location.replace('/my');
  }, []);
  return <div className="empty">正在进入工作台…</div>;
}
const root = createRootRoute({ component: AppShell });
const routes = [
  createRoute({ getParentRoute: () => root, path: '/share/$token', component: PublicBoard }),
  createRoute({ getParentRoute: () => root, path: '/auth/complete', component: AuthComplete }),
  createRoute({
    getParentRoute: () => root,
    path: '/workspaces/$workspaceKey/search',
    component: SearchPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/workspaces/$workspaceKey/settings/audit',
    component: AuditPage,
  }),
  ...installedPlugins.flatMap((p) =>
    (p.web.routes ?? []).map((r) =>
      createRoute({
        getParentRoute: () => root,
        path: `/workspaces/$workspaceKey/${r.path}`,
        component: FoundationDataPage,
      }),
    ),
  ),
  createRoute({
    getParentRoute: () => root,
    path: '/workspaces/$workspaceKey/data',
    component: FoundationDataPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/workspaces/$workspaceKey/settings/plugins',
    component: PluginSettings,
  }),
  createRoute({ getParentRoute: () => root, path: '/my', component: MyWork }),
  createRoute({ getParentRoute: () => root, path: '/work-logs', component: WorkReportPage }),
  createRoute({ getParentRoute: () => root, path: '/agent-access', component: AgentAccess }),
  createRoute({
    getParentRoute: () => root,
    path: '/workspaces/$workspaceKey/boards',
    component: BoardsPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/workspaces/$workspaceKey/boards/$boardKey',
    component: BoardScreen,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/workspaces/$workspaceKey/boards/$boardKey/tasks/$seq',
    component: BoardScreen,
  }),
  createRoute({ getParentRoute: () => root, path: '/login', component: Login }),
  createRoute({ getParentRoute: () => root, path: '/', component: WorkspaceList }),
  createRoute({ getParentRoute: () => root, path: '/workspaces', component: WorkspaceList }),
  createRoute({
    getParentRoute: () => root,
    path: '/workspaces/$workspaceKey',
    component: BoardsPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: '/workspaces/$workspaceKey/settings/members',
    component: MemberSettings,
  }),
  createRoute({ getParentRoute: () => root, path: '/admin/users', component: AdminUsers }),
  createRoute({ getParentRoute: () => root, path: '/$', component: NotFound }),
];
export const router = createRouter({
  routeTree: root.addChildren(routes),
  defaultPreload: 'intent',
});
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
