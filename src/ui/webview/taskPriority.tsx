import type { ReactNode } from 'react';
import type { TodoPriority } from '../../agent/state';
import {
  IconPriorityHigh,
  IconPriorityLow,
  IconPriorityMedium,
  IconPriorityVeryHigh
} from './icons';
import { STRINGS } from './strings';

// The priority of a task is an arrow of jira. The low one points down, the
// medium and the high ones point up, the very high is a double arrow. The
// color comes from the theme of the host.
export function priorityIcon(priority: TodoPriority): ReactNode {
  if (priority === 'very_high') {
    return <IconPriorityVeryHigh />;
  }
  if (priority === 'high') {
    return <IconPriorityHigh />;
  }
  if (priority === 'low') {
    return <IconPriorityLow />;
  }
  return <IconPriorityMedium />;
}

export function priorityTitle(priority: TodoPriority): string {
  if (priority === 'very_high') {
    return STRINGS.taskPriorityVeryHigh;
  }
  if (priority === 'high') {
    return STRINGS.taskPriorityHigh;
  }
  if (priority === 'low') {
    return STRINGS.taskPriorityLow;
  }
  return STRINGS.taskPriorityMedium;
}
