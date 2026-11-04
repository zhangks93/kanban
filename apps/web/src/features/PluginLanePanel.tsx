import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardData, Lane } from '@work/shared';
import { api, post } from '../api/client';
import { useApp } from '../lib/context';
import { installedPlugins } from '../plugins/registry';
export function PluginLanePanel({ data, lane }: { data: BoardData; lane: Lane }) {
  const key = data.board.plugin_key;
  const plugin = installedPlugins.find((p) => p.manifest.key === key);
  const { notify } = useApp();
  const qc = useQueryClient();
  const enabled = useQuery({
    queryKey: ['plugins', data.board.workspace_id],
    queryFn: () =>
      api<{ key: string; enabled: boolean }[]>(
        `/api/workspaces/${data.board.workspace_id}/plugins`,
      ),
  });
  const active =
    !!enabled.data?.some((p) => p.key === key && p.enabled) &&
    !!plugin?.manifest.laneExtensions?.length;
  const ext = useQuery({
    queryKey: ['lane-ext', key, lane.id],
    queryFn: () =>
      api<Record<string, string | null>>(
        `/api/plugins/${key}/boards/${data.board.id}/lanes/${lane.id}`,
      ),
    enabled: active,
  });
  const options = useQuery({
    queryKey: ['plugin-options', key, data.board.id],
    queryFn: () =>
      api<Record<string, { id: string; name: string }[]>>(
        `/api/plugins/${key}/boards/${data.board.id}/options`,
      ),
    enabled: active,
  });
  const members = useQuery({
    queryKey: ['members', data.board.workspace_id],
    queryFn: () =>
      api<{ id: string; display_name: string; status: string; account_status: string }[]>(
        `/api/workspaces/${data.board.workspace_id}/members`,
      ),
    enabled: active && key === 'rnd',
  });
  const disabled = !data.board.can_manage;
  async function save(field: string, value: string) {
    if (disabled) return;
    try {
      await post(
        `/api/plugins/${key}/boards/${data.board.id}/lanes/${lane.id}`,
        { [field]: value || null },
        'PATCH',
      );
      await qc.invalidateQueries({ queryKey: ['lane-ext'] });
    } catch (e) {
      notify((e as Error).message);
    }
  }
  if (!active || !ext.data) return null;
  return (
    <details className="lane-extension">
      <summary>{key === 'rnd' ? '项目设置' : '运维设置'}</summary>
      {key === 'rnd' ? (
        <div className="form-grid">
          <label>
            项目
            <select
              disabled={disabled}
              value={ext.data.project_id ?? ''}
              onChange={(e) => void save('project_id', e.target.value)}
            >
              <option value="">未设置</option>
              {options.data?.projects?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            负责人
            <select
              disabled={disabled}
              value={ext.data.owner_id ?? ''}
              onChange={(e) => void save('owner_id', e.target.value)}
            >
              <option value="">未设置</option>
              {members.data
                ?.filter(
                  (member) => member.status === 'active' && member.account_status === 'active',
                )
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.display_name}
                  </option>
                ))}
            </select>
          </label>
          {[
            ['start_date', '开始日期'],
            ['target_end_date', '目标结束'],
          ].map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                type="date"
                disabled={disabled}
                key={ext.data![field]}
                defaultValue={ext.data![field] ?? ''}
                onBlur={(e) => {
                  if (e.target.value !== (ext.data![field] ?? '')) void save(field, e.target.value);
                }}
              />
            </label>
          ))}
        </div>
      ) : (
        <>
          <label>
            系统
            <select
              disabled={disabled}
              value={ext.data.system_id ?? ''}
              onChange={(e) => void save('system_id', e.target.value)}
            >
              <option value="">未设置</option>
              {options.data?.systems?.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            说明
            <input
              disabled={disabled}
              key={ext.data.description}
              defaultValue={ext.data.description ?? ''}
              onBlur={(e) => {
                if (e.target.value !== (ext.data!.description ?? ''))
                  void save('description', e.target.value);
              }}
            />
          </label>
        </>
      )}
    </details>
  );
}
