import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { Task } from '@work/shared';
import { api } from '../api/client';
import { useApp } from '../lib/context';
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
    <>
      <header className="page-heading">
        <h1>搜索工作项</h1>
      </header>
      <form
        className="search-form"
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
        <button>搜索</button>
      </form>
      <div className="my-list">
        {results.data?.map((t) => (
          <a
            className="search-result"
            href={`/workspaces/${t.workspace_key}/boards/${t.board_key}/tasks/${t.seq}`}
            key={t.id}
          >
            <span className="mono muted">
              {t.board_key}-{t.seq}
            </span>
            <span>{t.title}</span>
            <span className="muted">{t.responsible_name}</span>
          </a>
        ))}
        {results.isFetching && <div className="empty">正在搜索…</div>}
        {results.isError && <div className="empty error">搜索失败，请重试。</div>}
        {!q && <div className="empty">输入关键词，在当前工作空间中搜索。</div>}
        {results.data?.length === 0 && <div className="empty">没有匹配的工作项。</div>}
      </div>
    </>
  );
}
