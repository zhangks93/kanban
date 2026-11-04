import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardData, Worker } from '@work/shared';
import { api, post } from '../api/client';
import { useApp } from '../lib/context';
import { Modal } from '../components/ui';
export function IntakePanel({
  data,
  open,
  onClose,
}: {
  data: BoardData;
  open: boolean;
  onClose: () => void;
}) {
  const { me, notify } = useApp();
  const noun = data.board.plugin_key === 'ops' ? '工单' : '需求';
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [responsible, setResponsible] = useState(me.id);
  const [reason, setReason] = useState('');
  const rows = useQuery({
    queryKey: ['intake', data.board.id],
    queryFn: () =>
      api<
        {
          id: string;
          title: string;
          status: string;
          requester_name: string;
          description: string | null;
          guest_contact: string | null;
          source: string;
        }[]
      >(`/api/boards/${data.board.id}/intake`),
    enabled: open,
  });
  const workers = useQuery({
    queryKey: ['workers', data.board.id],
    queryFn: () => api<Worker[]>(`/api/boards/${data.board.id}/workers`),
    enabled: open,
  });
  async function decide(id: string, accept: boolean) {
    try {
      await post(
        `/api/intake/${id}/${accept ? 'accept' : 'decline'}`,
        accept ? { responsibleUserId: responsible } : { reason },
      );
      await qc.invalidateQueries();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <Modal title={`${noun}提报`} open={open} onOpenChange={(v) => !v && onClose()}>
      {data.board.intake_enabled && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await post(`/api/boards/${data.board.id}/intake`, {
                title,
                description,
                clientMutationId: crypto.randomUUID(),
              });
              setTitle('');
              setDescription('');
              await rows.refetch();
            } catch (err) {
              notify((err as Error).message);
            }
          }}
        >
          <label>
            {noun}标题
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label>
            {noun}说明
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <button>提交{noun}</button>
        </form>
      )}
      {data.board.can_manage && (
        <div className="intake-assignee">
          <label>
            接受时指定负责人
            <select value={responsible} onChange={(e) => setResponsible(e.target.value)}>
              {workers.data?.map((w) => (
                <option key={w.userId} value={w.userId}>
                  {w.displayName}
                </option>
              ))}
            </select>
          </label>
          <input
            aria-label="拒绝原因"
            placeholder="拒绝时请填写原因"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      )}
      <div className="intake-list">
        {rows.data?.map((r) => (
          <div key={r.id}>
            <strong>{r.title}</strong>
            {r.description && (
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.description}</p>
            )}
            <p className="muted">
              {r.requester_name} ·{' '}
              {{ pending: '待处理', accepted: '已接受', declined: '已拒绝' }[r.status]}
              {r.source === 'public' && ' · 访客提报'}
            </p>
            {data.board.can_manage && r.guest_contact && <p>联系方式：{r.guest_contact}</p>}
            {data.board.can_manage && r.status === 'pending' && (
              <div>
                <button onClick={() => void decide(r.id, true)}>接受并创建任务</button>
                <button onClick={() => void decide(r.id, false)} disabled={!reason.trim()}>
                  拒绝
                </button>
              </div>
            )}
          </div>
        ))}
        {rows.isPending && (
          <p className="muted" role="status">
            正在加载…
          </p>
        )}
        {rows.isError && (
          <p className="error" role="alert">
            提报加载失败。<button onClick={() => void rows.refetch()}>重试</button>
          </p>
        )}
        {rows.data?.length === 0 && <p className="empty">暂无{noun}提报</p>}
      </div>
    </Modal>
  );
}
