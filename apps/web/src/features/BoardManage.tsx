import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardData } from '@work/shared';
import { api, post } from '../api/client';
import { useApp } from '../lib/context';
import { Modal } from '../components/ui';
export function BoardManage({
  data,
  open,
  onClose,
}: {
  data: BoardData;
  open: boolean;
  onClose: () => void;
}) {
  const { workspace, notify } = useApp();
  const qc = useQueryClient();
  const [tab, setTab] = useState('general');
  const [name, setName] = useState(data.board.name);
  const [mode, setMode] = useState(data.board.access_mode);
  const [intake, setIntake] = useState(data.board.intake_enabled);
  const [user, setUser] = useState('');
  const [role, setRole] = useState('member');
  const [label, setLabel] = useState('');
  const [milestone, setMilestone] = useState('');
  const [due, setDue] = useState('');
  const members = useQuery({
    queryKey: ['board-members', data.board.id],
    queryFn: () =>
      api<{ user_id: string; role: string; display_name: string }[]>(
        `/api/boards/${data.board.id}/members`,
      ),
    enabled: open,
  });
  const workspaceMembers = useQuery({
    queryKey: ['members', workspace?.id],
    queryFn: () =>
      api<{ id: string; display_name: string; status: string; account_status: string }[]>(
        `/api/workspaces/${workspace!.id}/members`,
      ),
    enabled: open && !!workspace,
  });
  async function change(path: string, b: unknown, method = 'POST') {
    try {
      await post(`/api/boards/${data.board.id}${path}`, b, method);
      await qc.invalidateQueries();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <Modal title="管理看板" open={open} onOpenChange={(v) => !v && onClose()}>
      <div className="detail-tabs">
        {Object.entries({
          general: '设置',
          members: '成员',
          states: '状态',
          metadata: '标签与里程碑',
        }).map(([k, v]) => (
          <button className={tab === k ? 'active' : ''} key={k} onClick={() => setTab(k)}>
            {v}
          </button>
        ))}
      </div>
      {tab === 'general' ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await change('', { name, accessMode: mode, intakeEnabled: intake }, 'PATCH');
            onClose();
          }}
        >
          <label>
            看板名称
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            访问模式
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="workspace">空间成员可读写</option>
              <option value="restricted">仅指定成员可访问</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={intake} onChange={(e) => setIntake(e.target.checked)} />
            启用需求入口
          </label>
          <div className="dialog-actions">
            <button className="primary">保存</button>
          </div>
          <button
            type="button"
            className="error"
            onClick={async () => {
              try {
                await post(`/api/boards/${data.board.id}/archive`, {});
                window.location.href = `/workspaces/${workspace!.key}/boards`;
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            归档看板
          </button>
        </form>
      ) : tab === 'members' ? (
        <>
          <div className="board-member-list">
            {members.data?.map((m) => (
              <div key={m.user_id}>
                <span>{m.display_name}</span>
                <select
                  aria-label={`${m.display_name}看板角色`}
                  value={m.role}
                  onChange={(e) =>
                    void change(`/members/${m.user_id}`, { role: e.target.value }, 'PATCH')
                  }
                >
                  <option value="lead">负责人</option>
                  <option value="member">成员</option>
                  <option value="viewer">只读</option>
                </select>
                <button onClick={() => void change(`/members/${m.user_id}`, {}, 'DELETE')}>
                  撤销
                </button>
              </div>
            ))}
          </div>
          <form
            className="member-add"
            onSubmit={async (e) => {
              e.preventDefault();
              await change('/members', { userId: user, role });
            }}
          >
            <label>
              空间成员
              <select value={user} onChange={(e) => setUser(e.target.value)} required>
                <option value="">选择成员</option>
                {workspaceMembers.data
                  ?.filter((m) => m.status === 'active' && m.account_status === 'active')
                  .map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.display_name}
                    </option>
                  ))}
              </select>
            </label>
            <select
              aria-label="新看板成员角色"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="lead">负责人</option>
              <option value="member">成员</option>
              <option value="viewer">只读</option>
            </select>
            <button>添加成员</button>
          </form>
        </>
      ) : tab === 'states' ? (
        <div className="state-manager">
          {data.states.map((s, i) => (
            <form
              key={s.id}
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                await change(
                  `/states/${s.id}`,
                  { name: fd.get('name'), sortOrder: Number(fd.get('sortOrder')) },
                  'PATCH',
                );
              }}
            >
              <input aria-label={`${s.name}状态名称`} name="name" defaultValue={s.name} required />
              <input aria-label={`${s.name}排序`} type="number" name="sortOrder" defaultValue={i} />
              <span className="muted mono">
                {
                  {
                    backlog: '待规划',
                    unstarted: '未开始',
                    started: '进行中',
                    waiting: '等待中',
                    completed: '完成',
                    cancelled: '取消',
                  }[s.state_group]
                }
              </span>
              <button>保存</button>
            </form>
          ))}
        </div>
      ) : (
        <>
          <h3>标签</h3>
          <div className="metadata-values">
            {data.labels.map((l) => (
              <span key={l.id}>{l.name}</span>
            ))}
          </div>
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              await change('/labels', { name: label });
              setLabel('');
            }}
          >
            <input
              aria-label="新标签名称"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
            <button>添加标签</button>
          </form>
          <h3>里程碑</h3>
          {data.milestones.map((m) => (
            <p key={m.id}>
              {m.name} · {m.due_date?.slice(0, 10)}
            </p>
          ))}
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              await change('/milestones', { name: milestone, dueDate: due });
              setMilestone('');
            }}
          >
            <input
              aria-label="里程碑名称"
              value={milestone}
              onChange={(e) => setMilestone(e.target.value)}
              required
            />
            <input
              aria-label="里程碑截止日期"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              required
            />
            <button>添加</button>
          </form>
        </>
      )}
    </Modal>
  );
}
