import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Lock, ArrowRight, LayoutDashboard } from 'lucide-react';
import type { Board } from '@work/shared';
import type { BoardTemplateDefinition } from '@work/plugin-sdk';
import { useApp } from '../lib/context';
import { api, post } from '../api/client';
import { Modal } from '../components/ui';
import { EmptyState, PageHeader, PageSection } from '../components/PageLayout';
export function BoardsPage() {
  const { workspace, notify } = useApp();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const boards = useQuery({
    queryKey: ['boards', workspace?.id],
    queryFn: () => api<Board[]>(`/api/workspaces/${workspace!.id}/boards`),
    enabled: !!workspace,
  });
  const templates = useQuery({
    queryKey: ['templates', workspace?.id],
    queryFn: () => api<BoardTemplateDefinition[]>(`/api/workspaces/${workspace!.id}/templates`),
    enabled: !!workspace,
  });
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<{ name: string; key: string; templateKey: string; accessMode: string }>({
    defaultValues: { templateKey: 'core.general', accessMode: 'workspace' },
  });
  if (!workspace) return <EmptyState title="工作空间不存在或不可见。" />;
  return (
    <div className="page-layout boards-directory-page">
      <PageHeader
        title={workspace.name}
        description={workspace.description || '按团队与业务组织看板，掌握每项工作的进展。'}
        actions={
          ['owner', 'admin'].includes(workspace.role) && (
            <button className="primary" onClick={() => setOpen(true)}>
              <Plus size={16} />
              新建看板
            </button>
          )
        }
      />
      <PageSection
        title="全部看板"
        description="进入看板查看任务、协作成员和工作进展。"
        actions={boards.data && <span className="section-count">{boards.data.length} 个看板</span>}
      >
        <div className="workspace-list">
          {boards.isLoading && <EmptyState title="正在加载看板…" tone="loading" />}
          {boards.isError && (
            <EmptyState
              title="看板加载失败"
              description="请重试或检查工作空间访问权限。"
              tone="error"
              action={<button onClick={() => void boards.refetch()}>重试</button>}
            />
          )}
          {boards.data?.map((b) => (
            <a
              className="workspace-row"
              key={b.id}
              href={`/workspaces/${workspace.key}/boards/${b.key}`}
            >
              <span className="workspace-mark">{b.key.slice(0, 1)}</span>
              <div className="entity-row-copy">
                <strong>{b.name}</strong>
                <p className="muted entity-row-meta">
                  <span className="mono">{b.key}</span>
                  <span>
                    {templates.data?.find((template) => template.key === b.template_key)?.name ??
                      '工作看板'}
                  </span>
                </p>
              </div>
              <span className="role-badge">
                {b.access_mode === 'restricted' ? (
                  <>
                    <Lock size={12} aria-hidden="true" />
                    受限看板
                  </>
                ) : (
                  '空间可见'
                )}
              </span>
              <ArrowRight size={16} className="entity-row-arrow" aria-hidden="true" />
            </a>
          ))}
          {boards.data?.length === 0 && (
            <EmptyState
              icon={<LayoutDashboard size={22} />}
              title="暂无看板"
              description={
                ['owner', 'admin'].includes(workspace.role)
                  ? '创建一个看板开始协作。'
                  : '看板创建后会显示在这里，请联系工作空间管理员。'
              }
            />
          )}
        </div>
      </PageSection>
      <Modal title="新建看板" open={open} onOpenChange={setOpen}>
        <form
          onSubmit={handleSubmit(async (data) => {
            try {
              const b = await post<Board>(`/api/workspaces/${workspace.id}/boards`, data);
              await qc.invalidateQueries();
              window.location.href = `/workspaces/${workspace.key}/boards/${b.key}`;
            } catch (e) {
              notify((e as Error).message);
            }
          })}
        >
          <label>
            名称
            <input {...register('name', { required: true })} />
          </label>
          <label>
            任务前缀
            <input
              placeholder="如 ALPHA"
              {...register('key', { required: true, pattern: /^[A-Z][A-Z0-9_-]{1,20}$/ })}
            />
          </label>
          <label>
            模板
            <select {...register('templateKey')}>
              {templates.data?.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {templates.isError && (
            <p className="error" role="alert">
              看板模板加载失败，请关闭后重试。
            </p>
          )}
          <label>
            访问模式
            <select {...register('accessMode')}>
              <option value="workspace">空间成员可读写</option>
              <option value="restricted">仅指定成员可访问</option>
            </select>
          </label>
          <div className="dialog-actions">
            <button type="button" onClick={() => setOpen(false)}>
              取消
            </button>
            <button
              className="primary"
              disabled={isSubmitting || templates.isPending || templates.isError}
            >
              创建看板
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
