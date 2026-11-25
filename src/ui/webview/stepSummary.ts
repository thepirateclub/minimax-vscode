// The summary of a long group of actions: a turn of hundreds of actions is
// read by what it did, not card by card. The kinds of the tools are counted,
// the changed files carry the size of the change, the failures are named.

import type { UiMessage } from '../protocol';
import { diffStats } from './diffStats';

const READ = new Set([
  'read_file',
  'list_files',
  'read_skill',
  'tasks_read',
  'understand_image',
  'web_fetch'
]);
const EDIT = new Set(['write_file', 'edit_file']);
const RUN = new Set(['run_terminal', 'run_cmd', 'repl_node', 'repl_python']);
const SEARCH = new Set(['search_code', 'web_search']);

// A group shorter than this reads card by card, the summary would repeat it.
export const SUMMARY_FROM = 10;
// The cards a long group draws at once; the earlier ones open on a click.
export const CARDS_PAGE = 50;

// The count of the head of a group, a word with the number: a bare number
// after the time read as one more figure of the time.
export function actionCount(count: number): string {
  return count + (count === 1 ? ' action' : ' actions');
}

export interface StepSummary {
  reads: number;
  files: number;
  added: number;
  removed: number;
  runs: number;
  searches: number;
  git: number;
  other: number;
  failed: number;
}

export function summarizeStep(tools: readonly UiMessage[]): StepSummary {
  const summary: StepSummary = { reads: 0, files: 0, added: 0, removed: 0, runs: 0, searches: 0, git: 0, other: 0, failed: 0 };
  const changed = new Set<string>();
  for (const message of tools) {
    const tool = message.tool;
    if (!tool) {
      continue;
    }
    if (tool.isError) {
      summary.failed += 1;
    }
    if (READ.has(tool.name)) {
      summary.reads += 1;
    } else if (EDIT.has(tool.name)) {
      if (!tool.isError) {
        changed.add(String(tool.input['path'] ?? ''));
        const stats = diffStats(tool.diff?.lines ?? []);
        summary.added += stats.added;
        summary.removed += stats.removed;
      }
    } else if (RUN.has(tool.name)) {
      summary.runs += 1;
    } else if (SEARCH.has(tool.name)) {
      summary.searches += 1;
    } else if (tool.name.startsWith('git_')) {
      summary.git += 1;
    } else {
      summary.other += 1;
    }
  }
  summary.files = changed.size;
  return summary;
}

function count(value: number, one: string, many: string): string {
  return value + ' ' + (value === 1 ? one : many);
}

// One line of the summary, the kinds that did not happen are not named.
export function formatStepSummary(summary: StepSummary): string {
  const parts: string[] = [];
  if (summary.files > 0) {
    const size = (summary.added > 0 ? ' +' + summary.added : '') + (summary.removed > 0 ? ' −' + summary.removed : '');
    parts.push('changed ' + count(summary.files, 'file', 'files') + size);
  }
  if (summary.reads > 0) {
    parts.push(count(summary.reads, 'read', 'reads'));
  }
  if (summary.searches > 0) {
    parts.push(count(summary.searches, 'search', 'searches'));
  }
  if (summary.runs > 0) {
    parts.push(count(summary.runs, 'run', 'runs'));
  }
  if (summary.git > 0) {
    parts.push(count(summary.git, 'git action', 'git actions'));
  }
  if (summary.other > 0) {
    parts.push(count(summary.other, 'other', 'others'));
  }
  if (summary.failed > 0) {
    parts.push(count(summary.failed, 'failed', 'failed'));
  }
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
