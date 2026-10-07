import type { WorkPluginWeb, PanelProps } from '@work/plugin-sdk';
function RndPanel({ task, mutate, options, disabled }: PanelProps) {
  return (
    <section className="plugin-panel">
      <h3>研发属性</h3>
      <div className="property-grid">
        <label>
          系统
          <select
            value={String(task.plugin_fields?.system_id ?? '')}
            disabled={disabled}
            onChange={(e) => void mutate({ system_id: e.target.value || null, module_id: null })}
          >
            <option value="">未设置</option>
            {options.rnd_system?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          模块
          <select
            value={String(task.plugin_fields?.module_id ?? '')}
            disabled={disabled}
            onChange={(e) => void mutate({ module_id: e.target.value || null })}
          >
            <option value="">未设置</option>
            {options.rnd_module?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
export const web: WorkPluginWeb = {
  key: 'rnd',
  routes: [{ path: 'rnd/systems', title: '研发系统与模块' }],
  navItems: [{ path: 'rnd/systems', title: '研发系统' }],
  taskPanels: [{ key: 'rnd', component: RndPanel }],
  boardPanels: [{ key: 'rnd-projects', title: '项目泳道' }],
  groupProviders: [
    { key: 'system', label: '系统', field: 'system_id' },
    { key: 'module', label: '模块', field: 'module_id' },
  ],
};
