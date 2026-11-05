import { useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus } from 'lucide-react';
import type { State, Task } from '@work/shared';
import { TaskCard } from '../../components/TaskCard';

export interface Group {
  id: string;
  name: string;
}
export function BoardCell({
  state,
  group,
  tasks,
  onOpen,
  onCreate,
}: {
  state: State;
  group: Group;
  tasks: Task[];
  onOpen: (t: Task) => void;
  onCreate: () => void;
}) {
  const drop = useDroppable({
    id: `cell:${state.id}:${group.id}`,
    data: { stateId: state.id, groupId: group.id },
  });
  const ref = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 116,
    overscan: 3,
  });
  const virtualize = tasks.length > 20;
  return (
    <section
      className={`board-cell ${drop.isOver ? 'drop-over' : ''}`}
      ref={drop.setNodeRef}
      aria-label={`${group.name} · ${state.name}`}
    >
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="cell-scroll" ref={ref}>
          {virtualize ? (
            <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
              {virtual.getVirtualItems().map((item) => (
                <div
                  key={tasks[item.index].id}
                  ref={virtual.measureElement}
                  data-index={item.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <TaskCard task={tasks[item.index]} onOpen={() => onOpen(tasks[item.index])} />
                </div>
              ))}
            </div>
          ) : (
            tasks.map((t) => <TaskCard key={t.id} task={t} onOpen={() => onOpen(t)} />)
          )}
        </div>
      </SortableContext>
      <button className="cell-create" onClick={onCreate}>
        <Plus size={13} />
        添加任务
      </button>
    </section>
  );
}
