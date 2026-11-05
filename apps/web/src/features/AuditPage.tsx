import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../lib/context';
import { api } from '../api/client';
import { PageHeader, EmptyState } from '../components/PageLayout';
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
      <PageHeader
        title="审计记录"
        eyebrow="空间管理"
        description="追溯成员与 Agent 的操作，保留授权来源和请求标识。"
        actions={
          <button onClick={() => void audit.refetch()} disabled={audit.isFetching}>
            刷新
          </button>
        }
      />
      <div className="my-list">
        {audit.isPending && <EmptyState title="正在加载记录…" tone="loading" />}
        {audit.data?.length === 0 && (
          <EmptyState title="暂无审计记录" description="空间中的关键变更会在这里保留记录。" />
        )}
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
