import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Link } from 'lucide-react';
import { api, post } from '../api/client';
import { Modal } from '../components/ui';
import '../styles/sharing.css';

interface Share {
  enabled: boolean;
  updatedAt: string | null;
  submissionKind: 'requirement' | 'ticket' | null;
  url?: string;
}

export function BoardShare({
  boardId,
  open,
  onClose,
}: {
  boardId: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [fresh, setFresh] = useState<Share | null>(null);
  const share = useQuery({
    queryKey: ['board-share', boardId],
    queryFn: () => api<Share>(`/api/boards/${boardId}/share`),
    enabled: open,
    retry: false,
  });
  let cached: Share | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(`board-share:${boardId}`) ?? 'null') as Share | null;
  } catch {
    /* Storage may be disabled. The newly created link remains available in memory. */
  }
  const current = share.data;
  const saved = fresh?.updatedAt === current?.updatedAt ? fresh : cached;
  const url = current?.enabled && saved?.updatedAt === current.updatedAt ? saved?.url : undefined;

  async function change(action: 'enable' | 'reset' | 'disable') {
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const result = await post<Share>(
        `/api/boards/${boardId}/share`,
        action === 'disable' ? {} : { regenerate: action === 'reset' },
        action === 'disable' ? 'DELETE' : 'POST',
      );
      setFresh(action === 'disable' ? null : result);
      try {
        if (action === 'disable') localStorage.removeItem(`board-share:${boardId}`);
        else if (result.url) localStorage.setItem(`board-share:${boardId}`, JSON.stringify(result));
      } catch {
        /* Copying the current link does not require browser storage. */
      }
      setConfirmReset(false);
      await qc.invalidateQueries({ queryKey: ['board-share', boardId] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="公开分享" open={open} onOpenChange={(v) => !v && onClose()}>
      {share.isPending ? (
        <p role="status">正在加载…</p>
      ) : share.isError ? (
        <p className="error" role="alert">
          分享设置加载失败。<button onClick={() => void share.refetch()}>重试</button>
        </p>
      ) : (
        <div className="share-settings">
          <p className="muted">
            持有链接的访客可查看此看板，无法修改任务。
            {current?.submissionKind &&
              `可${current.submissionKind === 'ticket' ? '提报运维工单' : '提报需求'}。`}
          </p>
          {current?.enabled ? (
            <>
              <span className="share-status">
                <Link size={14} />
                分享已开启
              </span>
              {url ? (
                <>
                  <label>
                    公开链接
                    <input
                      aria-label="公开链接"
                      readOnly
                      value={url}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                  <div className="share-actions">
                    <button
                      className="primary"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(url);
                          setCopied(true);
                          setError('');
                        } catch {
                          setError('无法自动复制，请选中链接手动复制。');
                        }
                      }}
                    >
                      <Copy size={14} />
                      {copied ? '已复制' : '复制链接'}
                    </button>
                    <a href={url} target="_blank" rel="noreferrer">
                      <ExternalLink size={14} />
                      预览
                    </a>
                  </div>
                </>
              ) : (
                <p className="muted">此浏览器未保存链接，可重新生成后复制。</p>
              )}
              {confirmReset ? (
                <div className="share-reset">
                  <p>重新生成后，原链接将失效。</p>
                  <button disabled={busy} onClick={() => void change('reset')}>
                    确认重新生成
                  </button>
                  <button disabled={busy} onClick={() => setConfirmReset(false)}>
                    取消
                  </button>
                </div>
              ) : (
                <div className="share-secondary">
                  <button disabled={busy} onClick={() => setConfirmReset(true)}>
                    重新生成链接
                  </button>
                  <button className="error" disabled={busy} onClick={() => void change('disable')}>
                    关闭分享
                  </button>
                </div>
              )}
            </>
          ) : (
            <button className="primary" disabled={busy} onClick={() => void change('enable')}>
              {busy ? '正在开启…' : '开启公开分享'}
            </button>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
