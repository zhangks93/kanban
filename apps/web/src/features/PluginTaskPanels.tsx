import { useQuery } from '@tanstack/react-query';
import type { Task, BoardData } from '@work/shared';
import { installedPlugins } from '../plugins/registry';
import { useTaskMutations } from '../lib/task-mutations';
import { useApp } from '../lib/context';
import { api } from '../api/client';
export function PluginTaskPanels({ task, data }: { task: Task; data: BoardData }) {
  const { notify } = useApp();
  const mutations = useTaskMutations();
  const key = data.board.plugin_key;
  const plugin = installedPlugins.find((p) => p.manifest.key === key);
  const enabled = useQuery({
    queryKey: ['plugins', task.workspace_id],
    queryFn: () =>
      api<{ key: string; enabled: boolean }[]>(`/api/workspaces/${task.workspace_id}/plugins`),
  });
  const isEnabled = enabled.data?.some((p) => p.key === key && p.enabled);
  const options = useQuery({
    queryKey: ['plugin-options', key, data.board.id],
    queryFn: () =>
      api<Record<string, { id: string; name: string }[]>>(
        `/api/plugins/${key}/boards/${data.board.id}/options`,
      ),
    enabled: !!isEnabled && !!plugin,
  });
  if (!plugin || !isEnabled) return null;
  return (
    <>
      {plugin.web.taskPanels?.map((panel) => {
        const Panel = panel.component;
        return (
          <Panel
            key={panel.key}
            task={task}
            disabled={!task.can_edit}
            options={options.data ?? {}}
            mutate={async (fields) => {
              try {
                await mutations.plugin(task, key!, fields);
                await mutations.refresh();
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          />
        );
      })}
    </>
  );
}
