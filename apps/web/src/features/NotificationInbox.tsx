import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api, post } from '../api/client';
import { CompactPopover } from '../components/ui';
import { EmptyState } from '../components/PageLayout';
export function NotificationInbox() {
  const qc = useQueryClient();
  const inbox = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api<
        {
          id: string;
          type: string;
          read_at: string | null;
          title: string;
          board_key: string;
          seq: number;
          workspace_key: string;
        }[]
      >('/api/me/notifications'),
  });
  return (
    <CompactPopover
      trigger={
        <button aria-label="通知收件箱" className="notification-trigger">
          <Bell size={16} />
          {inbox.data?.some((n) => !n.read_at) && <i />}
        </button>
      }
    >
      <div className="notification-list">
        <div className="notification-heading">
          <h2>通知</h2>
          <span className="section-count">
            {inbox.data?.filter((n) => !n.read_at).length ?? 0} 条未读
          </span>
        </div>
        {inbox.isLoading && <EmptyState title="正在加载通知…" tone="loading" />}
        {inbox.isError && (
          <EmptyState
            title="通知加载失败"
            tone="error"
            action={<button onClick={() => void inbox.refetch()}>重试</button>}
          />
        )}
        {inbox.data?.map((n) => (
          <a
            className={`notification-item${n.read_at ? ' read' : ''}`}
            key={n.id}
            href={`/workspaces/${n.workspace_key}/boards/${n.board_key}/tasks/${n.seq}`}
            onClick={() => {
              void post(`/api/notifications/${n.id}/read`, {})
                .then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))
                .catch(() => undefined);
            }}
          >
            <span className="muted">
              {n.type === 'task.participant' ? '邀请你参与' : '分配你负责'} · {n.board_key}-{n.seq}
            </span>
            <span className="notification-title">{n.title}</span>
          </a>
        ))}
        {inbox.data?.length === 0 && (
          <EmptyState
            title="暂无通知"
            description="新的任务分配与参与邀请会显示在这里。"
            icon={<Bell size={20} />}
          />
        )}
        {!!inbox.data?.length && (
          <p className="notification-footer muted">仅显示你当前有权访问的工作项。</p>
        )}
      </div>
    </CompactPopover>
  );
}
