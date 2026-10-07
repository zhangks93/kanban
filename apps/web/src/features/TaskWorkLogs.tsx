import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  hoursPerDay,
  workLogSchema,
  type Task,
  type WorkLog,
  type WorkLogPage,
} from '@work/shared';
import { api, post } from '../api/client';
import { useApp } from '../lib/context';

export function TaskWorkLogs({ task }: { task: Task }) {
  const { me, notify } = useApp();
  const qc = useQueryClient();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState({ workDate: today, hours: '1', note: '' });
  const [editing, setEditing] = useState<WorkLog | null>(null);
  const [deleting, setDeleting] = useState<WorkLog | null>(null);
  const [busy, setBusy] = useState(false);
  const mutationId = useRef(crypto.randomUUID());
  const logs = useQuery({
    queryKey: ['work-logs', task.id, offset],
    queryFn: () => api<WorkLogPage>(`/api/tasks/${task.id}/work-logs?offset=${offset}`),
  });
  const total = logs.data?.totalHours ?? task.logged_hours;
  const budget = task.estimate_days === null ? null : task.estimate_days * hoursPerDay;
  function reset() {
    setEditing(null);
    setDraft({ workDate: today, hours: '1', note: '' });
    mutationId.current = crypto.randomUUID();
  }
  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['work-logs', task.id] }),
      qc.invalidateQueries({ queryKey: ['work-report'] }),
      qc.invalidateQueries({ queryKey: ['tasks'] }),
      qc.invalidateQueries({ queryKey: ['task', task.id] }),
      qc.invalidateQueries({ queryKey: ['activity', task.id] }),
    ]);
  }
  return (
    <section className="task-work-logs" aria-label="任务工时">
      <h3>工时记录</h3>
      <div className="effort-summary">
        <strong>累计投入 {total} 小时</strong>
        <span className="muted">
          {budget === null ? '尚未估算' : `预估 ${task.estimate_days} 天 · ${budget} 小时`}
        </span>
        {budget !== null && (
          <span className={total > budget ? 'error' : 'muted'}>
            {total > budget
              ? `超出预估 ${total - budget} 小时`
              : `已投入预估的 ${Math.round((total / budget) * 100)}%`}
          </span>
        )}
      </div>
      <p className="muted">
        记录实际工作日期及投入，最小单位 1 小时；可补录，不能填写未来日期（北京时间）。
      </p>
      {task.can_edit && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const parsed = workLogSchema.safeParse({ ...draft, hours: Number(draft.hours) });
            if (!parsed.success) {
              notify(parsed.error.issues[0].message);
              return;
            }
            setBusy(true);
            try {
              await post(
                `/api/tasks/${task.id}/work-logs${editing ? `/${editing.id}` : ''}`,
                {
                  ...parsed.data,
                  ...(editing
                    ? { expectedVersion: editing.version }
                    : { clientMutationId: mutationId.current }),
                },
                editing ? 'PATCH' : 'POST',
              );
              reset();
              setOffset(0);
              await refresh();
            } catch (error) {
              notify((error as Error).message);
              await logs.refetch();
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <legend>{editing ? '修改我的工时记录' : '登记我的工时'}</legend>
            <div className="form-grid">
              <label>
                工作日期
                <input
                  type="date"
                  required
                  max={today}
                  value={draft.workDate}
                  onChange={(e) => setDraft({ ...draft, workDate: e.target.value })}
                />
              </label>
              <label>
                投入工时（小时）
                <input
                  type="number"
                  required
                  min={1}
                  max={24}
                  step={1}
                  value={draft.hours}
                  onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
                />
              </label>
            </div>
            <label>
              工作说明
              <textarea
                aria-label="工作说明"
                required
                maxLength={2000}
                rows={2}
                placeholder="简述今天在这个任务上完成的工作…"
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </label>
            <div className="dialog-actions">
              {editing && (
                <button type="button" onClick={reset}>
                  取消修改
                </button>
              )}
              <button className="primary" disabled={!draft.note.trim()}>
                {busy ? '正在保存…' : editing ? '保存修改' : '登记工时'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {logs.isLoading && <p role="status">正在加载工时…</p>}
      {logs.isError && (
        <p role="alert" className="error">
          工时加载失败。<button onClick={() => void logs.refetch()}>重试</button>
        </p>
      )}
      {logs.data?.total === 0 && <p className="muted">暂无工时记录。</p>}
      {logs.data?.entries.map((log) => (
        <article className="work-log-row" key={log.id}>
          <div className="work-log-meta">
            <strong>{log.user_name}</strong>
            <time>{log.work_date}</time>
            <span>{log.hours} 小时</span>
            {log.version > 1 && (
              <small className="muted">
                已修改 · {format(new Date(log.updated_at), 'MM-dd HH:mm')}
              </small>
            )}
          </div>
          <p>{log.note}</p>
          {task.can_edit && log.user_id === me.id && (
            <div className="work-log-actions">
              <button
                disabled={busy}
                onClick={() => {
                  setDeleting(null);
                  setEditing(log);
                  setDraft({ workDate: log.work_date, hours: String(log.hours), note: log.note });
                }}
              >
                修改记录
              </button>
              <button className="error" disabled={busy} onClick={() => setDeleting(log)}>
                删除记录
              </button>
              {deleting?.id === log.id && (
                <>
                  <span>确认删除这条工时？</span>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await post(
                          `/api/tasks/${task.id}/work-logs/${log.id}`,
                          { expectedVersion: log.version },
                          'DELETE',
                        );
                        setDeleting(null);
                        if (editing?.id === log.id) reset();
                        setOffset(0);
                        await refresh();
                      } catch (error) {
                        notify((error as Error).message);
                        await logs.refetch();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    确认删除
                  </button>
                  <button disabled={busy} onClick={() => setDeleting(null)}>
                    取消删除
                  </button>
                </>
              )}
            </div>
          )}
        </article>
      ))}
      {(logs.data?.total ?? 0) > 50 && (
        <div className="work-log-actions">
          <button disabled={offset === 0} onClick={() => setOffset(offset - 50)}>
            上一页
          </button>
          <span>
            第 {Math.floor(offset / 50) + 1} 页 · 共 {logs.data!.total} 条
          </span>
          <button disabled={offset + 50 >= logs.data!.total} onClick={() => setOffset(offset + 50)}>
            下一页
          </button>
        </div>
      )}
    </section>
  );
}
