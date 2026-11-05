import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '../components/PageLayout';
import { useApp } from '../lib/context';
import { api, post } from '../api/client';
import '../styles/foundation-data.css';

type System = { id: string; name: string };
type Project = System & { system_id: string };
type FoundationData = { systems: System[]; projects: Project[] };
type DataKind = 'systems' | 'projects';
type Editor = { id?: string; name: string; systemId: string };

export function FoundationDataPage() {
  const { workspace, notify } = useApp();
  const qc = useQueryClient();
  const [kind, setKind] = useState<DataKind>('systems');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [systemFilter, setSystemFilter] = useState('');
  const canManage = ['owner', 'admin'].includes(workspace?.role ?? '');
  const data = useQuery({
    queryKey: ['foundation-data', workspace?.id],
    queryFn: () => api<FoundationData>(`/api/workspaces/${workspace!.id}/data`),
    enabled: !!workspace,
  });
  useEffect(() => {
    setEditor(null);
    setSystemFilter('');
  }, [workspace?.id, kind]);
  const systems = data.data?.systems ?? [];
  const projects = data.data?.projects ?? [];
  const rows =
    kind === 'systems'
      ? systems
      : projects.filter((p) => !systemFilter || p.system_id === systemFilter);
  const label = kind === 'systems' ? '系统' : '项目';
  const base = `/api/workspaces/${workspace?.id}/data/${kind}`;

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['foundation-data', workspace?.id] }),
      qc.invalidateQueries({ queryKey: ['plugin-options'] }),
    ]);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || busy) return;
    setBusy(true);
    try {
      await post(
        `${base}${editor.id ? `/${editor.id}` : ''}`,
        {
          name: editor.name.trim(),
          ...(kind === 'projects' ? { systemId: editor.systemId } : {}),
        },
        editor.id ? 'PATCH' : 'POST',
      );
      setEditor(null);
      await refresh();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(row: System) {
    if (busy || !window.confirm(`删除${label}“${row.name}”？`)) return;
    setBusy(true);
    try {
      await post(`${base}/${row.id}`, {}, 'DELETE');
      await refresh();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!workspace) return <div className="empty">请选择工作空间</div>;
  return (
    <>
      <PageHeader
        title="基础数据"
        eyebrow="空间协作"
        description="统一维护系统和项目，为研发与运维任务提供一致的业务关联。"
        actions={
          canManage && (
            <button
              className="primary"
              disabled={busy || (kind === 'projects' && systems.length === 0)}
              onClick={() =>
                setEditor({ name: '', systemId: systemFilter || systems[0]?.id || '' })
              }
            >
              <Plus size={16} />
              添加{label}
            </button>
          )
        }
      />
      <div className="foundation-data">
        <div className="foundation-toolbar">
          <nav className="foundation-tabs" aria-label="基础数据分类">
            <button
              aria-current={kind === 'systems' ? 'page' : undefined}
              onClick={() => setKind('systems')}
            >
              系统 <span>{systems.length}</span>
            </button>
            <button
              aria-current={kind === 'projects' ? 'page' : undefined}
              onClick={() => setKind('projects')}
            >
              项目 <span>{projects.length}</span>
            </button>
          </nav>
          {kind === 'projects' && projects.length > 0 && (
            <select
              aria-label="按系统筛选项目"
              value={systemFilter}
              onChange={(event) => setSystemFilter(event.target.value)}
            >
              <option value="">全部系统</option>
              {systems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {editor && canManage && (
          <form className="foundation-editor" onSubmit={(event) => void save(event)}>
            <label>
              {label}名称
              <input
                autoFocus
                required
                maxLength={100}
                value={editor.name}
                onChange={(event) => setEditor({ ...editor, name: event.target.value })}
              />
            </label>
            {kind === 'projects' && (
              <label>
                所属系统
                <select
                  required
                  value={editor.systemId}
                  onChange={(event) => setEditor({ ...editor, systemId: event.target.value })}
                >
                  <option value="">选择系统</option>
                  {systems.map((system) => (
                    <option key={system.id} value={system.id}>
                      {system.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="foundation-actions">
              <button
                type="submit"
                className="primary"
                disabled={busy || !editor.name.trim() || (kind === 'projects' && !editor.systemId)}
              >
                {busy ? '保存中…' : '保存'}
              </button>
              <button type="button" disabled={busy} onClick={() => setEditor(null)}>
                取消
              </button>
            </div>
          </form>
        )}
        {data.isPending ? (
          <div className="empty" role="status">
            加载中…
          </div>
        ) : data.isError ? (
          <div className="empty" role="alert">
            加载失败 <button onClick={() => void data.refetch()}>重试</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            {kind === 'projects' && systems.length === 0
              ? '请先添加系统，再创建项目。'
              : `暂无${label}`}
          </div>
        ) : (
          <table className="foundation-table">
            <thead>
              <tr>
                <th>{label}名称</th>
                <th>{kind === 'systems' ? '关联项目' : '所属系统'}</th>
                {canManage && <th className="foundation-action-cell">操作</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td className="muted">
                    {kind === 'systems'
                      ? projects.filter((project) => project.system_id === row.id).length
                      : (systems.find((system) => system.id === (row as Project).system_id)?.name ??
                        '—')}
                  </td>
                  {canManage && (
                    <td className="foundation-action-cell">
                      <button
                        disabled={busy}
                        onClick={() =>
                          setEditor({
                            id: row.id,
                            name: row.name,
                            systemId: (row as Project).system_id ?? '',
                          })
                        }
                      >
                        编辑
                      </button>
                      <button className="error" disabled={busy} onClick={() => void remove(row)}>
                        删除
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// Keep existing plugin URLs available while their navigation moves to one data module.
export const PluginDomainPage = FoundationDataPage;
