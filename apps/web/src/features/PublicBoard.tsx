import { useRef, useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Eye, Plus, Search, CheckCircle2 } from 'lucide-react';
import { ApiError, api, post } from '../api/client';
import { Modal } from '../components/ui';
import '../styles/sharing.css';

interface PublicTask {
  id: string;
  seq: number;
  title: string;
  state_id: string;
  lane_id: string | null;
  type_name: string;
  priority: string;
  due_date: string | null;
}
interface PublicData {
  board: { name: string; key: string; plugin_key: string | null };
  states: { id: string; name: string; state_group: string }[];
  lanes: { id: string; name: string }[];
  tasks: PublicTask[];
  submissionKind: 'requirement' | 'ticket' | null;
}
const priorities: Record<string, string> = { urgent: '紧急', high: '高', medium: '中', low: '低' };

export function PublicBoard() {
  const token = useLocation().pathname.split('/').at(-1) ?? '';
  const data = useQuery({
    queryKey: ['public-board', token],
    queryFn: () => api<PublicData>(`/api/public/boards/${encodeURIComponent(token)}`),
    retry: false,
    refetchInterval: 60_000,
  });
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  if (data.isError)
    return (
      <main className="public-unavailable">
        <h1>
          {data.error instanceof ApiError && data.error.code === 'NOT_FOUND'
            ? '分享链接已失效'
            : '看板加载失败'}
        </h1>
        <p className="muted">
          {data.error instanceof ApiError && data.error.code === 'NOT_FOUND'
            ? '请联系看板管理员获取新的链接。'
            : '请检查网络后重试。'}
        </p>
        <button onClick={() => void data.refetch()}>重新加载</button>
      </main>
    );
  if (!data.data)
    return (
      <main className="public-unavailable" role="status">
        正在加载看板…
      </main>
    );
  const d = data.data;
  const tasks = d.tasks.filter((t) =>
    t.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const lanes = [
    ...d.lanes,
    { id: 'unassigned', name: d.lanes.length ? '未分组' : '全部任务' },
  ].filter(
    (lane) =>
      lane.id !== 'unassigned' ||
      !d.lanes.length ||
      tasks.some((t) => !t.lane_id || !d.lanes.some((l) => l.id === t.lane_id)),
  );
  const laneId = (task: PublicTask) =>
    d.lanes.some((l) => l.id === task.lane_id) ? task.lane_id : 'unassigned';
  return (
    <main className="public-board">
      <title>{d.board.name} · 公开看板</title>
      <meta name="robots" content="noindex,nofollow" />
      <meta name="referrer" content="no-referrer" />
      <header className="public-heading">
        <div>
          <span className="public-brand">WORK</span>
          <h1>{d.board.name}</h1>
          <span className="public-readonly">
            <Eye size={14} />
            公开只读
          </span>
        </div>
        {d.submissionKind && (
          <button className="primary" onClick={() => setOpen(true)}>
            <Plus size={15} />
            {d.submissionKind === 'ticket' ? '运维工单提报' : '需求提报'}
          </button>
        )}
      </header>
      <div className="public-toolbar">
        <label className="public-search">
          <Search size={15} />
          <input
            aria-label="搜索任务"
            placeholder="搜索任务"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span className="muted">{tasks.length} 项任务</span>
      </div>
      <div className="public-board-scroll">
        <div
          className="public-grid"
          style={{ gridTemplateColumns: `repeat(${d.states.length}, minmax(260px, 1fr))` }}
        >
          {d.states.map((state) => (
            <div className="public-column" key={state.id}>
              <span className={`state-dot state-${state.state_group}`} />
              <strong>{state.name}</strong>
              <span className="muted">{tasks.filter((t) => t.state_id === state.id).length}</span>
            </div>
          ))}
          {lanes.map((lane) => (
            <div className="public-lane" key={lane.id}>
              {d.lanes.length > 0 && <div className="public-lane-heading">{lane.name}</div>}
              {d.states.map((state) => (
                <section
                  className="public-cell"
                  key={state.id}
                  aria-label={`${lane.name} · ${state.name}`}
                >
                  {tasks
                    .filter((task) => task.state_id === state.id && laneId(task) === lane.id)
                    .map((task) => (
                      <article className="public-task" key={task.id}>
                        <span className="public-task-ref muted">
                          {d.board.key}-{task.seq}
                          {task.type_name && <span>{task.type_name}</span>}
                        </span>
                        <h2>{task.title}</h2>
                        {(priorities[task.priority] || task.due_date) && (
                          <div className="public-task-meta">
                            {priorities[task.priority] && (
                              <span className={task.priority === 'urgent' ? 'error' : ''}>
                                {priorities[task.priority]}优先级
                              </span>
                            )}
                            {task.due_date && (
                              <time dateTime={task.due_date}>{task.due_date.slice(0, 10)}</time>
                            )}
                          </div>
                        )}
                      </article>
                    ))}
                </section>
              ))}
            </div>
          ))}
        </div>
        {tasks.length === 0 && (
          <div className="empty">{search ? '没有匹配的任务' : '暂无任务'}</div>
        )}
      </div>
      {d.submissionKind && (
        <PublicSubmission
          key={token}
          token={token}
          kind={d.submissionKind}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </main>
  );
}

function PublicSubmission({
  token,
  kind,
  open,
  onClose,
}: {
  token: string;
  kind: 'requirement' | 'ticket';
  open: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const mutationId = useRef(crypto.randomUUID());
  const noun = kind === 'ticket' ? '运维工单' : '需求';
  function close() {
    if (!busy) {
      onClose();
      setSuccess(false);
      setError('');
    }
  }
  return (
    <Modal title={`${noun}提报`} open={open} onOpenChange={(v) => !v && close()}>
      {success ? (
        <div className="submission-success" role="status">
          <CheckCircle2 size={28} />
          <h2>提交成功</h2>
          <p className="muted">团队将在受理后跟进。</p>
          <button className="primary" onClick={close}>
            完成
          </button>
        </div>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError('');
            try {
              await post(`/api/public/boards/${encodeURIComponent(token)}/submissions`, {
                title: title.trim(),
                description: description.trim(),
                requesterName: name.trim(),
                contact: contact.trim() || undefined,
                clientMutationId: mutationId.current,
              });
              setTitle('');
              setDescription('');
              setSuccess(true);
              mutationId.current = crypto.randomUUID();
            } catch (e) {
              setError(
                e instanceof ApiError && e.code === 'NOT_FOUND'
                  ? '分享已关闭，请联系看板管理员。'
                  : (e as Error).message,
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {kind === 'ticket' ? '问题标题' : '需求标题'}
            <input
              autoFocus
              required
              maxLength={255}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            {kind === 'ticket' ? '问题说明' : '需求说明'}
            <textarea
              rows={4}
              maxLength={10000}
              placeholder={kind === 'ticket' ? '请描述遇到的问题和影响' : '请描述期望解决的问题'}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
            />
          </label>
          <div className="submission-person">
            <label>
              姓名
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              联系方式（选填）
              <input
                maxLength={200}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                disabled={busy}
              />
            </label>
          </div>
          <span className="muted">受理后标题会显示在看板中，联系方式仅团队可见。</span>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={close}>
              取消
            </button>
            <button className="primary" disabled={busy || !title.trim() || !name.trim()}>
              {busy ? '正在提交…' : `提交${noun}`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
