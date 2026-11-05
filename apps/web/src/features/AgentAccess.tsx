import { useEffect, useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CheckCircle2, Clock3, ShieldCheck, Terminal, XCircle } from 'lucide-react';
import { api, post } from '../api/client';
import { useApp } from '../lib/context';
import { EmptyState, PageHeader, StatCard } from '../components/PageLayout';
import '../styles/agent-access.css';

type Scope = 'read' | 'write';
interface AuthorizationRequest {
  clientName: string;
  scopes: Scope[];
  expiresAt: string;
  status: string;
}
interface Authorization {
  id: string;
  clientName: string;
  scopes: Scope[];
  workspaceId: string;
  workspaceName: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function time(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function AgentAccess() {
  const { me, workspaces } = useApp();
  const location = useLocation();
  const code = new URLSearchParams(location.searchStr).get('code')?.trim().toUpperCase() ?? '';
  const [workspaceId, setWorkspaceId] = useState('');
  const [write, setWrite] = useState(false);
  const [expiresIn, setExpiresIn] = useState(3600);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<'approved' | 'denied' | null>(null);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState('');
  const [now, setNow] = useState(Date.now());
  const qc = useQueryClient();
  const request = useQuery({
    queryKey: ['agent-request', code],
    queryFn: () => api<AuthorizationRequest>(`/api/agent/requests/${encodeURIComponent(code)}`),
    enabled: !!code && !decision,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' && Date.parse(query.state.data.expiresAt) > Date.now()
        ? 5000
        : false,
  });
  const authorizations = useQuery({
    queryKey: ['agent-authorizations'],
    queryFn: () => api<Authorization[]>('/api/agent/authorizations'),
    refetchInterval: 30000,
  });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setWorkspaceId('');
    setWrite(false);
    setExpiresIn(3600);
    setDecision(null);
    setError('');
  }, [code]);
  const expired = !!request.data && Date.parse(request.data.expiresAt) <= now;
  const pending = request.data?.status === 'pending' && !expired && !decision;
  const canWrite = request.data?.scopes.includes('write');
  const selectedWorkspace = workspaces.find((w) => w.id === workspaceId && w.status === 'active');
  const activeGrants = (authorizations.data ?? []).filter(
    (grant) => !grant.revokedAt && Date.parse(grant.expiresAt) > now,
  );
  const writeGrants = activeGrants.filter((grant) => grant.scopes.includes('write')).length;
  const loginCommand = `work auth login --server ${window.location.origin}`;

