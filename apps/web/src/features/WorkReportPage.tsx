import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WorkReport } from '@work/shared';
import { api } from '../api/client';
import { useApp } from '../lib/context';

export function WorkReportPage() {
  const { workspaces } = useApp();
  const [filter, setFilter] = useState({
    workspaceId: '',
    userId: '',
    taskId: '',
    from: '',
    to: '',
  });
  const directory = useQuery({
    queryKey: ['work-report', 'directory', filter.workspaceId],
    queryFn: () =>
      api<WorkReport>(
        `/api/work-logs/report${filter.workspaceId ? `?workspaceId=${filter.workspaceId}` : ''}`,
      ),
  });
  const invalidRange = !!filter.from && !!filter.to && filter.from > filter.to;
  const query = new URLSearchParams(Object.entries(filter).filter(([, value]) => value));
  const report = useQuery({
    queryKey: ['work-report', 'filtered', filter],
    queryFn: () => api<WorkReport>(`/api/work-logs/report?${query}`),
    enabled: !invalidRange,
  });
  return (
    <>
      <header className="page-heading">
        <div>
          <h1>工时统计</h1>
          <p className="muted">汇总有权限查看的任务工时，按实际投入人员统计。</p>
        </div>
      </header>
      <div className="work-report">
        <div className="report-filters">
          <label>
            工作空间
            <select
              value={filter.workspaceId}
              onChange={(e) =>
                setFilter({ ...filter, workspaceId: e.target.value, userId: '', taskId: '' })
              }
            >
              <option value="">所有工作空间</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            投入人员
            <select
              value={filter.userId}
              onChange={(e) => setFilter({ ...filter, userId: e.target.value })}
            >
              <option value="">所有人员</option>
              {directory.data?.byUser.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.userName}
                </option>
              ))}
            </select>
          </label>
          <label>
            任务
            <select
              value={filter.taskId}
              onChange={(e) => setFilter({ ...filter, taskId: e.target.value })}
            >
              <option value="">所有任务</option>
              {directory.data?.byTask.map((t) => (
                <option key={t.taskId} value={t.taskId}>
                  {t.boardKey}-{t.seq} · {t.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            起始日期
            <input
              type="date"
              value={filter.from}
              onChange={(e) => setFilter({ ...filter, from: e.target.value })}
            />
          </label>
          <label>
            结束日期
            <input
              type="date"
              value={filter.to}
              onChange={(e) => setFilter({ ...filter, to: e.target.value })}
            />
          </label>
          <button
            onClick={() => setFilter({ workspaceId: '', userId: '', taskId: '', from: '', to: '' })}
          >
            清空筛选
          </button>
        </div>
        {invalidRange ? (
          <p className="error" role="alert">
            结束日期不能早于起始日期。
          </p>
        ) : (
          <>
            {report.isLoading && <p role="status">正在汇总工时…</p>}
            {(report.isError || directory.isError) && (
              <p className="error" role="alert">
                工时统计加载失败。
                <button
                  onClick={() => {
                    void report.refetch();
                    void directory.refetch();
                  }}
                >
                  重试
                </button>
              </p>
            )}
            {report.data && (
              <>
                <div className="effort-summary report-summary">
                  <strong>{report.data.totalHours} 小时</strong>
                  <span>
                    折合 {Number((report.data.totalHours / report.data.hoursPerDay).toFixed(2))}{' '}
                    人天
                  </span>
                  <span>{report.data.totalEntries} 条记录</span>
                  <small className="muted">1 人天 = {report.data.hoursPerDay} 小时</small>
                </div>
                {report.data.totalEntries === 0 ? (
                  <div className="empty">当前筛选范围内暂无工时记录。</div>
                ) : (
                  <>
                    <div className="report-breakdowns">
                      <section>
                        <h2>按人员</h2>
                        {report.data.byUser.map((u) => (
                          <div className="report-row" key={u.userId}>
                            <span>{u.userName}</span>
                            <strong>{u.hours} 小时</strong>
                          </div>
                        ))}
                      </section>
                      <section>
                        <h2>按日期</h2>
                        {report.data.byDate.map((d) => (
                          <div className="report-row" key={d.workDate}>
                            <time>{d.workDate}</time>
                            <strong>{d.hours} 小时</strong>
                          </div>
                        ))}
                      </section>
                    </div>
                    <section>
                      <h2>按任务</h2>
                      <p className="muted">
                        筛选工时反映当前筛选范围；累计工时与预估比较使用该任务所有人员的全部记录。
                      </p>
                      <div className="report-table-scroll">
                        <table className="report-table">
                          <thead>
                            <tr>
                              <th>任务</th>
                              <th>预估（天）</th>
                              <th>筛选工时</th>
                              <th>累计工时</th>
                              <th>预估对比</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.data.byTask.map((t) => (
                              <tr key={t.taskId}>
                                <td>
                                  <a
                                    href={`/workspaces/${t.workspaceKey}/boards/${t.boardKey}/tasks/${t.seq}`}
                                  >
                                    {t.boardKey}-{t.seq} · {t.title}
                                  </a>
                                </td>
                                <td>{t.estimateDays ?? '未估算'}</td>
                                <td>{t.hours} 小时</td>
                                <td>{t.totalTaskHours} 小时</td>
                                <td
                                  className={
                                    t.estimateDays !== null &&
                                    t.totalTaskHours > t.estimateDays * report.data!.hoursPerDay
                                      ? 'error'
                                      : ''
                                  }
                                >
                                  {t.estimateDays === null
                                    ? '—'
                                    : `${Math.round((t.totalTaskHours / (t.estimateDays * report.data!.hoursPerDay)) * 100)}% 已投入`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
