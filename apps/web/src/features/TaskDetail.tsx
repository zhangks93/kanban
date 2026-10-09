import { format } from 'date-fns';
import { TaskCreate } from './TaskCreate';

import { PluginTaskPanels } from './PluginTaskPanels';
import { useEffect, useState, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { X, Maximize2, Sun, Link as LinkIcon, Send, Trash2 } from 'lucide-react';
import type { Task, BoardData, Worker } from '@work/shared';
import { estimateDaysOptions } from '@work/shared';
import { TaskWorkLogs } from './TaskWorkLogs';
import { api, post } from '../api/client';
import { useApp } from '../lib/context';
import { useTaskMutations } from '../lib/task-mutations';
import { CompactPopover } from '../components/ui';
export function TaskDetail({
  taskId,
  data,
  onClose,
  full = false,
}: {
  taskId: string;
  data: BoardData;
  onClose: () => void;
  full?: boolean;
}) {
  const task = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api<Task>(`/api/tasks/${taskId}`),
  });
  const content = <TaskBody task={task.data} data={data} onClose={onClose} full={full} />;
  if (full) return <div className="full-detail">{content}</div>;
  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="peek-overlay" />
        <Dialog.Content className="peek">
          <Dialog.Title className="sr-only">任务详情</Dialog.Title>
          <Dialog.Description className="sr-only">
            查看和编辑任务属性、描述及协作记录。
          </Dialog.Description>
          {content}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function DescriptionEditor({
  task,
  save,
}: {
  task: Task;
  save: (fields: Record<string, unknown>) => Promise<void>;
}) {
  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: task.description ?? { type: 'doc', content: [{ type: 'paragraph' }] },
      editable: task.can_edit,
      onBlur: ({ editor }) => {
        if (
          editor.isEditable &&
          JSON.stringify(editor.getJSON()) !==
            JSON.stringify(task.description ?? { type: 'doc', content: [{ type: 'paragraph' }] })
        )
          void save({ description: editor.getJSON(), descriptionText: editor.getText() });
      },
    },
    [task.id, task.can_edit],
  );
  useEffect(() => {
    if (
      editor &&
      !editor.isFocused &&
      JSON.stringify(editor.getJSON()) !== JSON.stringify(task.description)
    )
      editor.commands.setContent(
        task.description ?? { type: 'doc', content: [{ type: 'paragraph' }] },
      );
  }, [task.description, editor]);
  return <EditorContent editor={editor} className="description-editor" />;
}
function TaskBody({
  task,
  data,
  onClose,
  full,
}: {
  task?: Task;
  data: BoardData;
  onClose: () => void;
  full: boolean;
}) {
  const { me, notify } = useApp();
  const mutations = useTaskMutations();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('comments');
  const [comment, setComment] = useState('');
  const [workerSearch, setWorkerSearch] = useState('');
  const [participantOverrides, setParticipantOverrides] = useState<
    Record<string, { checked: boolean; token: number }>
  >({});
  const participantToken = useRef(0);
  const [labelOverrides, setLabelOverrides] = useState<
    Record<string, { checked: boolean; token: number }>
  >({});
  const [createChild, setCreateChild] = useState(false);
  const workers = useQuery({
    queryKey: ['workers', data.board.id],
    queryFn: () => api<Worker[]>(`/api/boards/${data.board.id}/workers`),
  });
  const comments = useQuery({
    queryKey: ['comments', task?.id],
    queryFn: () =>
      api<
        {
          id: string;
          author_id: string;
          author_name: string;
          body: { text?: string; content?: unknown[] };
          created_at: string;
        }[]
      >(`/api/tasks/${task!.id}/comments`),
    enabled: !!task,
  });
  const children = useQuery({
    queryKey: ['children', task?.id],
    queryFn: () => api<Task[]>(`/api/tasks/${task!.id}/children`),
    enabled: !!task,
  });
  const resources = useQuery({
    queryKey: ['resources', task?.id],
    queryFn: () =>
      api<{ id: string; title: string; url: string }[]>(`/api/tasks/${task!.id}/resources`),
    enabled: !!task,
  });
  const activity = useQuery({
    queryKey: ['activity', task?.id],
    queryFn: () =>
      api<{ id: string; action: string; actor_name: string; occurred_at: string }[]>(
        `/api/tasks/${task!.id}/activity`,
      ),
    enabled: !!task,
  });
  const [resource, setResource] = useState({ title: '', url: '' });
  if (!task)
    return (
      <div className="empty" role="status">
        正在加载任务…
      </div>
    );
  const t = task;
  const pickerWorkers: (Worker & { eligible?: boolean })[] = [
    ...(workers.data ?? []).map((w) => ({ ...w, eligible: true })),
    ...t.participants
      .filter((p) => !workers.data?.some((w) => w.userId === p.id))
      .map((p) => ({
        userId: p.id,
        displayName: p.display_name,
        usedWip: 0,
        wipLimit: 0,
        eligible: false,
      })),
  ];
  async function save(fields: Record<string, unknown>, path = '', method = 'PATCH') {
    try {
      await mutations.change(t, path, fields, method);
      await mutations.refresh();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function focus() {
    setBusy(true);
    try {
      await post(
        `/api/tasks/${t.id}/focus`,
        {},
        t.focus_user_ids.includes(me.id) ? 'DELETE' : 'POST',
      );
      await mutations.refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="detail-header">
        <span className="muted">{t.type_name}</span>
        <span className="mono">
          {t.board_key}-{t.seq}
        </span>
        <div className="toolbar-spacer" />
        {!full && (
          <a
            href={`/workspaces/${t.workspace_key}/boards/${t.board_key}/tasks/${t.seq}`}
            aria-label="展开任务"
          >
            <Maximize2 size={16} />
          </a>
        )}
        <button aria-label="关闭任务" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="detail-body">
        <div className="detail-title-row">
          <textarea
            aria-label="任务标题"
            defaultValue={t.title}
            key={t.title}
            rows={2}
            disabled={!t.can_edit}
            onBlur={(e) => {
              if (e.target.value !== t.title) void save({ title: e.target.value });
            }}
          />
          <button
            className={t.focus_user_ids.includes(me.id) ? 'focus-on' : 'focus-button'}
            disabled={busy || (!t.can_focus && !t.focus_user_ids.includes(me.id))}
            onClick={() => void focus()}
          >
            <Sun size={14} />
            {t.focus_user_ids.includes(me.id) ? '已点亮 · 熄灭' : '点亮任务'}
          </button>
        </div>
        <div className="property-grid">
          <label>
            状态
            <select
              value={t.state_id}
              disabled={!t.can_edit}
              onChange={(e) => void save({ stateId: e.target.value }, '/move', 'POST')}
            >
              {data.states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            优先级
            <select
              value={t.priority}
              disabled={!t.can_edit}
              onChange={(e) => void save({ priority: e.target.value })}
            >
              {Object.entries({
                none: '无',
                low: '低',
                medium: '中',
                high: '高',
                urgent: '紧急',
              }).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            负责人
            <select
              value={t.responsible_id}
              disabled={!t.can_edit}
              onChange={(e) => {
                if (t.participants.some((p) => p.id === e.target.value))
                  notify('将从参与人转为负责人');
                void save({ userId: e.target.value }, '/responsible', 'POST');
              }}
            >
              {!workers.data?.some((w) => w.userId === t.responsible_id) && (
                <option value={t.responsible_id}>{t.responsible_name} · 无当前工作权限</option>
              )}
              {workers.data?.map((w) => (
                <option key={w.userId} value={w.userId}>
                  {w.displayName} · {w.usedWip}/{w.wipLimit}
                  {t.participants.some((p) => p.id === w.userId) ? ' · 将转为负责人' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            参与人
            <CompactPopover
              trigger={
                <button className="participant-picker" disabled={!t.can_edit}>
                  {t.participants.length
                    ? t.participants.map((p) => p.display_name).join('、')
                    : '添加参与人'}
                </button>
              }
            >
              <div className="worker-picker">
                <input
                  aria-label="搜索参与人"
                  placeholder="搜索成员"
                  value={workerSearch}
                  onChange={(e) => setWorkerSearch(e.target.value)}
                />
                {pickerWorkers
                  ?.filter(
                    (w) => w.userId !== t.responsible_id && w.displayName.includes(workerSearch),
                  )
                  .map((w) => (
                    <label key={w.userId}>
                      <input
                        type="checkbox"
                        disabled={
                          w.eligible === false &&
                          !(
                            participantOverrides[w.userId]?.checked ??
                            t.participants.some((p) => p.id === w.userId)
                          )
                        }
                        checked={
                          participantOverrides[w.userId]?.checked ??
                          t.participants.some((p) => p.id === w.userId)
                        }
                        onChange={(e) => {
                          const checked = e.target.checked;
                          const token = ++participantToken.current;
                          setParticipantOverrides((old) => ({
                            ...old,
                            [w.userId]: { checked, token },
                          }));
                          void save(
                            checked ? { userId: w.userId } : {},
                            checked ? '/participants' : `/participants/${w.userId}/remove`,
                            'POST',
                          ).finally(() =>
                            setParticipantOverrides((old) => {
                              if (old[w.userId]?.token !== token) return old;
                              const next = { ...old };
                              delete next[w.userId];
                              return next;
                            }),
                          );
                        }}
                      />
                      <span>
                        {w.displayName}
                        {w.eligible === false && <small className="muted"> · 无当前工作权限</small>}
                      </span>
                      <span className="mono muted">
                        {w.eligible === false ? '—' : `${w.usedWip}/${w.wipLimit}`}
                      </span>
                    </label>
                  ))}
              </div>
            </CompactPopover>
          </label>
          <label>
            开始日期
            <input
              aria-label="开始日期"
              type="date"
              value={t.start_date?.slice(0, 10) ?? ''}
              disabled={!t.can_edit}
              onChange={(e) => void save({ startDate: e.target.value || null })}
            />
          </label>
          <label>
            截止日期
            <input
              aria-label="截止日期"
              type="date"
              value={t.due_date?.slice(0, 10) ?? ''}
              disabled={!t.can_edit}
              onChange={(e) => void save({ dueDate: e.target.value || null })}
            />
          </label>
          <label>
            预估工时（天）
            <select
              aria-label="预估工时（天）"
              value={t.estimate_days ?? ''}
              disabled={!t.can_edit}
              onChange={(e) =>
                void save({ estimateDays: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">未估算</option>
              {estimateDaysOptions.map((days) => (
                <option key={days} value={days}>
                  {days} 天
                </option>
              ))}
            </select>
            <small className="muted">斐波那契估算 · 1 天按 8 小时对比</small>
          </label>
        </div>
        {t.participants.some((p) => !p.eligible) && (
          <p className="error">
            {t.participants
              .filter((p) => !p.eligible)
              .map((p) => p.display_name)
              .join('、')}
            ：无当前工作权限
          </p>
        )}
        <details className="secondary-properties">
          <summary>更多属性</summary>
          <div className="property-grid">
            <label>
              持久泳道
              <select
                disabled={!t.can_edit || data.board.lane_mode === 'none'}
                value={t.lane_id ?? ''}
                onChange={(e) => void save({ laneId: e.target.value || null }, '/move', 'POST')}
              >
                <option value="">未分组</option>
                {data.lanes
                  .filter((l) => l.status === 'active')
                  .map((l) => (
                    <option value={l.id} key={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              类型
              <select
                value={t.type_id}
                disabled={!t.can_edit}
                onChange={(e) => void save({ typeId: e.target.value })}
              >
                {data.types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              里程碑
              <select
                value={t.milestone_id ?? ''}
                disabled={!t.can_edit}
                onChange={(e) => void save({ milestoneId: e.target.value || null })}
              >
                <option value="">无</option>
                {data.milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              父任务 ID
              <input
                key={t.parent_id}
                defaultValue={t.parent_id ?? ''}
                disabled={!t.can_edit}
                onBlur={(e) => {
                  if (e.target.value !== (t.parent_id ?? ''))
                    void save({ parentId: e.target.value || null });
                }}
              />
            </label>
          </div>
          <div className="labels-picker">
            {data.labels.map((l) => (
              <label key={l.id}>
                <input
                  type="checkbox"
                  disabled={!t.can_edit}
                  checked={
                    labelOverrides[l.id]?.checked ?? t.labels?.some((tl) => tl.id === l.id) ?? false
                  }
                  onChange={(e) => {
                    const checked = e.target.checked;
                    const token = ++participantToken.current;
                    setLabelOverrides((old) => ({ ...old, [l.id]: { checked, token } }));
                    void save(
                      checked ? { labelId: l.id } : {},
                      checked ? '/labels' : `/labels/${l.id}/remove`,
                      'POST',
                    ).finally(() =>
                      setLabelOverrides((old) => {
                        if (old[l.id]?.token !== token) return old;
                        const next = { ...old };
                        delete next[l.id];
                        return next;
                      }),
                    );
                  }}
                />
                {l.name}
              </label>
            ))}
          </div>
        </details>
        <PluginTaskPanels task={t} data={data} />
        <TaskWorkLogs key={t.id} task={t} />
        <section className="task-children">
          <h3>子任务</h3>
          {children.data?.map((child) => (
            <a
              href={`/workspaces/${child.workspace_key}/boards/${child.board_key}/tasks/${child.seq}`}
              key={child.id}
            >
              <span className="mono muted">
                {child.board_key}-{child.seq}
              </span>
              {child.title}
            </a>
          ))}
          {t.can_edit && <button onClick={() => setCreateChild(true)}>添加子任务</button>}
        </section>
        <section className="detail-description">
          <h3>描述</h3>
          <DescriptionEditor task={t} save={save} />
        </section>
        <section>
          <h3>资源链接</h3>
          {resources.data?.map((r) => (
            <a className="resource-row" href={r.url} target="_blank" rel="noreferrer" key={r.id}>
              <LinkIcon size={14} />
              {r.title}
            </a>
          ))}
          {t.can_edit && (
            <form
              className="resource-form"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await post(`/api/tasks/${t.id}/resources`, resource);
                  setResource({ title: '', url: '' });
                  await resources.refetch();
                } catch (err) {
                  notify((err as Error).message);
                }
              }}
            >
              <input
                placeholder="标题"
                value={resource.title}
                onChange={(e) => setResource({ ...resource, title: e.target.value })}
                required
              />
              <input
                placeholder="https://…"
                type="url"
                value={resource.url}
                onChange={(e) => setResource({ ...resource, url: e.target.value })}
                required
              />
              <button aria-label="添加链接">
                <PlusIcon />
              </button>
            </form>
          )}
        </section>
        <div className="detail-tabs">
          <button className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>
            评论 {comments.data?.length ?? 0}
          </button>
          <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
            动态
          </button>
        </div>
        {tab === 'comments' ? (
          <>
            <div className="comments">
              {comments.data?.map((c) => (
                <div className="comment-row" key={c.id}>
                  <span className="avatar">{c.author_name.slice(0, 1)}</span>
                  <div>
                    <strong>{c.author_name}</strong>
                    <span className="muted">
                      {' '}
                      · {format(new Date(c.created_at), 'yyyy-MM-dd HH:mm')}
                    </span>
                    <p>{c.body.text ?? '富文本评论'}</p>
                  </div>
                </div>
              ))}
            </div>
            {t.can_edit && (
              <form
                className="comment-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await post(`/api/tasks/${t.id}/comments`, { body: { text: comment } });
                    setComment('');
                    await comments.refetch();
                  } catch (err) {
                    notify((err as Error).message);
                  }
                }}
              >
                <textarea
                  aria-label="评论内容"
                  placeholder="写下进展或问题…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  required
                />
                <button aria-label="发送评论" disabled={!comment.trim()}>
                  <Send size={14} />
                </button>
              </form>
            )}
          </>
        ) : (
          <div className="activity">
            {activity.data?.map((a) => (
              <p key={a.id}>
                <span>{a.actor_name ?? '系统'}</span> ·{' '}
                {{
                  created: '创建任务',
                  updated: '更新任务',
                  'participant.add': '添加参与人',
                  'participant.remove': '移除参与人',
                  'comment.add': '发表评论',
                  'resource.add': '添加资源',
                  'work-log.add': '登记工时',
                  'work-log.update': '修改工时',
                  'work-log.delete': '删除工时',
                }[a.action] ?? a.action}
                <time className="muted">{format(new Date(a.occurred_at), 'yyyy-MM-dd HH:mm')}</time>
              </p>
            ))}
          </div>
        )}
        {t.can_edit && (
          <button
            className="delete-task error"
            onClick={async () => {
              try {
                await post(`/api/tasks/${t.id}`, { expectedVersion: t.version }, 'DELETE');
                await mutations.refresh();
                onClose();
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <Trash2 size={13} />
            删除任务
          </button>
        )}
      </div>
      {createChild && (
        <TaskCreate data={data} open onClose={() => setCreateChild(false)} initialParent={t.id} />
      )}
    </>
  );
}
function PlusIcon() {
  return <span aria-hidden="true">＋</span>;
}
