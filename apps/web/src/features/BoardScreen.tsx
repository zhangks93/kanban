import { BoardManage } from './BoardManage';
import { BoardShare } from './BoardShare';
import { IntakePanel } from './IntakePanel';
import { installedPlugins } from '../plugins/registry';

import { useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCorners,
  pointerWithin,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { generateKeyBetween } from 'fractional-indexing';
import { Plus, Filter, Rows3, ChevronDown, Settings2, Share2 } from 'lucide-react';
import type { Task, Board, BoardData, Worker } from '@work/shared';
import { useApp } from '../lib/context';
import { api, post } from '../api/client';
import { useTaskMutations } from '../lib/task-mutations';
import { CompactPopover } from '../components/ui';
import { BoardCell, type Group } from './board/BoardCell';
import { LaneManager } from './board/LaneManager';
import { TaskCreate } from './TaskCreate';
import { TaskDetail } from './TaskDetail';
export function BoardScreen() {
  const path = useLocation().pathname;
  const { workspace, notify } = useApp();
  const boardKey = path.match(/\/boards\/([^/]+)/)?.[1];
  const list = useQuery({
    queryKey: ['boards', workspace?.id],
    queryFn: () => api<Board[]>(`/api/workspaces/${workspace!.id}/boards`),
    enabled: !!workspace,
  });
  const board = list.data?.find((b) => b.key === boardKey);
  const data = useQuery({
    queryKey: ['board', board?.id],
    queryFn: () => api<BoardData>(`/api/boards/${board!.id}`),
    enabled: !!board,
  });
  const tasks = useQuery({
    queryKey: ['tasks', board?.id],
    queryFn: () => api<Task[]>(`/api/boards/${board!.id}/tasks`),
    enabled: !!board,
  });
  const workers = useQuery({
    queryKey: ['workers', board?.id],
    queryFn: () => api<Worker[]>(`/api/boards/${board!.id}/workers`),
    enabled: !!board,
  });
  const fullSeq = path.match(/\/tasks\/(\d+)/)?.[1];
  const fullTask = useQuery({
    queryKey: ['task-seq', board?.id, fullSeq],
    queryFn: () => api<Task>(`/api/boards/${board!.id}/tasks/${fullSeq}`),
    enabled: !!board && !!fullSeq,
  });
  const pluginOptions = useQuery({
    queryKey: ['plugin-options', board?.plugin_key, board?.id],
    queryFn: () =>
      api<Record<string, { id: string; name: string }[]>>(
        `/api/plugins/${board!.plugin_key}/boards/${board!.id}/options`,
      ),
    enabled: !!board?.plugin_key,
  });
  const requestedGroup = new URLSearchParams(window.location.search).get('group') ?? '';
  const initialGroup =
    requestedGroup === 'module'
      ? 'project'
      : requestedGroup === 'service'
        ? 'system'
        : requestedGroup;
  const [grouping, setGrouping] = useState(
    [
      'lane',
      'responsible',
      'priority',
      'type',
      'milestone',
      'none',
      'system',
      'project',
      'severity',
    ].includes(initialGroup)
      ? initialGroup
      : 'lane',
  );
  const [peek, setPeek] = useState<string | null>(null);
  const [create, setCreate] = useState<{
    state?: string;
    lane?: string | null;
    responsible?: string;
  } | null>(null);
  const [lanesOpen, setLanesOpen] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [filter, setFilter] = useState({ q: '', priority: '', participant: '' });
  const mutations = useTaskMutations();
  const qc = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (data.isError || tasks.isError)
    return (
      <div className="empty error">
        看板加载失败。
        <button
          onClick={() => {
            void data.refetch();
            void tasks.refetch();
          }}
        >
          重试
        </button>
      </div>
    );
  if (!data.data)
    return (
      <div className="empty" role="status">
        {list.isFetched && !board ? '看板不存在或无访问权限' : '正在载入看板…'}
      </div>
    );
  const d = data.data;
  const filtered = (tasks.data ?? []).filter(
    (t) =>
      (!filter.q || t.title.includes(filter.q)) &&
      (!filter.priority || t.priority === filter.priority) &&
      (!filter.participant || t.participants.some((p) => p.id === filter.participant)),
  );
  const pluginGrouping = installedPlugins
    .find((p) => p.manifest.key === d.board.plugin_key)
    ?.web.groupProviders?.find((p) => p.key === grouping);
  const getGroup = (t: Task) =>
    grouping === 'lane'
      ? (t.lane_id ?? 'null')
      : grouping === 'responsible'
        ? t.responsible_id
        : grouping === 'priority'
          ? t.priority
          : grouping === 'type'
            ? t.type_id
            : grouping === 'milestone'
              ? (t.milestone_id ?? 'null')
              : grouping === 'none'
                ? 'all'
                : String(t.plugin_fields?.[pluginGrouping?.field ?? ''] ?? 'null');
  const groups: Group[] =
    grouping === 'lane'
      ? [
          ...d.lanes.filter((l) => l.status === 'active').map((l) => ({ id: l.id, name: l.name })),
          { id: 'null', name: '未分组' },
        ]
      : grouping === 'responsible'
        ? Array.from(
            new Set([
              ...(workers.data ?? []).map((w) => w.userId),
              ...filtered.map((t) => t.responsible_id),
            ]),
          ).map((id) => ({
            id,
            name:
              workers.data?.find((w) => w.userId === id)?.displayName ??
              filtered.find((t) => t.responsible_id === id)?.responsible_name ??
              '无当前工作权限',
          }))
        : grouping === 'priority'
          ? Object.entries({
              urgent: '紧急',
              high: '高',
              medium: '中',
              low: '低',
              none: '无优先级',
            }).map(([id, name]) => ({ id, name }))
          : grouping === 'type'
            ? d.types.map((t) => ({ id: t.id, name: t.name }))
            : grouping === 'milestone'
              ? [
                  ...d.milestones.map((m) => ({ id: m.id, name: m.name })),
                  { id: 'null', name: '无里程碑' },
                ]
              : grouping === 'none'
                ? [{ id: 'all', name: '全部工作项' }]
                : Array.from(new Set(filtered.map(getGroup))).map((id) => ({
                    id,
                    name:
                      id === 'null'
                        ? '未设置'
                        : (Object.values(pluginOptions.data ?? {})
                            .flat()
                            .find((r) => r.id === id)?.name ?? id),
                  }));
  async function onDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const task = (tasks.data ?? []).find((t) => t.id === event.active.id);
    if (!task) return;
    const overTask = (tasks.data ?? []).find((t) => t.id === event.over!.id);
    const dest = overTask
      ? { stateId: overTask.state_id, groupId: getGroup(overTask) }
      : (event.over.data.current as { stateId?: string; groupId?: string });
    if (!dest?.stateId) return;
    const body: Record<string, unknown> = {};
    if (dest.stateId !== task.state_id) body.stateId = dest.stateId;
    if (dest.groupId !== getGroup(task)) {
      if (grouping === 'lane') body.laneId = dest.groupId === 'null' ? null : dest.groupId;
      else if (grouping === 'responsible') body.responsibleUserId = dest.groupId;
      else return;
    }
    const cell = filtered
      .filter(
        (t) => t.id !== task.id && t.state_id === dest.stateId && getGroup(t) === dest.groupId,
      )
      .sort((a, b) => (a.sort_key < b.sort_key ? -1 : a.sort_key > b.sort_key ? 1 : 0));
    const index = overTask ? cell.findIndex((t) => t.id === overTask.id) : cell.length;
    const previous = cell[Math.max(0, index) - 1]?.sort_key ?? null;
    const next = cell[Math.max(0, index)]?.sort_key ?? null;
    const sortKey = generateKeyBetween(previous, previous === next ? null : next);
    try {
      await qc.cancelQueries({ queryKey: ['tasks', board!.id] });
      qc.setQueryData<Task[]>(['tasks', board!.id], (old) =>
        old?.map((t) =>
          t.id === task.id
            ? {
                ...t,
                state_id: (body.stateId as string) ?? t.state_id,
                lane_id: 'laneId' in body ? (body.laneId as string | null) : t.lane_id,
                responsible_id: (body.responsibleUserId as string) ?? t.responsible_id,
                sort_key: sortKey,
              }
            : t,
        ),
      );
      if (Object.keys(body).length) await mutations.change(task, '/move', { ...body, sortKey });
      else await post(`/api/tasks/${task.id}/reorder`, { sortKey });
      await mutations.refresh();
    } catch (e) {
      notify((e as Error).message);
      await mutations.refresh();
    }
  }
  const full = fullTask.data;
  if (fullSeq)
    return full ? (
      <TaskDetail
        taskId={full.id}
        full
        data={d}
        onClose={() => {
          window.location.href = `/workspaces/${workspace!.key}/boards/${boardKey}`;
        }}
      />
    ) : (
      <div className="empty">任务不存在或不可见。</div>
    );
  return (
    <>
      <header className="board-heading">
        <div className="board-heading-copy">
          <span className="eyebrow">{workspace?.name} / 团队看板</span>
          <h1>{d.board.name}</h1>
        </div>
        <div className="board-heading-summary">
          <span className="status-pill">
            {d.board.access_mode === 'restricted' ? '受限看板' : '空间协作'}
          </span>
          <span className="mono muted" data-testid="board-task-count">
            {filtered.length} 项任务
          </span>
        </div>
      </header>
      <div className="board-toolbar" role="toolbar" aria-label="看板工具">
        <CompactPopover
          trigger={
            <button>
              <Filter size={14} />
              筛选{Object.values(filter).some(Boolean) && <span className="filter-dot" />}
            </button>
          }
        >
          <div className="filter-form">
            <label>
              标题
              <input
                placeholder="搜索标题"
                value={filter.q}
                onChange={(e) => setFilter({ ...filter, q: e.target.value })}
              />
            </label>
            <label>
              优先级
              <select
                value={filter.priority}
                onChange={(e) => setFilter({ ...filter, priority: e.target.value })}
              >
                <option value="">全部</option>
                {Object.entries({
                  urgent: '紧急',
                  high: '高',
                  medium: '中',
                  low: '低',
                  none: '无',
                }).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              参与人
              <select
                value={filter.participant}
                onChange={(e) => setFilter({ ...filter, participant: e.target.value })}
              >
                <option value="">全部</option>
                {workers.data?.map((w) => (
                  <option key={w.userId} value={w.userId}>
                    {w.displayName}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => setFilter({ q: '', priority: '', participant: '' })}>
              清除筛选
            </button>
          </div>
        </CompactPopover>
        <label className="group-select">
          <Rows3 size={14} />
          <select
            aria-label="分组方式"
            value={grouping}
            onChange={(e) => {
              setGrouping(e.target.value);
              const url = new URL(window.location.href);
              url.searchParams.set('group', e.target.value);
              window.history.replaceState(null, '', url);
            }}
          >
            {Object.entries({
              lane: '泳道',
              responsible: '负责人',
              priority: '优先级',
              type: '类型',
              milestone: '里程碑',
              none: '不分组',
              ...Object.fromEntries(
                installedPlugins
                  .find((p) => p.manifest.key === d.board.plugin_key)
                  ?.web.groupProviders?.map((p) => [p.key, p.label]) ?? [],
              ),
            }).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <ChevronDown size={12} />
        </label>
        <div className="toolbar-spacer" />
        {d.board.can_manage && (
          <button onClick={() => setShareOpen(true)}>
            <Share2 size={14} />
            分享
          </button>
        )}
        {d.board.can_manage && (
          <button aria-label="管理看板" onClick={() => setManageOpen(true)}>
            <Settings2 size={14} />
          </button>
        )}
        {(d.board.intake_enabled ||
          (d.board.can_manage && ['rnd', 'ops'].includes(d.board.plugin_key ?? ''))) && (
          <button onClick={() => setIntakeOpen(true)}>
            {d.board.plugin_key === 'ops' ? '工单' : '需求'}
          </button>
        )}
        {d.board.can_manage && d.board.lane_mode === 'manual' && (
          <button onClick={() => setLanesOpen(true)}>
            <Settings2 size={14} />
            泳道
          </button>
        )}
        <button className="primary" aria-label="新建任务" onClick={() => setCreate({})}>
          <Plus size={14} />
          <span className="toolbar-label">新建任务</span>
        </button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={(args) => {
          const pointer = pointerWithin(args);
          return pointer.length ? pointer : closestCorners(args);
        }}
        onDragEnd={onDragEnd}
      >
        <div className="board-scroll">
          <div
            className="board-grid"
            style={{ gridTemplateColumns: `repeat(${d.states.length},296px)` }}
          >
            {d.states.map((s) => (
              <div className="column-header" key={s.id}>
                <span className={`state-dot state-${s.state_group}`} />
                <strong>{s.name}</strong>
                <span className="muted mono">
                  {filtered.filter((t) => t.state_id === s.id).length}
                </span>
                <button
                  aria-label={`在${s.name}添加任务`}
                  onClick={() => setCreate({ state: s.id })}
                >
                  <Plus size={14} />
                </button>
              </div>
            ))}
            {groups.map((g) => (
              <div className="lane-row" key={g.id}>
                <div className="lane-heading">
                  {g.name}
                  <span className="muted mono">
                    {filtered.filter((t) => getGroup(t) === g.id).length}
                  </span>
                </div>
                {d.states.map((s) => (
                  <BoardCell
                    key={`${g.id}:${s.id}`}
                    state={s}
                    group={g}
                    tasks={filtered.filter((t) => getGroup(t) === g.id && t.state_id === s.id)}
                    onOpen={(t) => setPeek(t.id)}
                    onCreate={() =>
                      setCreate({
                        state: s.id,
                        lane: grouping === 'lane' && g.id !== 'null' ? g.id : null,
                        responsible: grouping === 'responsible' ? g.id : undefined,
                      })
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </DndContext>
      {create && (
        <TaskCreate
          key={`${create.state}:${create.lane}`}
          data={d}
          open
          onClose={() => setCreate(null)}
          initialState={create.state}
          initialLane={create.lane}
          initialResponsible={create.responsible}
        />
      )}
      <BoardManage data={d} open={manageOpen} onClose={() => setManageOpen(false)} />
      {d.board.can_manage && (
        <BoardShare boardId={d.board.id} open={shareOpen} onClose={() => setShareOpen(false)} />
      )}
      <IntakePanel data={d} open={intakeOpen} onClose={() => setIntakeOpen(false)} />
      <LaneManager data={d} open={lanesOpen} onClose={() => setLanesOpen(false)} />
      {peek && <TaskDetail taskId={peek} data={d} onClose={() => setPeek(null)} />}
    </>
  );
}
