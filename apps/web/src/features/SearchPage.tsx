import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ArrowUpRight } from 'lucide-react';
import type { Task } from '@work/shared';
import { api } from '../api/client';
import { useApp } from '../lib/context';
import { EmptyState, PageHeader, PageSection } from '../components/PageLayout';
export function SearchPage() {
  const { workspace } = useApp();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const results = useQuery({
    queryKey: ['search', workspace?.id, q],
    queryFn: () =>
      api<Task[]>(`/api/workspaces/${workspace!.id}/search?q=${encodeURIComponent(q)}`),
    enabled: !!workspace && !!q,
  });
  return (
    <div className="page-layout search-page">
      <PageHeader
        title="搜索工作项"
        description={`在${workspace ? `「${workspace.name}」` : '当前工作空间'}中查找任务，快速定位所需工作。`}
      />
      <PageSection
        className="search-controls"
        title="查找任务"
        description="支持任务标题、描述和编号，仅显示你有权访问的内容。"
      >
        <form
          className="search-form page-search-form"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(input.trim());
          }}
        >
          <Search size={16} />
          <input
            aria-label="搜索关键词"
            placeholder="任务标题、描述或编号"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="primary" disabled={!input.trim()}>
            搜索
          </button>
        </form>
      </PageSection>
      <PageSection
        title="搜索结果"
        description={q ? `关键词：「${q}」` : undefined}
        actions={
          results.data && <span className="section-count">{results.data.length} 项结果</span>
        }
      >
        <div className="my-list">
          {!q && (
            <EmptyState
              icon={<Search size={22} />}
              title="从一个关键词开始"
              description="输入关键词，在当前工作空间中搜索。"
            />
          )}
          {results.isFetching && <EmptyState title="正在搜索…" tone="loading" />}
          {results.isError && (
            <EmptyState
              title="搜索失败，请重试。"
              tone="error"
              action={<button onClick={() => void results.refetch()}>重试</button>}
            />
          )}
          {results.data?.map((t) => (
            <a
              className="search-result"
              href={`/workspaces/${t.workspace_key}/boards/${t.board_key}/tasks/${t.seq}`}
              key={t.id}
            >
              <span className="mono muted">
                {t.board_key}-{t.seq}
              </span>
              <span className="search-result-title">{t.title}</span>
              <span className="muted search-result-meta">
                {t.board_name} · {t.responsible_name}
              </span>
              <ArrowUpRight size={14} className="entity-row-arrow" aria-hidden="true" />
            </a>
          ))}
          {!results.isFetching && results.data?.length === 0 && (
            <EmptyState
              title="没有匹配的工作项。"
              description="试试其他关键词，或检查搜索的工作空间。"
              icon={<Search size={22} />}
            />
          )}
        </div>
      </PageSection>
    </div>
  );
}
