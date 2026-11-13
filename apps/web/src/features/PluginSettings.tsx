import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../lib/context';
import { post } from '../api/client';
import { useWorkspacePlugins } from '../plugins/useWorkspacePlugins';
import { useState } from 'react';
export function PluginSettings() {
  const { workspace, me, notify } = useApp();
  const qc = useQueryClient();
  const [saving, setSaving] = useState('');
  const plugins = useWorkspacePlugins(workspace?.id);
  const can = ['owner', 'admin'].includes(workspace?.role ?? '');
  return (
    <>
      <header className="page-heading">
        <div>
          <h1>插件设置</h1>
        </div>
      </header>
      <div className="workspace-list">
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
      {plugins.systems && (
        <p className="workspace-list">
          <a href={`/workspaces/${workspace?.key}/data`}>管理基础数据</a>
        </p>
      )}
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
