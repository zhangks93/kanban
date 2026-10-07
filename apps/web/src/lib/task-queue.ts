import type { Task } from '@work/shared';
// All version-bearing operations on one Task share this queue, including participants.
export class TaskQueue {
  private entries = new Map<string, { tail: Promise<unknown>; generation: number }>();
  constructor(
    private read: (id: string) => Task | undefined,
    private write: (task: Task) => void,
    private invalidate: (id: string) => Promise<void>,
  ) {}
  enqueue(id: string, mutation: (version: number) => Promise<Task>): Promise<Task> {
    const state = this.entries.get(id) ?? { tail: Promise.resolve(), generation: 0 };
    this.entries.set(id, state);
    const generation = state.generation;
    const run = state.tail
      .catch(() => {})
      .then(async () => {
        if (state.generation !== generation) throw Error('任务变更队列已清空，请重新操作');
        const task = this.read(id);
        if (!task) throw Error('任务尚未加载');
        try {
          const next = await mutation(task.version);
          this.write(next);
          return next;
        } catch (e) {
          state.generation++;
          await this.invalidate(id);
          throw e;
        }
      });
    state.tail = run;
    return run;
  }
}
