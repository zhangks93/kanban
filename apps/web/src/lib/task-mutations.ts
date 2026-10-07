import { useQueryClient } from '@tanstack/react-query';
import type { Task } from '@work/shared';
import { TaskQueue } from './task-queue';
import { post } from '../api/client';
const queues = new WeakMap<object, TaskQueue>();
export function useTaskMutations() {
  const qc = useQueryClient();
  let queue = queues.get(qc);
  if (!queue) {
    queue = new TaskQueue(
      (id) =>
        qc.getQueryData<Task>(['task', id]) ??
        qc
          .getQueriesData<Task[]>({ queryKey: ['tasks'] })
          .flatMap(([, data]) => (Array.isArray(data) ? data : []))
          .find((t) => t.id === id),
      (task) => {
        qc.setQueryData(['task', task.id], task);
        qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) =>
          old?.map((t) => (t.id === task.id ? task : t)),
        );
      },
      async (id) => {
        await qc.invalidateQueries({ queryKey: ['task', id] });
        await qc.invalidateQueries({ queryKey: ['tasks'] });
      },
    );
    queues.set(qc, queue);
  }
  return {
    change: (task: Task, path: string, body: Record<string, unknown>, method = 'POST') =>
      queue!.enqueue(task.id, (version) =>
        post<Task>(`/api/tasks/${task.id}${path}`, { ...body, expectedVersion: version }, method),
      ),
    plugin: (task: Task, key: string, fields: Record<string, unknown>) =>
      queue!.enqueue(task.id, (version) =>
        post<Task>(
          `/api/plugins/${key}/tasks/${task.id}`,
          { ...fields, expectedVersion: version },
          'PATCH',
        ),
      ),
    refresh: () => qc.invalidateQueries(),
  };
}
