import { Outlet, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Layers, Menu } from 'lucide-react';
import type { Board, User, Workspace } from '@work/shared';
import { api, post, ApiError } from '../api/client';
import { AppContext } from '../lib/context';
import { NotificationInbox } from '../features/NotificationInbox';
import { buildNavigation, resolveShellLocation } from './navigation';
import { Login } from './Login';
import { WorkspaceNavigation } from './WorkspaceNavigation';

export function AppShell() {
  const location = useLocation();
  const isLogin = location.pathname === '/login';
  const isPublic = location.pathname.startsWith('/share/');
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<User>('/api/me'),
    retry: false,
    enabled: !isLogin && !isPublic,
  });
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api<Workspace[]>('/api/workspaces'),
    enabled: !!me.data && !isPublic,
  });
  const workspaceKey = location.pathname.match(/^\/workspaces\/([^/]+)/)?.[1];
  const workspace = workspaces.data?.find((entry) => entry.key === workspaceKey);
  const boards = useQuery({
    queryKey: ['boards', workspace?.id],
    queryFn: () => api<Board[]>(`/api/workspaces/${workspace!.id}/boards`),
    enabled: !!workspace,
  });
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [mobileNav, setMobileNav] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const update = () => {
      setCompact(media.matches);
      if (!media.matches) setMobileNav(false);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => setMobileNav(false), [location.pathname]);
  useEffect(() => {
    if (!mobileNav || !compact) return;
    const panel = panelRef.current;
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.focus();
    const keydown = (event: KeyboardEvent) => {
      // Nested Radix popovers manage their own focus and Escape behavior.
      if ((event.target as HTMLElement).closest('[data-radix-popper-content-wrapper]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileNav(false);
      }
      if (event.key !== 'Tab') return;
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex="0"]'),
      ].filter((entry) => entry.getClientRects().length);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === panel)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      (previous?.isConnected ? previous : menuRef.current)?.focus();
    };
  }, [mobileNav, compact]);
  useEffect(() => {
    if (!isPublic && me.error instanceof ApiError && me.error.code === 'UNAUTHENTICATED') {
      const next =
        location.pathname === '/agent-access'
          ? `/auth/feishu/start?next=${encodeURIComponent(`/agent-access${window.location.search}`)}`
          : '/login';
      window.location.replace(next);
    }
  }, [me.error, isPublic, location.pathname]);

  if (isPublic) return <Outlet />;
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
  const groups = buildNavigation({
    pathname: location.pathname,
    me: me.data,
    workspace,
    boards: boards.data ?? [],
  });
  const current = resolveShellLocation(location.pathname, groups, workspace, boards.data ?? []);
  const closeNavigation = () => setMobileNav(false);
  async function logout() {
    try {
      await post('/auth/logout', {});
      window.location.href = '/login';
    } catch (error) {
      setToast((error as Error).message);
    }
  }
  return (
    <AppContext.Provider
      value={{ me: me.data, workspaces: workspaces.data ?? [], workspace, notify: setToast }}
    >
      <a href="#main-content" className="skip-link">
        跳转到主要内容
      </a>
      <div className="app-shell">
        <aside className="app-rail" aria-label="全局导航" inert={compact && mobileNav}>
          <a href="/my" className="logo" aria-label="我的工作">
            W
          </a>
          {workspaces.data?.map((entry) => (
            <a
              key={entry.id}
              href={`/workspaces/${entry.key}/boards`}
              className={`rail-space ${workspace?.id === entry.id ? 'active' : ''}`}
              title={entry.name}
              aria-label={entry.name}
              aria-current={workspace?.id === entry.id ? 'true' : undefined}
            >
              {entry.name.slice(0, 1)}
            </a>
          ))}
          <a className="rail-bottom" href="/workspaces" aria-label="全部工作空间">
            <Layers size={19} aria-hidden="true" />
          </a>
        </aside>
        <WorkspaceNavigation
          me={me.data}
          workspace={workspace}
          workspaces={workspaces.data ?? []}
          groups={groups}
          compact={compact}
          open={mobileNav}
          panelRef={panelRef}
          onClose={closeNavigation}
          onLogout={() => void logout()}
        />
        {compact && mobileNav && (
          <button
            className="nav-backdrop"
            aria-label="关闭导航遮罩"
            tabIndex={-1}
            onClick={closeNavigation}
          />
        )}
        <main className="main-content" id="main-content" tabIndex={-1} inert={compact && mobileNav}>
          <header className="shell-topbar">
            <nav className="shell-breadcrumb" aria-label="当前位置">
              <a href={workspace ? `/workspaces/${workspace.key}/boards` : '/my'}>
                {workspace?.name ?? '个人工作台'}
              </a>
              <ChevronRight size={14} aria-hidden="true" />
              {current.board && (
                <>
                  <a href={`/workspaces/${workspace!.key}/boards/${current.board.key}`}>
                    {current.board.name}
                  </a>
                  <ChevronRight size={14} aria-hidden="true" />
                </>
              )}
              <span className="shell-page-label" aria-current="page">
                {current.label}
              </span>
            </nav>
            <NotificationInbox />
          </header>
          <header className="mobile-header">
            <button
              ref={menuRef}
              aria-label="打开导航"
              aria-expanded={mobileNav}
              aria-controls="workspace-navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={19} />
            </button>
            <span className="mobile-page-title">
              <strong>{current.board?.name ?? current.label}</strong>
              {workspace && <small>{workspace.name}</small>}
            </span>
            <NotificationInbox />
          </header>
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
