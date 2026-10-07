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
  async function save(field: string, value: string) {
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
      <summary>{plugin?.manifest.laneExtensions?.[0].name}属性</summary>
      {key === 'rnd' ? (
        <div className="form-grid">
          {[
            ['project_code', '项目编号'],
            ['owner_id', '负责人 ID'],
            ['start_date', '开始日期'],
            ['target_end_date', '目标结束'],
          ].map(([f, label]) => (
            <label key={f}>
              {label}
              <input
                type={f.endsWith('_date') ? 'date' : 'text'}
                key={ext.data![f]}
                defaultValue={ext.data![f] ?? ''}
                onBlur={(e) => {
                  if (e.target.value !== (ext.data![f] ?? '')) void save(f, e.target.value);
                }}
              />
            </label>
          ))}
        </div>
      ) : (
        <>
          <label>
            服务
            <select
              value={ext.data.service_id ?? ''}
              onChange={(e) => void save('service_id', e.target.value)}
            >
              <option value="">未设置</option>
              {options.data?.ops_service?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            说明
            <input
              defaultValue={ext.data.description ?? ''}
              onBlur={(e) => void save('description', e.target.value)}
            />
          </label>
        </>
      )}
    </details>
  );
}
