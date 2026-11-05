import { ChevronDown, Layers, LogOut, X } from 'lucide-react';
import type { RefObject } from 'react';
import type { User, Workspace } from '@work/shared';
import { CompactPopover } from '../components/ui';
import type { NavigationGroup } from './navigation';

export function WorkspaceNavigation({
  me,
  workspace,
  workspaces,
  groups,
  compact,
  open,
  panelRef,
  onClose,
  onLogout,
}: {
  me: User;
  workspace?: Workspace;
  workspaces: Workspace[];
  groups: NavigationGroup[];
  compact: boolean;
  open: boolean;
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onLogout: () => void;
}) {
  const roleLabel = me.is_platform_admin ? '平台管理员' : '团队成员';
  return (
    <aside
      id="workspace-navigation"
      ref={panelRef}
      tabIndex={-1}
      role={compact && open ? 'dialog' : undefined}
      aria-modal={compact && open ? true : undefined}
      aria-label="工作导航"
      className={`context-nav ${open ? 'mobile-open' : ''}`}
    >
      <div className="nav-brand">
        <span>WORK</span>
        <span className="muted">工作管理平台</span>
      </div>
      <button type="button" className="mobile-nav-close" aria-label="关闭导航" onClick={onClose}>
        <X size={18} />
      </button>
      <CompactPopover
        trigger={
          <button className="space-switch" aria-label="切换工作空间">
            <span className="nav-workspace-mark">
              {workspace?.name.slice(0, 1) ?? <Layers size={17} />}
            </span>
            <span className="nav-workspace-copy">
              <strong>{workspace?.name ?? '个人工作台'}</strong>
              <small>{workspace ? '当前工作空间' : '你的工作总览'}</small>
            </span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        }
      >
        <nav className="menu-list" aria-label="切换工作空间">
          <a href="/my" onClick={onClose}>
            个人工作台
          </a>
          {workspaces.map((entry) => (
            <a href={`/workspaces/${entry.key}/boards`} key={entry.id} onClick={onClose}>
              {entry.name}
            </a>
          ))}
          <a href="/workspaces" onClick={onClose}>
            全部工作空间
          </a>
        </nav>
      </CompactPopover>
      <nav className="shell-navigation" aria-label="工作模块">
        {groups.map((group) => (
          <section
            className={`nav-group ${group.boardList ? 'nav-board-list' : ''}`}
            key={group.id}
            aria-labelledby={`nav-group-${group.id}`}
          >
            <h2 className="nav-group-label" id={`nav-group-${group.id}`}>
              {group.label}
            </h2>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <a
                  className={`nav-item ${item.active ? 'selected' : ''}`}
                  href={item.href}
                  key={item.id}
                  aria-current={item.active ? 'page' : undefined}
                  onClick={onClose}
                >
                  {Icon ? (
                    <Icon size={17} aria-hidden="true" />
                  ) : (
                    <span className="board-dot" aria-hidden="true" />
                  )}
                  <span className="nav-item-label">{item.label}</span>
                  {item.count !== undefined && (
                    <span className="nav-count" aria-label={`${item.count} 项进行中的工作`}>
                      {item.count}
                    </span>
                  )}
                </a>
              );
            })}
          </section>
        ))}
      </nav>
      <div className="nav-profile">
        <span className="avatar" aria-hidden="true">
          {me.display_name.slice(0, 1)}
        </span>
        <div className="nav-profile-copy">
          <strong>{me.display_name}</strong>
          <small>{roleLabel}</small>
        </div>
        <button aria-label="退出登录" onClick={onLogout}>
          <LogOut size={16} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
