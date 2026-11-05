import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WorkReport } from '@work/shared';
import { api } from '../api/client';
import { useApp } from '../lib/context';
import { CalendarDays, Clock3, FileText, Users } from 'lucide-react';
import { EmptyState, PageHeader, PageSection, StatCard } from '../components/PageLayout';

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
    <div className="page-layout work-report-page">
      <PageHeader
        eyebrow="投入与产出"
        title="工时统计"
        description="汇总有权限查看的任务工时，按实际投入人员统计。"
      />
      <div className="work-report">
        {!invalidRange && report.data && (
          <div className="page-summary-grid report-summary report-summary-grid">
            <StatCard
              label="累计投入"
              value={`${report.data.totalHours} 小时`}
              detail="当前筛选范围内的实际投入"
              icon={<Clock3 size={18} aria-hidden="true" />}
            />
            <StatCard
              label="折合人天"
              value={`${Number((report.data.totalHours / report.data.hoursPerDay).toFixed(2))} 人天`}
              detail={`1 人天 = ${report.data.hoursPerDay} 小时`}
              icon={<CalendarDays size={18} aria-hidden="true" />}
            />
            <StatCard
              label="工时记录"
              value={`${report.data.totalEntries} 条记录`}
              detail={`${report.data.byTask.length} 项任务产生投入`}
              icon={<FileText size={18} aria-hidden="true" />}
            />
            <StatCard
              label="投入人员"
              value={`${report.data.byUser.length} 人`}
              detail="按工时记录的登记人员统计"
              icon={<Users size={18} aria-hidden="true" />}
            />
          </div>
        )}
        <PageSection
          className="report-filter-section"
          title="筛选范围"
          description="选择工作空间、人员或日期，查看对应的实际投入。"
          actions={
            <button
              onClick={() =>
                setFilter({ workspaceId: '', userId: '', taskId: '', from: '', to: '' })
              }
            >
              清空筛选
            </button>
          }
        >
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
          </div>
        </PageSection>
        {invalidRange ? (
          <p className="error" role="alert">
            结束日期不能早于起始日期。
          </p>
        ) : (
          <>
            {report.isLoading && <EmptyState tone="loading" title="正在汇总工时…" />}
            {(report.isError || directory.isError) && (
              <EmptyState
                tone="error"
                title="工时统计加载失败。"
                description="暂时无法读取工时记录，请重试。"
                action={
                  <button
                    onClick={() => {
                      void report.refetch();
                      void directory.refetch();
                    }}
                  >
                    重试
                  </button>
                }
              />
            )}
            {report.data && (
              <>
                {report.data.totalEntries === 0 ? (
                  <EmptyState
                    icon={<Clock3 size={22} aria-hidden="true" />}
                    title="当前筛选范围内暂无工时记录。"
                    description="调整筛选范围，或进入任务详情登记实际投入。"
                  />
                ) : (
                  <>
                    <div className="report-breakdowns">
                      <PageSection title="按人员" description="每位成员在筛选范围内的投入">
                        {report.data.byUser.map((u) => (
                          <div className="report-row" key={u.userId}>
                            <span>{u.userName}</span>
                            <strong>{u.hours} 小时</strong>
                          </div>
                        ))}
                      </PageSection>
                      <PageSection title="按日期" description="按实际工作日期汇总">
                        {report.data.byDate.map((d) => (
                          <div className="report-row" key={d.workDate}>
                            <time dateTime={d.workDate}>{d.workDate}</time>
                            <strong>{d.hours} 小时</strong>
                          </div>
                        ))}
                      </PageSection>
                    </div>
                    <PageSection
                      className="report-task-section"
                      title="按任务"
                      description="筛选工时反映当前筛选范围；累计工时与预估比较使用该任务所有人员的全部记录。"
                    >
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
                    </PageSection>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
