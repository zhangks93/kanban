import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ArrowRight, Layers, Users } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { api, post } from '../api/client';
import { useApp } from '../lib/context';
import { Modal } from '../components/ui';
import { EmptyState, PageHeader, PageSection } from '../components/PageLayout';
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
    <div className="page-layout workspace-directory-page">
      <PageHeader
        title="工作空间"
        description="选择一个团队空间，查看看板、任务与协作进展。"
        actions={
          me.is_platform_admin && (
            <button className="primary" onClick={() => setOpen(true)}>
              <Plus size={16} />
              新建工作空间
            </button>
          )
        }
      />
      <PageSection
        title="团队空间"
        description="工作空间集中管理团队成员、工作看板与基础数据。"
        actions={<span className="section-count">{workspaces.length} 个空间</span>}
      >
        <div className="workspace-list">
          {workspaces.map((w) => (
            <a href={`/workspaces/${w.key}/boards`} className="workspace-row" key={w.id}>
              <span className="workspace-mark">{w.name.slice(0, 1)}</span>
              <div className="entity-row-copy">
                <strong>{w.name}</strong>
                <p className="muted">{w.description || w.key}</p>
              </div>
              <span className="role-badge">
                {w.role === 'owner' ? '所有者' : w.role === 'admin' ? '管理员' : '成员'}
              </span>
              <ArrowRight size={16} className="entity-row-arrow" aria-hidden="true" />
            </a>
          ))}
          {!workspaces.length && (
            <EmptyState
              icon={<Layers size={22} />}
              title="暂无可访问的工作空间"
              description={
                me.is_platform_admin
                  ? '创建第一个工作空间，开始组织团队工作。'
                  : '请联系管理员添加成员。'
              }
            />
          )}
        </div>
      </PageSection>
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
    </div>
  );
}
export function MemberSettings() {
  const { workspace, notify } = useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
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
    setPendingId(id);
    try {
      await post(`/api/workspaces/${workspace!.id}/members/${id}`, { role, status }, 'PATCH');
      await qc.invalidateQueries();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setPendingId(null);
    }
  }
  return (
    <div className="page-layout member-settings-page">
      <PageHeader
        title="空间成员"
        description={`管理${workspace ? `「${workspace.name}」` : '当前工作空间'}的协作成员和访问权限。`}
        actions={
          can && (
            <button className="primary" onClick={() => setOpen(true)}>
              <Plus size={16} />
              添加成员
            </button>
          )
        }
      />
      <PageSection
        title="成员与权限"
        description="所有者与管理员可以管理成员，所有者角色由空间所有者维护。"
        actions={rows.data && <span className="section-count">{rows.data.length} 位成员</span>}
      >
        {rows.isLoading ? (
          <EmptyState title="正在加载成员…" tone="loading" />
        ) : rows.isError ? (
          <EmptyState
            title="成员加载失败"
            tone="error"
            action={<button onClick={() => void rows.refetch()}>重试</button>}
          />
        ) : !rows.data?.length ? (
          <EmptyState
            title="暂无成员"
            description="添加成员后即可共同管理工作。"
            icon={<Users size={22} />}
          />
        ) : (
          <div className="table-scroll">
            <table className="management-table">
              <thead>
                <tr>
                  <th>成员</th>
                  <th>角色</th>
                  <th>成员状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.data.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="member-person">
                        <span className="member-avatar" aria-hidden="true">
                          {u.display_name.slice(0, 1)}
                        </span>
                        <div className="member-person-copy">
                          <strong>{u.display_name}</strong>
                          <small className="muted">
                            {u.account_status === 'deactivated' ? '账号已停用' : '账号正常'}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <select
                        aria-label={`${u.display_name}角色`}
                        value={u.role}
                        disabled={
                          pendingId !== null ||
                          !can ||
                          (u.role === 'owner' && workspace?.role !== 'owner')
                        }
                        onChange={(e) => void change(u.id, e.target.value, u.status)}
                      >
                        {['owner', 'admin', 'member'].map((r) => (
                          <option key={r} value={r}>
                            {{ owner: '所有者', admin: '管理员', member: '成员' }[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span
                        className={`status-badge ${u.status === 'active' ? 'is-active' : 'is-muted'}`}
                      >
                        {u.status === 'active' ? '有效成员' : '已移出'}
                      </span>
                    </td>
                    <td>
                      <button
                        disabled={pendingId !== null || !can}
                        onClick={() =>
                          void change(u.id, u.role, u.status === 'active' ? 'inactive' : 'active')
                        }
                      >
                        {u.status === 'active' ? '移出空间' : '恢复成员'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>
      <Modal title="添加空间成员" open={open} onOpenChange={setOpen}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setAdding(true);
            try {
              await post(`/api/workspaces/${workspace!.id}/members`, { userId, role: 'member' });
              await qc.invalidateQueries();
              setOpen(false);
            } catch (err) {
              notify((err as Error).message);
            } finally {
              setAdding(false);
            }
          }}
        >
          <label>
            已登录用户 ID
            <input value={userId} onChange={(e) => setUserId(e.target.value)} required />
          </label>
          <p className="muted form-hint">成员需先通过飞书登录平台，再使用其用户 ID 添加。</p>
          <div className="dialog-actions">
            <button type="button" onClick={() => setOpen(false)}>
              取消
            </button>
            <button className="primary" disabled={adding}>
              添加
            </button>
          </div>
        </form>
      </Modal>
    </div>
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
    <div className="page-layout admin-users-page">
      <PageHeader
        title="平台用户"
        description="管理平台账号与个人工作容量，保持团队投入清晰可控。"
      />
      <PageSection
        title="用户管理"
        description="WIP 上限用于控制每位用户同时点亮的任务数量。"
        actions={users.data && <span className="section-count">{users.data.length} 位用户</span>}
      >
        {users.isLoading ? (
          <EmptyState title="正在加载用户…" tone="loading" />
        ) : users.isError ? (
          <EmptyState title="无权访问用户管理" tone="error" />
        ) : !users.data?.length ? (
          <EmptyState title="暂无平台用户" icon={<Users size={22} />} />
        ) : (
          <div className="table-scroll">
            <table className="management-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>全局 WIP 上限</th>
                  <th>账号状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="member-person">
                        <span className="member-avatar" aria-hidden="true">
                          {u.display_name.slice(0, 1)}
                        </span>
                        <strong>{u.display_name}</strong>
                      </div>
                    </td>
                    <td>
                      <select
                        value={u.wip_limit}
                        aria-label={`${u.display_name}WIP上限`}
                        onChange={(e) =>
                          void change(u.id, 'wip-limit', { wipLimit: Number(e.target.value) })
                        }
                      >
                        {Array.from({ length: 10 }, (_, i) => (
                          <option key={i + 1}>{i + 1}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span
                        className={`status-badge ${u.status === 'active' ? 'is-active' : 'is-muted'}`}
                      >
                        {u.status === 'active' ? '正常' : '已停用'}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() =>
                          void change(u.id, 'status', {
                            status: u.status === 'active' ? 'deactivated' : 'active',
                          })
                        }
                      >
                        {u.status === 'active' ? '停用账号' : '恢复账号'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>
    </div>
  );
}
