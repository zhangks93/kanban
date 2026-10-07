import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ArrowRight } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { api, post } from '../api/client';
import { useApp } from '../lib/context';
import { Modal } from '../components/ui';
import type { Workspace } from '@work/shared';
export function WorkspaceList() {
  const { workspaces, me, notify } = useApp();
  const [open, setOpen] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<{ name: string; key: string }>();
  const qc = useQueryClient();
  return (
    <>
      <header className="page-heading">
        <div>
          <h1>工作空间</h1>
          <p className="muted">选择协作范围，进入你的工作。</p>
        </div>
        {me.is_platform_admin && (
          <button className="primary" onClick={() => setOpen(true)}>
            <Plus size={16} />
            新建工作空间
          </button>
        )}
      </header>
      <div className="workspace-list">
        {workspaces.map((w) => (
          <a href={`/workspaces/${w.key}/boards`} className="workspace-row" key={w.id}>
            <span className="workspace-mark">{w.name.slice(0, 1)}</span>
            <div>
              <strong>{w.name}</strong>
              <p className="muted">{w.description || w.key}</p>
            </div>
            <span className="muted">
              {w.role === 'owner' ? '所有者' : w.role === 'admin' ? '管理员' : '成员'}
            </span>
            <ArrowRight size={16} />
          </a>
        ))}
        {!workspaces.length && (
          <div className="empty">暂无可访问的工作空间，请联系管理员添加成员。</div>
        )}
      </div>
      <Modal title="新建工作空间" open={open} onOpenChange={setOpen}>
        <form
          onSubmit={handleSubmit(async (b) => {
            try {
              await post<Workspace>('/api/workspaces', b);
              await qc.invalidateQueries({ queryKey: ['workspaces'] });
              setOpen(false);
            } catch (e) {
              notify((e as Error).message);
            }
          })}
        >
          <label>
            名称
            <input {...register('name', { required: true, maxLength: 100 })} />
          </label>
          <label>
            标识
            <input
              placeholder="如 alpha"
              {...register('key', { required: true, pattern: /^[a-z][a-z0-9_-]{1,31}$/ })}
            />
          </label>
          <div className="dialog-actions">
            <button type="button" onClick={() => setOpen(false)}>
              取消
            </button>
            <button className="primary" disabled={isSubmitting}>
              创建
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
export function MemberSettings() {
  const { workspace, notify } = useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const rows = useQuery({
    queryKey: ['members', workspace?.id],
    queryFn: () =>
      api<
        { id: string; display_name: string; role: string; status: string; account_status: string }[]
      >(`/api/workspaces/${workspace!.id}/members`),
    enabled: !!workspace,
  });
  const can = workspace?.role === 'owner' || workspace?.role === 'admin';
  async function change(id: string, role: string, status: string) {
    try {
      await post(`/api/workspaces/${workspace!.id}/members/${id}`, { role, status }, 'PATCH');
      await qc.invalidateQueries();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <>
      <header className="page-heading">
        <h1>空间成员</h1>
        {can && (
          <button onClick={() => setOpen(true)}>
            <Plus size={16} />
            添加成员
          </button>
        )}
      </header>
      {rows.isError ? (
        <div className="empty error">成员加载失败</div>
      ) : (
        <div className="data-table">
          <div className="table-head">
            <span>成员</span>
            <span>角色</span>
            <span>成员状态</span>
          </div>
          {rows.data?.map((u) => (
            <div className="table-row" key={u.id}>
              <span>
                {u.display_name}
                <small className="muted">
                  {u.account_status === 'deactivated' ? ' · 账号已停用' : ''}
                </small>
              </span>
              <select
                aria-label={`${u.display_name}角色`}
                value={u.role}
                disabled={!can || (u.role === 'owner' && workspace?.role !== 'owner')}
                onChange={(e) => void change(u.id, e.target.value, u.status)}
              >
                {['owner', 'admin', 'member'].map((r) => (
                  <option key={r} value={r}>
                    {{ owner: '所有者', admin: '管理员', member: '成员' }[r]}
                  </option>
                ))}
              </select>
              <button
                disabled={!can}
                onClick={() =>
                  void change(u.id, u.role, u.status === 'active' ? 'inactive' : 'active')
                }
              >
                {u.status === 'active' ? '移出空间' : '恢复成员'}
              </button>
            </div>
          ))}
        </div>
      )}
      <Modal title="添加空间成员" open={open} onOpenChange={setOpen}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await post(`/api/workspaces/${workspace!.id}/members`, { userId, role: 'member' });
              await qc.invalidateQueries();
              setOpen(false);
            } catch (err) {
              notify((err as Error).message);
            }
          }}
        >
          <label>
            已登录用户 ID
            <input value={userId} onChange={(e) => setUserId(e.target.value)} required />
          </label>
          <button className="primary">添加</button>
        </form>
      </Modal>
    </>
  );
}
export function AdminUsers() {
  const { notify } = useApp();
  const qc = useQueryClient();
  const users = useQuery({
    queryKey: ['admin-users'],
    queryFn: () =>
      api<{ id: string; display_name: string; status: string; wip_limit: number }[]>(
        '/api/admin/users',
      ),
  });
  async function change(id: string, path: string, b: unknown) {
    try {
      await post(`/api/admin/users/${id}/${path}`, b, 'PATCH');
      await qc.invalidateQueries();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <>
      <header className="page-heading">
        <h1>平台用户</h1>
      </header>
      <div className="data-table">
        <div className="table-head">
          <span>用户</span>
          <span>全局 WIP 上限</span>
          <span>账号状态</span>
        </div>
        {users.data?.map((u) => (
          <div className="table-row" key={u.id}>
            <span>{u.display_name}</span>
            <select
              value={u.wip_limit}
              aria-label={`${u.display_name}WIP上限`}
              onChange={(e) => void change(u.id, 'wip-limit', { wipLimit: Number(e.target.value) })}
            >
              {Array.from({ length: 10 }, (_, i) => (
                <option key={i + 1}>{i + 1}</option>
              ))}
            </select>
            <button
              onClick={() =>
                void change(u.id, 'status', {
                  status: u.status === 'active' ? 'deactivated' : 'active',
                })
              }
            >
              {u.status === 'active' ? '停用账号' : '恢复账号'}
            </button>
          </div>
        ))}
      </div>
      {users.isError && <p className="error">无权访问用户管理</p>}
    </>
  );
}
