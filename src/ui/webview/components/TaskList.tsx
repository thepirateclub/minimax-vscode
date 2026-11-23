import { useState } from 'react';
import type { TodoItem } from '../../../agent/state';
import { IconClose, IconList } from '../icons';
import { priorityIcon, priorityTitle } from '../taskPriority';
import { STRINGS } from '../strings';

// The rows of the tasks, shared by the widget over the feed and the card of
// the tool in the feed. The priority stands on the right as an arrow of
// jira: the low one points down, the medium and the high ones point up, the
// very high is a double arrow. The color comes from the theme.
export function TaskRows({ todos }: { todos: TodoItem[] }) {
  return (
    <ul className="task-rows">
      {todos.map((item, index) => (
        <li
          key={index + ':' + item.content}
          className={'task-row task-' + item.status}
        >
          <span className="task-marker" aria-hidden="true" />
          <span className="task-text">{item.content}</span>
          <span
            className={'task-priority task-priority-' + item.priority}
            title={priorityTitle(item.priority)}
            aria-label={priorityTitle(item.priority)}
          >
            {priorityIcon(item.priority)}
          </span>
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
