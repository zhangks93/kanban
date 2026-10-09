import { useEffect } from 'react';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardData, Task, Worker } from '@work/shared';
import { estimateDaysOptions, estimateDaysSchema } from '@work/shared';
import { useApp } from '../lib/context';
import { Modal } from '../components/ui';
import { api, post } from '../api/client';
const schema = z.object({
  title: z.string().trim().min(1, '请输入任务标题').max(255),
  responsibleUserId: z.string().uuid('请选择负责人'),
  stateId: z.string(),
  laneId: z.string(),
  typeId: z.string(),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
  estimateDays: estimateDaysSchema.nullable(),
});
export function TaskCreate({
  data,
  open,
  onClose,
  initialState,
  initialLane,
  initialResponsible,
  initialParent,
}: {
  data: BoardData;
  open: boolean;
  onClose: () => void;
  initialState?: string;
  initialLane?: string | null;
  initialResponsible?: string;
  initialParent?: string;
}) {
  const { me, notify } = useApp();
  const qc = useQueryClient();
  const workers = useQuery({
    queryKey: ['workers', data.board.id],
    queryFn: () => api<Worker[]>(`/api/boards/${data.board.id}/workers`),
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    getValues,
    setValue,
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      responsibleUserId: initialResponsible ?? me.id,
      stateId: initialState ?? data.states.find((s) => s.is_initial)?.id,
      laneId: initialLane ?? '',
      typeId: data.types[0]?.id,
      priority: 'none',
      estimateDays: null,
    },
  });
  useEffect(() => {
    if (
      workers.data?.length &&
      !workers.data.some((w) => w.userId === getValues('responsibleUserId'))
    )
      setValue('responsibleUserId', workers.data[0].userId);
  }, [workers.data, getValues, setValue]);
  return (
    <Modal title="新建任务" open={open} onOpenChange={(v) => !v && onClose()}>
      <form
        onSubmit={handleSubmit(async (b) => {
          try {
            await post<Task>(`/api/boards/${data.board.id}/tasks`, {
              ...b,
              laneId: b.laneId || null,
              clientMutationId: crypto.randomUUID(),
              parentId: initialParent,
            });
            await qc.invalidateQueries({ queryKey: ['tasks'] });
            reset();
            onClose();
          } catch (e) {
            notify((e as Error).message);
          }
        })}
      >
        <label>
          标题
          <input autoFocus placeholder="需要完成什么？" {...register('title')} />
          {errors.title && <span className="error">{errors.title.message}</span>}
        </label>
        <div className="form-grid">
          <label>
            负责人
            <select {...register('responsibleUserId')}>
              {workers.data?.map((w) => (
                <option value={w.userId} key={w.userId}>
                  {w.displayName} · {w.usedWip}/{w.wipLimit}
                </option>
              ))}
            </select>
            {errors.responsibleUserId && (
              <span className="error">{errors.responsibleUserId.message}</span>
            )}
          </label>
          <label>
            状态
            <select {...register('stateId')}>
              {data.states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            类型
            <select {...register('typeId')}>
              {data.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            优先级
            <select {...register('priority')}>
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
        </div>
        <label>
          预估工时（天）
          <select
            aria-label="预估工时（天）"
            {...register('estimateDays', {
              setValueAs: (value) => (value === '' || value == null ? null : Number(value)),
            })}
          >
            <option value="">未估算</option>
            {estimateDaysOptions.map((days) => (
              <option key={days} value={days}>
                {days} 天
              </option>
            ))}
          </select>
          <small className="muted">按斐波那契档位估算；较大任务建议拆分。1 天按 8 小时对比。</small>
          {errors.estimateDays && <span className="error">{errors.estimateDays.message}</span>}
        </label>
        {data.board.lane_mode === 'manual' && (
          <label>
            持久泳道
            <select {...register('laneId')}>
              <option value="">未分组</option>
              {data.lanes
                .filter((l) => l.status === 'active')
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            disabled={isSubmitting || workers.isLoading || !workers.data?.length}
          >
            {isSubmitting ? '正在创建…' : '创建任务'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
