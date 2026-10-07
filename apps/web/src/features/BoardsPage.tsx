import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Lock, ArrowRight } from 'lucide-react';
import type { Board } from '@work/shared';
import type { BoardTemplateDefinition } from '@work/plugin-sdk';
import { useApp } from '../lib/context';
import { api, post } from '../api/client';
import { Modal } from '../components/ui';
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
  if (!workspace) return <div className="empty">工作空间不存在或不可见。</div>;
  return (
    <>
      <header className="page-heading">
        <div>
          <h1>{workspace.name}</h1>
          <p className="muted">看板定义工作流，泳道承载长期业务分组。</p>
        </div>
        {['owner', 'admin'].includes(workspace.role) && (
          <button className="primary" onClick={() => setOpen(true)}>
            <Plus size={16} />
            新建看板
          </button>
        )}
      </header>
      <div className="workspace-list">
        {boards.data?.map((b) => (
          <a
            className="workspace-row"
            key={b.id}
            href={`/workspaces/${workspace.key}/boards/${b.key}`}
          >
            <span className="workspace-mark">{b.key.slice(0, 1)}</span>
            <div>
              <strong>{b.name}</strong>
              <p className="muted mono">
                {b.key} · {b.template_key}
              </p>
            </div>
            {b.access_mode === 'restricted' && <Lock size={14} />}
            <ArrowRight size={16} />
          </a>
        ))}
        {boards.data?.length === 0 && <div className="empty">暂无看板。创建一个看板开始协作。</div>}
      </div>
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
            <button className="primary" disabled={isSubmitting}>
              创建看板
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
