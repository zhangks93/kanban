import { SearchPage } from '../features/SearchPage';
import { NotificationInbox } from '../features/NotificationInbox';
import { PluginDomainPage } from '../features/PluginDomainPage';
import { AuditPage } from '../features/AuditPage';
import { installedPlugins } from '../plugins/registry';
import { PluginSettings } from '../features/PluginSettings';
import { MyWork } from '../features/MyWork';
import { BoardsPage } from '../features/BoardsPage';
import { BoardScreen } from '../features/BoardScreen';

import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useLocation,
} from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Layers, Inbox, Search, Settings, ChevronDown, LogOut, Users, Menu } from 'lucide-react';
import type { Board, User, Workspace } from '@work/shared';
import { api, post, ApiError } from '../api/client';
import { AppContext } from '../lib/context';
import { WorkspaceList, MemberSettings, AdminUsers } from '../features/WorkspacePages';
import { CompactPopover } from '../components/ui';
function Login() {
  return (
    <main className="login">
      <div className="brand">
        W<span>WORK</span>
      </div>
      <h1>登录工作平台</h1>
      <p className="muted">用飞书身份进入你的协作空间。</p>
      <a className="login-button primary" href="/auth/feishu/start?next=/my">
        使用飞书登录
      </a>
      <p className="login-note muted">任务、协作与投入，在同一处。</p>
    </main>
  );
}
function Shell() {
  const location = useLocation();
  const isLogin = location.pathname === '/login';
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<User>('/api/me'),
    retry: false,
    enabled: !isLogin,
  });
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api<Workspace[]>('/api/workspaces'),
    enabled: !!me.data,
  });
  const key = location.pathname.match(/^\/workspaces\/([^/]+)/)?.[1];
  const workspace = workspaces.data?.find((w) => w.key === key);
  const boards = useQuery({
    queryKey: ['boards', workspace?.id],
    queryFn: () => api<Board[]>(`/api/workspaces/${workspace!.id}/boards`),
    enabled: !!workspace,
  });
  const plugins = useQuery({
    queryKey: ['plugins', workspace?.id],
    queryFn: () =>
      api<{ key: string; enabled: boolean }[]>(`/api/workspaces/${workspace!.id}/plugins`),
    enabled: !!workspace,
  });
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const [mobileNav, setMobileNav] = useState(false);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 6000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.code === 'UNAUTHENTICATED')
      window.location.replace('/login');
  }, [me.isError]);
  if (isLogin) return <Login />;
  if (!me.data)
    return (
      <div className="loading-shell" role="status">
        {me.isError ? (
          <>
            服务暂时不可用。<button onClick={() => void me.refetch()}>重试</button>
          </>
        ) : (
          '正在载入工作空间…'
        )}
      </div>
    );
  return (
    <AppContext.Provider
      value={{ me: me.data, workspaces: workspaces.data ?? [], workspace, notify: setToast }}
    >
      <div className="app-shell">
        <aside className="app-rail" aria-label="全局导航">
          <a href="/my" className="logo" aria-label="我的工作">
            W
          </a>
          {workspaces.data?.map((w) => (
            <a
              key={w.id}
              href={`/workspaces/${w.key}/boards`}
              className={`rail-space ${workspace?.id === w.id ? 'active' : ''}`}
              title={w.name}
            >
              {w.name.slice(0, 1)}
            </a>
          ))}
          <a className="rail-bottom" href="/workspaces" aria-label="全部工作空间">
            <Layers size={18} />
          </a>
        </aside>
        <aside className={`context-nav ${mobileNav ? 'mobile-open' : ''}`}>
          <CompactPopover
            trigger={
              <button className="space-switch">
                {workspace?.name ?? '个人工作台'}
                <ChevronDown size={14} />
              </button>
            }
          >
            <nav className="menu-list">
              <a href="/my">个人工作台</a>
              {workspaces.data?.map((w) => (
                <a href={`/workspaces/${w.key}/boards`} key={w.id}>
                  {w.name}
                </a>
              ))}
              <a href="/workspaces">所有工作空间</a>
            </nav>
          </CompactPopover>
          <nav>
            <a className={location.pathname === '/my' ? 'selected' : ''} href="/my">
              <Inbox size={16} />
              我的工作<span className="nav-count">{me.data.used_wip}</span>
            </a>
            {workspace && (
              <>
                <a href={`/workspaces/${workspace.key}/search`}>
                  <Search size={16} />
                  搜索工作项
                </a>
                <div className="nav-section">
                  <span>看板</span>
                  <a aria-label="管理看板" href={`/workspaces/${workspace.key}/boards`}>
                    ＋
                  </a>
                </div>
                {boards.data?.map((b) => (
                  <a
                    key={b.id}
                    className={location.pathname.includes(`/boards/${b.key}`) ? 'selected' : ''}
                    href={`/workspaces/${workspace.key}/boards/${b.key}`}
                  >
                    <span className="board-dot" />
                    {b.name}
                  </a>
                ))}
                {installedPlugins
                  .filter((p) => plugins.data?.some((x) => x.key === p.manifest.key && x.enabled))
                  .flatMap((p) => p.web.navItems ?? [])
                  .map((item) => (
                    <a key={item.path} href={`/workspaces/${workspace.key}/${item.path}`}>
                      {item.title}
                    </a>
                  ))}
                <div className="nav-section">工作空间</div>
                <a href={`/workspaces/${workspace.key}/settings/members`}>
                  <Users size={16} />
                  成员
                </a>
                {['owner', 'admin'].includes(workspace.role) && (
                  <a href={`/workspaces/${workspace.key}/settings/plugins`}>
                    <Settings size={16} />
                    插件与设置
                  </a>
                )}
                {['owner', 'admin'].includes(workspace.role) && (
                  <a href={`/workspaces/${workspace.key}/settings/audit`}>审计记录</a>
                )}
              </>
            )}
            {me.data.is_platform_admin && (
              <a href="/admin/users">
                <Users size={16} />
                平台用户
              </a>
            )}
          </nav>
          <div className="nav-profile">
            <NotificationInbox />
            <span className="avatar">{me.data.display_name.slice(0, 1)}</span>
            <span>{me.data.display_name}</span>
            <button
              aria-label="退出登录"
              onClick={async () => {
                await post('/auth/logout', {});
                window.location.href = '/login';
              }}
            >
              <LogOut size={14} />
            </button>
          </div>
        </aside>
        <main className="main-content">
          <div className="mobile-header">
            <button aria-label="打开导航" onClick={() => setMobileNav(!mobileNav)}>
              <Menu size={18} />
            </button>
            <span>{workspace?.name ?? '我的工作'}</span>
          </div>
          <Outlet />
          {!online && (
            <div className="offline-banner" role="status">
              当前离线，重新连接后可继续保存。
            </div>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="alert">
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast('')}>
            ×
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}
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
const root = createRootRoute({ component: Shell });
const routes = [
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
        component: PluginDomainPage,
      }),
    ),
  ),
  createRoute({
    getParentRoute: () => root,
    path: '/workspaces/$workspaceKey/settings/plugins',
    component: PluginSettings,
  }),
  createRoute({ getParentRoute: () => root, path: '/my', component: MyWork }),
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
