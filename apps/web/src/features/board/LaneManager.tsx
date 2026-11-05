import { useState } from 'react';
import type { BoardData } from '@work/shared';
import { useApp } from '../../lib/context';
import { useTaskMutations } from '../../lib/task-mutations';
import { post } from '../../api/client';
import { Modal } from '../../components/ui';
import { PluginLanePanel } from '../PluginLanePanel';

export function LaneManager({
  data,
  open,
  onClose,
}: {
  data: BoardData;
  open: boolean;
  onClose: () => void;
}) {
  const { notify } = useApp();
  const mutations = useTaskMutations();
  const [name, setName] = useState('');
  const [rename, setRename] = useState<Record<string, string>>({});
  async function save(path: string, body: unknown, method = 'POST') {
    try {
      await post(`/api/boards/${data.board.id}/lanes${path}`, body, method);
      await mutations.refresh();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <Modal title="管理泳道" open={open} onOpenChange={(v) => !v && onClose()}>
      <div className="lane-manager">
        {data.lanes
          .filter((l) => l.status === 'active')
          .map((l, i) => (
            <div className="lane-manager-row" key={l.id}>
              <div>
                <input
                  aria-label={`${l.name}名称`}
                  value={rename[l.id] ?? l.name}
                  onChange={(e) => setRename({ ...rename, [l.id]: e.target.value })}
                />
                <button
                  onClick={() => void save(`/${l.id}`, { name: rename[l.id] ?? l.name }, 'PATCH')}
                >
                  保存
                </button>
                <button
                  aria-label={`上移${l.name}`}
                  onClick={() => void save(`/${l.id}`, { sortOrder: i - 1 }, 'PATCH')}
                >
                  ↑
                </button>
                <button onClick={() => void save(`/${l.id}/archive`, {})}>归档</button>
              </div>
              <PluginLanePanel data={data} lane={l} />
            </div>
          ))}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await save('', { name });
            setName('');
          }}
        >
          <input
            placeholder="新泳道名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button>添加</button>
        </form>
      </div>
    </Modal>
  );
}
