import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../lib/context';
import { api, post } from '../api/client';
import { useState } from 'react';
import { PageHeader, EmptyState } from '../components/PageLayout';
export function PluginSettings() {
  const { workspace, me, notify } = useApp();
  const qc = useQueryClient();
  const [saving, setSaving] = useState('');
  const plugins = useQuery({
    queryKey: ['plugins', workspace?.id],
    queryFn: () =>
      api<{ key: string; name: string; enabled: boolean }[]>(
        `/api/workspaces/${workspace!.id}/plugins`,
      ),
    enabled: !!workspace,
  });
  const can = ['owner', 'admin'].includes(workspace?.role ?? '');
  return (
    <>
      <PageHeader
        title="插件设置"
        eyebrow="空间管理"
        description="按团队工作方式启用场景扩展，基础数据在整个空间中共享。"
      />
      <div className="workspace-list">
        {plugins.isPending && <EmptyState title="正在加载插件…" tone="loading" />}
        {plugins.isError && (
          <EmptyState
            title="无法加载插件"
            tone="error"
            action={<button onClick={() => void plugins.refetch()}>重试</button>}
          />
        )}
        {plugins.data?.map((p) => (
          <div className="workspace-row" key={p.key}>
            <div>
              <strong>{p.name}</strong>
              <p className="muted">{p.key === 'rnd' ? '系统 · 项目' : '系统'}</p>
            </div>
            <button
              disabled={!can || !!saving}
              onClick={async () => {
                setSaving(p.key);
                try {
                  await post(
                    `/api/workspaces/${workspace!.id}/plugins/${p.key}/${p.enabled ? 'disable' : 'enable'}`,
                    {},
                  );
                  await qc.invalidateQueries();
                } catch (e) {
                  notify((e as Error).message);
                } finally {
                  setSaving('');
                }
              }}
            >
              {saving === p.key ? '保存中…' : p.enabled ? '停用' : '启用'}
            </button>
          </div>
        ))}
      </div>
      <p className="workspace-list">
        <a href={`/workspaces/${workspace?.key}/data`}>管理基础数据</a>
      </p>
      {me.is_platform_admin && (
        <div className="workspace-archive">
          <button
            className="error"
            onClick={async () => {
              try {
                await post(`/api/workspaces/${workspace!.id}`, { status: 'archived' }, 'PATCH');
                window.location.href = '/workspaces';
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            归档工作空间
          </button>
        </div>
      )}
    </>
  );
}
