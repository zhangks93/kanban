import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../lib/context';
import { api, post } from '../api/client';
import { installedPlugins } from '../plugins/registry';
export function PluginSettings() {
  const { workspace, me, notify } = useApp();
  const qc = useQueryClient();
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
      <header className="page-heading">
        <div>
          <h1>插件</h1>
          <p className="muted">专业领域能力按工作空间独立启用，共用任务、权限与全局 WIP。</p>
        </div>
      </header>
      <div className="workspace-list">
        {plugins.data?.map((p) => (
          <div className="workspace-row" key={p.key}>
            <div>
              <strong>{p.name}</strong>
              <p className="muted">
                {installedPlugins
                  .find((i) => i.manifest.key === p.key)
                  ?.manifest.boardTemplates?.map((t) => t.name)
                  .join('、')}
              </p>
            </div>
            <span className="muted">{p.enabled ? '已启用' : '未启用'}</span>
            <button
              disabled={!can}
              onClick={async () => {
                try {
                  await post(
                    `/api/workspaces/${workspace!.id}/plugins/${p.key}/${p.enabled ? 'disable' : 'enable'}`,
                    {},
                  );
                  await qc.invalidateQueries();
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              {p.enabled ? '停用' : '启用'}
            </button>
          </div>
        ))}
      </div>
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
