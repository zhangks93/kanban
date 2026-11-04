import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../lib/context';
import { api } from '../api/client';
export function AuditPage() {
  const { workspace } = useApp();
  const audit = useQuery({
    queryKey: ['audit', workspace?.id],
    queryFn: () =>
      api<
        {
          id: number;
          action: string;
          entity_type: string;
          actor_name: string;
          agent_client_name: string | null;
          request_id: string | null;
          occurred_at: string;
        }[]
      >(`/api/workspaces/${workspace!.id}/audit`),
    enabled: !!workspace,
  });
  return (
    <>
      <header className="page-heading">
        <h1>审计记录</h1>
      </header>
      <div className="my-list">
        {audit.data?.map((r) => (
          <div className="audit-row" key={r.id}>
            <span className="mono muted">
              {format(new Date(r.occurred_at), 'yyyy-MM-dd HH:mm')}
            </span>
            <span title={r.request_id ? `请求 ID：${r.request_id}` : undefined}>
              {r.actor_name ?? '系统'}
              {r.agent_client_name && (
                <small className="muted"> · Agent：{r.agent_client_name}</small>
              )}
            </span>
            <span>{r.entity_type}</span>
            <span className="muted">{r.action}</span>
          </div>
        ))}
        {audit.isError && <div className="empty error">无权访问审计记录。</div>}
      </div>
    </>
  );
}
