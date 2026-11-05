import { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useQuery } from '@tanstack/react-query';
import { Sun, ArrowUpRight } from 'lucide-react';
import { format, addDays } from 'date-fns';
import type { Task, BoardData } from '@work/shared';
import { useApp } from '../lib/context';
import { api, post } from '../api/client';
import { useTaskMutations } from '../lib/task-mutations';
import { TaskDetail } from './TaskDetail';
import { Modal } from '../components/ui';
import { EmptyState, PageHeader, PageSection } from '../components/PageLayout';
export function MyWork() {
  const { me, notify } = useApp();
  const tasks = useQuery({
    queryKey: ['tasks', 'my'],
    queryFn: () => api<Task[]>('/api/me/tasks'),
  });
  const [tab, setTab] = useState('focus');
  const [peek, setPeek] = useState<Task | null>(null);
  const [replace, setReplace] = useState<Task | null>(null);
  const mutations = useTaskMutations();
  const board = useQuery({
    queryKey: ['board', peek?.board_id],
    queryFn: () => api<BoardData>(`/api/boards/${peek!.board_id}`),
    enabled: !!peek,
  });
  const focused = (tasks.data ?? []).filter((t) => t.focus_user_ids.includes(me.id));
  const visible = (tasks.data ?? []).filter((t) =>
    tab === 'focus'
      ? t.focus_user_ids.includes(me.id)
      : tab === 'responsible'
        ? t.relation === 'responsible' &&
          !t.focus_user_ids.includes(me.id) &&
          !['completed', 'cancelled'].includes(t.state_group)
        : tab === 'participant'
          ? t.relation === 'participant' &&
            !t.focus_user_ids.includes(me.id) &&
            !['completed', 'cancelled'].includes(t.state_group)
          : tab === 'due'
            ? t.due_date &&
              t.due_date <= format(addDays(new Date(), 7), 'yyyy-MM-dd') &&
              !['completed', 'cancelled'].includes(t.state_group)
            : t.state_group === 'completed',
  );
  const spaces = Array.from(new Set(visible.map((t) => t.workspace_id)));
  async function toggle(t: Task) {
    try {
      await post(
        `/api/tasks/${t.id}/focus`,
        {},
        t.focus_user_ids.includes(me.id) ? 'DELETE' : 'POST',
      );
      await mutations.refresh();
    } catch (e) {
      if ((e as { code?: string }).code === 'WIP_CAPACITY_EXCEEDED') setReplace(t);
      else notify((e as Error).message);
    }
  }
  return (
    <div className="page-layout my-work-page">
      <PageHeader
        eyebrow="个人工作台"
        title="我的工作"
        description="汇集你负责和参与的任务，把注意力留给当前最重要的工作。"
        actions={
          <div
            className="wip-display my-wip-card"
            aria-label={`当前投入 ${me.used_wip} / ${me.wip_limit}`}
          >
            <span>当前投入</span>
            <strong className="mono">
              {me.used_wip}
              <span> / {me.wip_limit}</span>
            </strong>
            <div className="wip-slots">
              {Array.from({ length: Math.max(me.wip_limit, me.used_wip) }, (_, i) => (
                <i className={i < me.used_wip ? 'used' : ''} key={i} />
              ))}
            </div>
          </div>
        }
      />
      <PageSection className="my-work-section">
        <Tabs.Root value={tab} onValueChange={setTab}>
          <Tabs.List className="tabs my-tabs" aria-label="我的工作分类">
            {Object.entries({
              focus: '当前点亮',
              responsible: '我负责',
              participant: '我参与',
              due: '即将到期',
              completed: '最近完成',
            }).map(([key, label]) => (
              <Tabs.Trigger value={key} key={key}>
                {label}
                {key === 'focus' && <span className="mono"> {focused.length}</span>}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value={tab} className="my-list">
            {tasks.isLoading ? (
              <EmptyState tone="loading" title="正在载入任务…" />
            ) : tasks.isError ? (
              <EmptyState
                tone="error"
                title="任务加载失败"
                description="暂时无法获取你的任务，请稍后重试。"
                action={<button onClick={() => void tasks.refetch()}>重试</button>}
              />
            ) : !visible.length ? (
              <EmptyState
                icon={<Sun size={22} aria-hidden="true" />}
                title="此分类下暂无任务。"
                description={
                  tab === 'focus'
                    ? '在「我负责」或「我参与」中点亮任务，开始专注工作。'
                    : '分配给你或邀请你参与的工作，会在这里汇总。'
                }
              />
            ) : (
              spaces.map((wid) => (
                <section key={wid} className="my-work-group">
                  <h2 className="my-group-heading">
                    {visible.find((t) => t.workspace_id === wid)?.workspace_name}
                    <span className="muted mono">
                      {visible.filter((t) => t.workspace_id === wid).length}
                    </span>
                  </h2>
                  {visible
                    .filter((t) => t.workspace_id === wid)
                    .map((t) => (
                      <div className="my-task-row" key={t.id}>
                        <button
                          aria-label={
                            t.focus_user_ids.includes(me.id) ? `熄灭 ${t.title}` : `点亮 ${t.title}`
                          }
                          disabled={!t.can_focus && !t.focus_user_ids.includes(me.id)}
                          className={`row-focus ${t.focus_user_ids.includes(me.id) ? 'active' : ''}`}
                          onClick={() => void toggle(t)}
                        >
                          <Sun size={16} />
                        </button>
                        <span className="mono muted">
                          {t.board_key}-{t.seq}
                        </span>
                        <button className="my-task-title" onClick={() => setPeek(t)}>
                          {t.title}
                        </button>
                        <span className="relation-tag">
                          {t.relation === 'responsible' ? '负责' : '参与'}
                        </span>
                        <span className="muted row-board">{t.board_name}</span>
                        <time
                          className="mono muted"
                          dateTime={t.due_date ?? undefined}
                          title={t.due_date ? `截止日期 ${t.due_date}` : '未设置截止日期'}
                        >
                          {t.due_date?.slice(5, 10) ?? '—'}
                        </time>
                        <a
                          aria-label="展开任务"
                          href={`/workspaces/${t.workspace_key}/boards/${t.board_key}/tasks/${t.seq}`}
                        >
                          <ArrowUpRight size={14} />
                        </a>
                      </div>
                    ))}
                </section>
              ))
            )}
          </Tabs.Content>
        </Tabs.Root>
      </PageSection>
      {peek && board.isPending && (
        <p className="muted" role="status">
          正在读取任务详情…
        </p>
      )}
      {peek && board.isError && (
        <EmptyState
          tone="error"
          title="任务详情加载失败"
          action={<button onClick={() => void board.refetch()}>重试</button>}
        />
      )}
      {peek && board.data && (
        <TaskDetail taskId={peek.id} data={board.data} onClose={() => setPeek(null)} />
      )}
      <Modal title="替换一个点亮任务" open={!!replace} onOpenChange={(v) => !v && setReplace(null)}>
        <p className="muted">WIP 已满。选择一个当前投入的任务，以一换一方式替换。</p>
        <div className="replace-list">
          {focused.map((t) => (
            <button
              key={t.id}
              onClick={async () => {
                try {
                  await post(`/api/tasks/${replace!.id}/focus`, { replaceTaskId: t.id });
                  setReplace(null);
                  await mutations.refresh();
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              <span className="mono muted">
                {t.board_key}-{t.seq}
              </span>
              {t.title}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
