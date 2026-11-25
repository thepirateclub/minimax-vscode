import type { BackupStore } from '../storage/backups';
import type { ProjectSearch } from '../search/project';
import type { DiagnosticsProvider } from './diagnostics';
import { createCmdTools } from './cmd';
import { createCompareTools } from './compare';
import { createGrepTools } from './grep';
import { createContainerTools } from './containers';
import { createExploreTools } from './explore';
import { createFileTools } from './fs';
import { createGitTools } from './git';
import { createGoalTools } from './goal';
import { createReplTools } from './repl';
import { createTaskTools, type TaskOptions } from './task';
import { createTaskFileTools } from './tasks';
import { createTerminalTools } from './terminal';
import { createTodoTools } from './todo';
import { createSkillTools } from './skills';
import { createWebTools, type WebToolOptions } from './web';
import { createNoteTools, type NoteToolOptions } from './notes';
import type { Skill } from '../skills/skills';
import type { ToolEntry } from './types';

// The tools of the agent, one list for the host and for the tests. The list
// of the panel and the list of the tools must not drift apart: a tool
// without a card in the panel is a tool the reader does not understand.
export interface AllToolDeps {
  // The store of the backups of the written files.
  backups: BackupStore;
  // The index of the project, the search tool uses it.
  search: (workspaceRoot: string) => ProjectSearch | undefined;
  // The host starts the child of the task tool.
  spawn: TaskOptions['spawn'];
  // The problems of a file after a change, absent in the tests.
  diagnostics?: DiagnosticsProvider;
  // The skills of the project and of the user, absent in the tests.
  skills?: (workspaceRoot: string) => Promise<Skill[]>;
  // The web search and the vision model of the M Plan, absent in the tests.
  web?: WebToolOptions;
  // The notes of the agent in .minimax/agent, absent in the tests.
  notes?: NoteToolOptions['notes'];
}

export function createAllTools(deps: AllToolDeps): ToolEntry[] {
  return [
    ...createFileTools({ backups: deps.backups, diagnostics: deps.diagnostics }),
    ...createExploreTools({ search: deps.search }),
    ...createGrepTools(),
    ...createCompareTools(),
    ...createGitTools(),
    ...createTerminalTools(),
    ...createCmdTools(),
    ...createTodoTools(),
    ...createTaskFileTools(),
    ...createReplTools(),
    ...createContainerTools(),
    ...createGoalTools(),
    ...createTaskTools({ spawn: deps.spawn }),
    ...createSkillTools({ skills: deps.skills ?? (async () => []) }),
    ...createWebTools(deps.web ?? { connection: async () => undefined, webSearchEnabled: () => false }),
    ...createNoteTools({ notes: deps.notes ?? (async () => undefined) })
  ];
}