  async function decide(action: 'approve' | 'deny') {
    setBusy(true);
    setError('');
    try {
      await post(
        `/api/agent/requests/${encodeURIComponent(code)}/${action}`,
        action === 'approve'
          ? { workspaceId, scopes: write && canWrite ? ['read', 'write'] : ['read'], expiresIn }
          : {},
      );
      setDecision(action === 'approve' ? 'approved' : 'denied');
      await qc.invalidateQueries({ queryKey: ['agent-authorizations'] });
    } catch (e) {
      setError((e as Error).message);
      void request.refetch();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setRevoking(id);
    setRevokeError('');
    try {
      await post(`/api/agent/authorizations/${encodeURIComponent(id)}/revoke`, {});
      await qc.invalidateQueries({ queryKey: ['agent-authorizations'] });
    } catch (e) {
      setRevokeError((e as Error).message);
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="page-layout agent-access">
      <PageHeader
        title="Agent 访问"
        description="连接你的工作助手，按需授予查询和任务维护权限。"
        actions={
          <span className="identity-pill">
            <ShieldCheck size={16} aria-hidden="true" />
            {me.display_name}
          </span>
        }
      />
      <div className="agent-content">
        <section className="agent-boundary" aria-label="授权规则">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <strong>由你授权，始终以你的现有权限操作</strong>
            <p>
              每份授权仅适用于一个工作空间，并有独立的有效期。你的账号停用、成员资格变更或看板撤权后，Agent
              的访问也会受到限制。你可以随时撤销授权。
            </p>
          </div>
        </section>

        {code ? (
          <section className="agent-card agent-consent" aria-labelledby="agent-consent-title">
            <div className="agent-section-heading">
              <Bot size={20} aria-hidden="true" />
              <h2 id="agent-consent-title">确认 CLI 授权请求</h2>
            </div>
            <p className="muted">
              请核对下方验证码与发起登录的 CLI 完全一致，仅批准你本人发起的请求。
            </p>
            <div className="agent-code" aria-label="设备验证码">
              {code}
            </div>
            {request.isPending && !decision && <p role="status">正在读取授权请求…</p>}
            {request.isError && !decision && (
              <div className="agent-feedback error" role="alert">
                <p>
                  无法读取请求：{(request.error as Error).message}。请求可能已失效，请在 CLI
                  重新登录。
                </p>
                <button onClick={() => void request.refetch()}>重试</button>
              </div>
            )}
            {request.data && (
              <dl className="agent-request-details">
                <div>
                  <dt>客户端</dt>
                  <dd>{request.data.clientName}</dd>
                </div>
                <div>
                  <dt>授权人</dt>
                  <dd>{me.display_name}</dd>
                </div>
                <div>
                  <dt>请求权限</dt>
                  <dd>{canWrite ? '查询、创建、修改和删除任务' : '查询工作空间、看板和任务'}</dd>
                </div>
                <div>
                  <dt>请求截止</dt>
                  <dd>{time(request.data.expiresAt)}（北京时间）</dd>
                </div>
              </dl>
            )}
            {pending && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void decide('approve');
                }}
              >
                <div className="agent-consent-fields">
                  <label>
                    工作空间
                    <select
                      required
                      value={workspaceId}
                      onChange={(e) => setWorkspaceId(e.target.value)}
                      disabled={busy}
                    >
                      <option value="">请选择一个工作空间</option>
                      {workspaces
                        .filter((w) => w.status === 'active')
                        .map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    授权有效期
                    <select
                      value={expiresIn}
                      onChange={(e) => setExpiresIn(Number(e.target.value))}
                      disabled={busy}
                    >
                      <option value={3600}>1 小时</option>
                      <option value={14400}>4 小时</option>
                      <option value={43200}>12 小时</option>
                    </select>
                  </label>
                </div>
                {!workspaces.some((w) => w.status === 'active') && (
                  <p className="error">暂无可授权的工作空间，请联系管理员添加成员后重试。</p>
                )}
                <div className="agent-scope">
                  <strong>默认只读</strong>
                  <p className="muted">允许查询该空间内你当前有权访问的看板和任务。</p>
                  {canWrite && (
                    <label className="agent-write-choice">
                      <input
                        type="checkbox"
                        checked={write}
                        onChange={(e) => setWrite(e.target.checked)}
                        disabled={busy}
                      />
                      <span>同时允许创建、修改和删除任务（仍受你的编辑权限约束）</span>
                    </label>
                  )}
                </div>
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <div className="agent-consent-actions">
                  <button type="button" onClick={() => void decide('deny')} disabled={busy}>
                    拒绝请求
                  </button>
                  <button className="primary" disabled={busy || !selectedWorkspace}>
                    {busy ? '正在处理…' : write && canWrite ? '授权查询与修改' : '授权只读访问'}
                  </button>
                </div>
              </form>
            )}
            {(decision || (request.data && !pending)) && (
              <div className="agent-feedback" role="status">
                {decision === 'approved' || (!expired && request.data?.status === 'approved') ? (
                  <>
                    <CheckCircle2 size={20} />
                    <span>授权已确认，请返回 CLI 完成登录。你可以在下方管理或撤销本次授权。</span>
                  </>
                ) : decision === 'denied' || request.data?.status === 'denied' ? (
                  <>
                    <XCircle size={20} />
                    <span>请求已拒绝，CLI 无法获得本次访问授权。</span>
                  </>
                ) : (
                  <>
                    <Clock3 size={20} />
                    <span>
                      本次请求已失效或已完成，请返回 CLI；需要重新授权时，再次运行登录命令。
                    </span>
                  </>
                )}
              </div>
            )}
          </section>
        ) : (
          <section className="agent-card agent-connect-card" aria-labelledby="agent-connect-title">
            <div className="agent-section-heading">
              <Terminal size={20} aria-hidden="true" />
              <h2 id="agent-connect-title">连接 Agent</h2>
            </div>
            <p className="muted">使用 Work CLI 连接工作助手。每次授权均需由你在浏览器中确认。</p>
            <ol className="agent-connect-steps">
              <li>
                <span className="agent-step-number" aria-hidden="true">
                  1
                </span>
                <div>
                  <strong>在终端发起登录</strong>
                  <p className="muted">已安装 Work CLI 后，运行以下命令，默认申请只读访问。</p>
                  <pre className="agent-command">
                    <code>{loginCommand}</code>
                  </pre>
                  <p className="muted">
                    需要维护任务时，在命令末尾添加 <code>--write</code> 申请写入权限。
                  </p>
                </div>
              </li>
              <li>
                <span className="agent-step-number" aria-hidden="true">
                  2
                </span>
                <div>
                  <strong>打开链接并确认授权</strong>
                  <p className="muted">核对终端显示的验证码，选择工作空间、权限与有效期。</p>
                </div>
              </li>
              <li>
                <span className="agent-step-number" aria-hidden="true">
                  3
                </span>
                <div>
                  <strong>返回终端开始使用</strong>
                  <p className="muted">登录成功后，Agent 即可在授权范围内查询和处理工作。</p>
                </div>
              </li>
            </ol>
            <div className="agent-code-entry-panel">
              <h3>已有设备验证码？</h3>
              <p className="muted">也可以输入终端中的验证码，直接查看待确认的请求。</p>
              <form className="agent-code-entry" action="/agent-access" method="get">
                <label htmlFor="agent-user-code">设备验证码</label>
                <div>
                  <input
                    id="agent-user-code"
                    name="code"
                    required
                    maxLength={32}
                    placeholder="XXXX-XXXX-XXXX"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button type="submit">查看请求</button>
                </div>
              </form>
            </div>
          </section>
        )}

        <section className="agent-card" aria-labelledby="agent-authorizations-title">
          <div className="agent-section-heading agent-grants-heading">
            <div>
              <ShieldCheck size={20} aria-hidden="true" />
              <h2 id="agent-authorizations-title">我的授权</h2>
            </div>
            <button
              onClick={() => void authorizations.refetch()}
              disabled={authorizations.isFetching}
            >
              刷新
            </button>
          </div>
          <p className="muted">这里显示由你确认的 CLI 授权。时间均为北京时间。</p>
          <div className="stat-grid agent-authorization-summary">
            <StatCard
              label="有效授权"
              value={authorizations.isPending ? '—' : activeGrants.length}
              detail="当前仍可使用"
              icon={<Bot size={16} />}
            />
            <StatCard
              label="只读访问"
              value={authorizations.isPending ? '—' : activeGrants.length - writeGrants}
              detail="查询看板和任务"
            />
            <StatCard
              label="查询与修改"
              value={authorizations.isPending ? '—' : writeGrants}
              detail="仍受你的编辑权限约束"
            />
          </div>
          {revokeError && (
            <p className="error" role="alert">
              撤销失败：{revokeError}
            </p>
          )}
          {authorizations.isPending && <EmptyState title="正在加载授权…" tone="loading" />}
          {authorizations.isError && (
            <EmptyState title="授权加载失败" description="请点击刷新重试。" tone="error" />
          )}
          {authorizations.data?.length === 0 && (
            <EmptyState
              title="暂无 Agent 授权"
              description="连接并确认一个 Agent 后，可在这里查看和撤销授权。"
              icon={<Bot size={22} />}
            />
          )}
          <div className="agent-grants">
            {authorizations.data?.map((grant) => {
              const active = !grant.revokedAt && Date.parse(grant.expiresAt) > now;
              return (
                <article className="agent-grant" key={grant.id}>
                  <div className="agent-grant-icon">
                    <Bot size={19} aria-hidden="true" />
                  </div>
                  <div className="agent-grant-info">
                    <div className="agent-grant-title">
                      <strong>{grant.clientName}</strong>
                      <span className={`agent-status ${active ? 'active' : ''}`}>
                        {grant.revokedAt ? '已撤销' : active ? '有效' : '已到期'}
                      </span>
                    </div>
                    <p className="agent-grant-summary">
                      <span>{grant.workspaceName || grant.workspaceId}</span>
                      <span className="role-badge">
                        {grant.scopes.includes('write') ? '查询与修改' : '只读'}
                      </span>
                    </p>
                    <p className="muted">
                      {time(grant.createdAt)} 授权 · {time(grant.expiresAt)} 到期
                    </p>
                    <p className="muted">
                      {grant.lastUsedAt ? `最近使用 ${time(grant.lastUsedAt)}` : '尚未使用'}
                    </p>
                  </div>
                  {active && (
                    <button
                      aria-label={`撤销 ${grant.clientName} 的授权`}
                      disabled={revoking !== null}
                      onClick={() => void revoke(grant.id)}
                    >
                      {revoking === grant.id ? '正在撤销…' : '撤销授权'}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
