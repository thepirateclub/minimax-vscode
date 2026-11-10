import { useState } from 'react';
import type { TodoItem } from '../../../agent/state';
import { IconList } from '../icons';
import { STRINGS } from '../strings';

// The list of tasks over the feed. The model writes the list, the reader
// only looks at it: a click on a task changes nothing.
export function TaskList({ todos }: { todos: TodoItem[] }) {
  const [open, setOpen] = useState(true);
  if (todos.length === 0) {
    return null;
  }
  const done = todos.filter((item) => item.status === 'completed').length;
  return (
    <div className="task-list">
      <button
        className="task-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={STRINGS.taskTitle}
      >
        <IconList />
        <span className="task-title">{STRINGS.taskTitle}</span>
        <span className="task-count">
          {done}/{todos.length}
        </span>
      </button>
      {open ? (
        <ul className="task-rows">
          {todos.map((item, index) => (
            <li key={index} className={'task-row task-' + item.status}>
              <span className="task-marker" aria-hidden="true" />
              <span className="task-text">{item.content}</span>
              <span className="task-priority">{item.priority}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
