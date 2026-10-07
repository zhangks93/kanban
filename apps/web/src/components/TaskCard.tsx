import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Circle, Flag, GripVertical, Sun } from 'lucide-react';
import type { Task } from '@work/shared';
import { useApp } from '../lib/context';
export const priorityNames = { urgent: '紧急', high: '高', medium: '中', low: '低', none: '无' };
export function TaskCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { me } = useApp();
  const drag = useSortable({ id: task.id, data: { task }, disabled: !task.can_edit });
  return (
    <article
      ref={drag.setNodeRef}
      style={{
        transform: CSS.Transform.toString(drag.transform),
        transition: drag.transition,
        opacity: drag.isDragging ? 0.45 : 1,
      }}
      className={`task-card ${task.focus_user_ids.includes(me.id) ? 'focused' : ''}`}
      data-testid={`task-${task.seq}`}
    >
      <div className="card-top">
        <span className="mono muted">
          {task.board_key}-{task.seq}
        </span>
        <span className="card-type">{task.type_name}</span>
        {task.focus_user_ids.length > 0 && (
          <Sun size={13} className="focus-icon" aria-label="有成员正在点亮" />
        )}
        <button
          className="drag-handle"
          aria-label={`拖动 ${task.title}`}
          {...drag.attributes}
          {...drag.listeners}
        >
          <GripVertical size={13} />
        </button>
      </div>
      <button className="card-title" onClick={onOpen}>
        {task.title}
      </button>
      <div className="card-meta">
        <span
          className={`priority priority-${task.priority}`}
          title={`优先级：${priorityNames[task.priority]}`}
        >
          <Flag size={12} />
          {priorityNames[task.priority]}
        </span>
        {task.due_date && (
          <time className="mono muted" dateTime={task.due_date}>
            {task.due_date.slice(5, 10).replace('-', '/')}
          </time>
        )}
        <span className="people">
          <span className="participant-stack">
            {task.participants.slice(0, 3).map((p) => (
              <span
                className="avatar participant"
                key={p.id}
                title={`${p.display_name} · 参与人${p.eligible ? '' : ' · 无当前工作权限'}`}
              >
                {p.display_name.slice(0, 1)}
              </span>
            ))}
            {task.participants.length > 3 && (
              <span className="participant-more">+{task.participants.length - 3}</span>
            )}
          </span>
          <span
            className="avatar responsible"
            title={`${task.responsible_name} · 负责人${task.responsible_eligible ? '' : ' · 无当前工作权限'}`}
          >
            {task.responsible_name.slice(0, 1)}
          </span>
        </span>
      </div>
      {!task.responsible_eligible && (
        <div className="card-warning">
          <Circle size={10} />
          负责人无当前工作权限
        </div>
      )}
    </article>
  );
}
