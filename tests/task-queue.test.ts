import { test, expect } from 'vitest';
import { TaskQueue } from '../apps/web/src/lib/task-queue';
import type { Task } from '../packages/shared/src';
test('rapid edits use each preceding response version and stop after conflict', async () => {
  let current = { id: 'task', version: 1 } as Task;
  const versions: number[] = [];
  let invalidated = false;
  const queue = new TaskQueue(
    () => current,
    (t) => {
      current = t;
    },
    async () => {
      invalidated = true;
    },
  );
  const edit = async (v: number) => {
    versions.push(v);
    return { ...current, version: v + 1 };
  };
  await Promise.all([
    queue.enqueue('task', edit),
    queue.enqueue('task', edit),
    queue.enqueue('task', edit),
  ]);
  expect(versions).toEqual([1, 2, 3]);
  const failure = queue.enqueue('task', async () => {
    throw Error('VERSION_CONFLICT');
  });
  const skipped = queue.enqueue('task', edit);
  const results = await Promise.allSettled([failure, skipped]);
  expect(results.every((r) => r.status === 'rejected')).toBe(true);
  expect(invalidated).toBe(true);
  expect(versions).toEqual([1, 2, 3]);
});
