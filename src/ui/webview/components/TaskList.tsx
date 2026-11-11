import { useState } from 'react';
import type { TodoItem } from '../../../agent/state';
import { IconClose, IconList } from '../icons';
import { STRINGS } from '../strings';

// The rows of the tasks, shared by the widget over the feed and the card of
// the tool in the feed. Only the high priority gets a word: a word on every
// row is noise, the reader looks for the urgent one.
export function TaskRows({ todos }: { todos: TodoItem[] }) {
  return (
    <ul className="task-rows">
      {todos.map((item, index) => (
        <li
          key={index + ':' + item.content}
          className={'task-row task-' + item.status + (item.priority === 'high' ? ' task-high' : '')}
        >
          <span className="task-marker" aria-hidden="true" />
          <span className="task-text">{item.content}</span>
          {item.priority === 'high' ? (
            <span className="task-priority">{STRINGS.taskPriorityHigh}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// The list of tasks over the feed. The model writes the list, the reader
// only looks at it: a click on a task changes nothing.
export function TaskList({
  todos,
  onClear
}: {
  todos: TodoItem[];
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(true);
  if (todos.length === 0) {
    return null;
  }
  const done = todos.filter((item) => item.status === 'completed').length;
  return (
    <div className="task-list">
      {/* The toggle and the clear button are siblings: a button inside a
          button is not valid markup and the click would fold the list. */}
      <div className="task-head-row">
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
        {onClear ? (
          <button
            className="task-clear"
            title={STRINGS.taskClear}
            aria-label={STRINGS.taskClear}
            onClick={onClear}
          >
            <IconClose />
          </button>
        ) : null}
      </div>
      {open ? <TaskRows todos={todos} /> : null}
    </div>
  );
}
