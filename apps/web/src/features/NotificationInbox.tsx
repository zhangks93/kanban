import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api, post } from '../api/client';
import { CompactPopover } from '../components/ui';
export function NotificationInbox() {
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
        <strong>通知</strong>
        {inbox.data?.map((n) => (
          <a
            className={n.read_at ? 'read' : ''}
            key={n.id}
            href={`/workspaces/${n.workspace_key}/boards/${n.board_key}/tasks/${n.seq}`}
            onClick={() => {
              void post(`/api/notifications/${n.id}/read`, {});
            }}
          >
            <span className="muted">
              {n.type === 'task.participant' ? '邀请你参与' : '分配你负责'} · {n.board_key}-{n.seq}
            </span>
            <span>{n.title}</span>
          </a>
        ))}
        {!inbox.data?.length && <p className="muted">暂无通知</p>}
      </div>
    </CompactPopover>
  );
}
