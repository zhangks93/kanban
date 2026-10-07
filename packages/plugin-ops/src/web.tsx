import { format } from 'date-fns';
import type { WorkPluginWeb, PanelProps } from '@work/plugin-sdk';
function OpsPanel({ task, mutate, options, disabled }: PanelProps) {
  return (
    <section className="plugin-panel">
      <h3>运维属性</h3>
      <div className="property-grid">
        <label>
          严重程度
          <select
            disabled={disabled}
            value={String(task.plugin_fields?.severity ?? '')}
            onChange={(e) => void mutate({ severity: e.target.value || null })}
          >
            <option value="">未设置</option>
            {['P1', 'P2', 'P3', 'P4'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          服务
          <select
            disabled={disabled}
            value={String(task.plugin_fields?.service_id ?? '')}
            onChange={(e) => void mutate({ service_id: e.target.value || null })}
          >
            <option value="">未设置</option>
            {options.ops_service?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          发现时间
          <input
            type="datetime-local"
            disabled={disabled}
            value={
              task.plugin_fields?.detected_at
                ? format(new Date(String(task.plugin_fields.detected_at)), "yyyy-MM-dd'T'HH:mm")
                : ''
            }
            onChange={(e) =>
              void mutate({
                detected_at: e.target.value ? new Date(e.target.value).toISOString() : null,
              })
            }
          />
        </label>
        <label>
          恢复时间
          <input
            type="datetime-local"
            disabled={disabled}
            value={
              task.plugin_fields?.recovered_at
                ? format(new Date(String(task.plugin_fields.recovered_at)), "yyyy-MM-dd'T'HH:mm")
                : ''
            }
            onChange={(e) =>
              void mutate({
                recovered_at: e.target.value ? new Date(e.target.value).toISOString() : null,
              })
            }
          />
        </label>
      </div>
      <label className="impact-field">
        影响范围
        <textarea
          disabled={disabled}
          key={String(task.plugin_fields?.impact ?? '')}
          defaultValue={String(task.plugin_fields?.impact ?? '')}
          onBlur={(e) => void mutate({ impact: e.target.value })}
        />
      </label>
    </section>
  );
}
export const web: WorkPluginWeb = {
  key: 'ops',
  routes: [{ path: 'ops/services', title: '运维服务' }],
  navItems: [{ path: 'ops/services', title: '运维服务' }],
  taskPanels: [{ key: 'ops', component: OpsPanel }],
  boardPanels: [{ key: 'ops-lanes', title: '运维泳道' }],
  groupProviders: [
    { key: 'severity', label: '严重程度', field: 'severity' },
    { key: 'service', label: '服务', field: 'service_id' },
  ],
};
