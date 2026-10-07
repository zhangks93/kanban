import { useLocation } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Board } from '@work/shared';
import { useApp } from '../lib/context';
import { api, post } from '../api/client';
import { installedPlugins } from '../plugins/registry';
export function PluginDomainPage() {
  const path = useLocation().pathname;
  const key = path.includes('/rnd/') ? 'rnd' : 'ops';
  const { workspace, notify } = useApp();
  const qc = useQueryClient();
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [system, setSystem] = useState('');
  const [kind, setKind] = useState(key === 'rnd' ? 'systems' : 'services');
  const enabled = useQuery({
    queryKey: ['plugins', workspace?.id],
    queryFn: () =>
      api<{ key: string; enabled: boolean }[]>(`/api/workspaces/${workspace!.id}/plugins`),
    enabled: !!workspace,
  });
  const boards = useQuery({
    queryKey: ['boards', workspace?.id],
    queryFn: () => api<Board[]>(`/api/workspaces/${workspace!.id}/boards`),
    enabled: !!workspace,
  });
  const list = boards.data?.filter((b) => b.plugin_key === key) ?? [];
  const bid = selected || list[0]?.id;
  const options = useQuery({
    queryKey: ['plugin-options', key, bid],
    queryFn: () =>
      api<Record<string, { id: string; name: string }[]>>(
        `/api/plugins/${key}/boards/${bid}/options`,
      ),
    enabled: !!bid && !!enabled.data?.some((p) => p.key === key && p.enabled),
  });
  const plugin = installedPlugins.find((p) => p.manifest.key === key);
  if (enabled.isFetched && !enabled.data?.some((p) => p.key === key && p.enabled))
    return <div className="empty">当前工作空间未启用此插件。</div>;
  return (
    <>
      <header className="page-heading">
        <div>
          <h1>{plugin?.web.routes?.[0].title}</h1>
          <p className="muted">领域对象按看板隔离；动态分组不改变持久泳道。</p>
        </div>
        <select
          aria-label="选择领域看板"
          value={bid ?? ''}
          onChange={(e) => setSelected(e.target.value)}
        >
          {list.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </header>
      {!bid ? (
        <div className="empty">先创建此插件的看板。</div>
      ) : (
        <div className="domain-content">
          {Object.entries(options.data ?? {}).map(([table, rows]) => (
            <section key={table}>
              <h2>{table === 'rnd_system' ? '系统' : table === 'rnd_module' ? '模块' : '服务'}</h2>
              {rows.map((r) => (
                <div className="domain-row" key={r.id}>
                  {r.name}
                  <span className="mono muted">{r.id.slice(0, 8)}</span>
                </div>
              ))}
              {rows.length === 0 && <p className="muted">暂无记录</p>}
            </section>
          ))}
          {list.find((b) => b.id === bid)?.can_manage && (
            <form
              className="domain-form"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await post(`/api/plugins/${key}/boards/${bid}/${kind}`, {
                    name,
                    systemId: kind === 'modules' ? system : undefined,
                  });
                  setName('');
                  await qc.invalidateQueries({ queryKey: ['plugin-options'] });
                } catch (err) {
                  notify((err as Error).message);
                }
              }}
            >
              {key === 'rnd' && (
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="systems">系统</option>
                  <option value="modules">模块</option>
                </select>
              )}
              {kind === 'modules' && (
                <select
                  aria-label="所属系统"
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                  required
                >
                  <option value="">选择系统</option>
                  {options.data?.rnd_system?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
              <input
                aria-label="领域对象名称"
                placeholder="名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <button>添加</button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
