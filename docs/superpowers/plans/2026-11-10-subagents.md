# Sub-Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The model can delegate a piece of work to a sub-agent: the child runs its own conversation with MiniMax, its journal lands in the card of the call and its answer comes back as the result of the call.

**Architecture:** The tool `task` holds no key, no client and no registry, it only asks the host to start a child. The host builds a registry by the role of the child, gives it its own system prompt and its own history, and runs an `Agent` with the depth 1. The events of the child go into the card of the call through the new event `tool_progress`, the spend of the child counts against the goal of the session and its tokens land in the column of the action in the graph of the spend.

**Tech Stack:** TypeScript, VS Code extension API, React 18 in the webview, vitest, esbuild.

## Global Constraints

- The texts of the interface are English, the texts that go to the model are English, the documentation of the project is Russian.
- Never use the em dash (U+2014) in the texts of the project.
- The version lives in `package.json`, a new feature raises it by a minor: this plan ends at `0.12.0`.
- The commit message is a Conventional Commit in Russian, the files are staged with explicit paths: `git add -- <path>`, never `git add -A`.
- `npm run typecheck` and `npm test` have to be green before every commit.
- The working tree holds the changes of a parallel session (voice input, composer toolbar): `src/extension.ts`, `src/ui/protocol.ts`, `src/ui/webview/App.tsx`, `src/ui/webview/strings.ts`, `src/ui/webview/styles.css`, `package.json`, `AGENTS.md` and `test/unit/extension-activate.test.ts` are touched by it. Those changes must not land in the commits of this plan. Stage your own hunks only, with the helper:
  `python C:\jtmp\mm-stage.py --repo 'H:\personal_project\minimax-vscode' --file <file> --keep '<a text of your change>' --apply`
  The helper takes the hunks of the file that hold the given text and puts them into the index, the rest of the file stays in the working tree. Several `--keep` markers are allowed, each of them keeps the hunks that hold it. After the commit `git show --stat HEAD` has to show your own files and your own hunks only.
- `core.autocrlf=true`: the working copy is CRLF, the anchors of a multiline `tools.edit` have to contain `\r\n`. A single line anchor works always.
- Every class of the markup has a rule in the style sheet, a class without a rule is a dead end.
- The host is the only owner of the state of the session. A tool never changes the state itself, it returns a snapshot.
- The plan of the todolist and the plan of the goal have to be done before this one: this plan uses the types `TodoItem`, `GoalState`, `SessionState`, the event `usage` of the agent and the method `goalBudgetOk` of the host.
- The roles are set by the code. A sub-agent cannot start another sub-agent, the depth of the agent stops it.

---

### Task 1: The tool `task` and the contract of the child

**Files:**
- Create: `src/tools/task.ts`
- Modify: `src/tools/types.ts`
- Modify: `src/agent/agent.ts`
- Test: `test/unit/task-tool.test.ts`

**Interfaces:**
- Consumes: `ToolEntry` from `src/tools/types.ts`, the type `Usage` from `src/api/types.ts`.
- Produces: `TaskRole`, `TaskRequest`, `TaskOutcome`, `TaskOptions`, `CHILD_MAX_ITERATIONS` and `createTaskTools(options)` in `src/tools/task.ts`; `ToolContext.progress?`, `ToolContext.sessionId?`; `AgentEvent` gets the type `tool_progress`; `AgentOptions.sessionId?`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/task-tool.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTaskTools, type TaskOutcome } from '../../src/tools/task';
import type { ToolContext } from '../../src/tools/types';

function makeContext(over: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot: '/tmp/root',
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined },
    ...over
  };
}

describe('the tool of a sub-agent', () => {
  it('asks the host to start a child and returns its answer', async () => {
    const seen: string[] = [];
    const tools = createTaskTools({
      spawn: async (request) => {
        seen.push(request.role);
        return { content: 'The parser reads the file in src/app.ts.' };
      }
    });
    const task = tools.find((tool) => tool.name === 'task');
    const result = await task!.execute(
      { description: 'Find the parser', prompt: 'Where is the parser?', role: 'explore' },
      makeContext()
    );
    expect(seen).toEqual(['explore']);
    expect(result.content).toContain('src/app.ts');
    expect(result.isError).toBeUndefined();
  });

  it('takes the role explore when the model names none', async () => {
    let role = '';
    const tools = createTaskTools({
      spawn: async (request) => {
        role = request.role;
        return { content: 'done' };
      }
    });
    const task = tools.find((tool) => tool.name === 'task');
    await task!.execute({ description: 'Look', prompt: 'Look around' }, makeContext());
    expect(role).toBe('explore');
  });

  it('refuses an unknown role', async () => {
    const tools = createTaskTools({ spawn: async () => ({ content: 'done' }) });
    const task = tools.find((tool) => tool.name === 'task');
    const result = await task!.execute(
      { description: 'Look', prompt: 'Look around', role: 'chief' },
      makeContext()
    );
    expect(result.isError).toBe(true);
  });

  it('refuses the call of a sub-agent', async () => {
    let called = false;
    const tools = createTaskTools({
      spawn: async () => {
        called = true;
        return { content: 'done' };
      }
    });
    const task = tools.find((tool) => tool.name === 'task');
    const result = await task!.execute(
      { description: 'Look', prompt: 'Look around' },
      makeContext({ depth: 1 })
    );
    expect(result.isError).toBe(true);
    expect(called).toBe(false);
  });

  it('writes the journal of the child into the progress of the call', async () => {
    const lines: string[] = [];
    const tools = createTaskTools({
      spawn: async (_request, _ctx, progress) => {
        progress('read_file src/app.ts');
        return { content: 'done' };
      }
    });
    const task = tools.find((tool) => tool.name === 'task');
    await task!.execute(
      { description: 'Look', prompt: 'Look around' },
      makeContext({ progress: (line) => lines.push(line) })
    );
    expect(lines).toEqual(['read_file src/app.ts']);
  });

  it('gives the spend of the child back', async () => {
    const outcome: TaskOutcome = {
      content: 'done',
      usage: { inputTokens: 100, outputTokens: 20 }
    };
    const tools = createTaskTools({ spawn: async () => outcome });
    const task = tools.find((tool) => tool.name === 'task');
    const result = await task!.execute(
      { description: 'Look', prompt: 'Look around' },
      makeContext()
    );
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/task-tool.test.ts`

Expected: FAIL, the module `../../src/tools/task` does not exist.

- [ ] **Step 3: Let the tool write into the journal and know the session**

In `src/tools/types.ts` add the import:

```ts
import type { Usage } from '../api/types';
```

Add to `ToolContext`:

```ts
  // The journal of a long action, the tool writes the lines into it.
  progress?: (line: string) => void;
  // The id of the session that runs the tool.
  sessionId?: string;
```

Add to `ToolExecutionResult`:

```ts
  // The spend of the sub-agents inside the call, it belongs to the same
  // action of the graph of the spend.
  usage?: Usage;
```

- [ ] **Step 4: Write the tool**

Create `src/tools/task.ts`:

```ts
import type { Usage } from '../api/types';
import type { ToolContext, ToolEntry } from './types';

export type TaskRole = 'explore' | 'worker' | 'verifier';

const ROLES: TaskRole[] = ['explore', 'worker', 'verifier'];

// The child does not run forever, the turn of the parent is long enough
// on its own.
export const CHILD_MAX_ITERATIONS = 12;

export interface TaskRequest {
  description: string;
  prompt: string;
  role: TaskRole;
}

export interface TaskOutcome {
  content: string;
  isError?: boolean;
  // The spend of the child, it belongs to the action of the parent.
  usage?: Usage;
}

export interface TaskOptions {
  // The host starts the child, the tool only asks for it.
  spawn: (
    request: TaskRequest,
    ctx: ToolContext,
    progress: (line: string) => void
  ) => Promise<TaskOutcome>;
}

// The arguments of a tool as a short line for the journal of the card.
export function describeInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const value of Object.values(input)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      const text = value.trim();
      parts.push(text.length > 60 ? text.slice(0, 60) + '…' : text);
    }
  }
  return parts.join(' ');
}

export function createTaskTools(options: TaskOptions): ToolEntry[] {
  const task: ToolEntry = {
    name: 'task',
    description:
      'Start a sub-agent that works on its own and answers with a report. Use it for a piece of work that needs its own context: exploring the project, making a change or checking the work of somebody. The answer of the sub-agent is the result of this call. The role "explore" only reads, "worker" changes files, "verifier" checks the work.',
    approval: 'never',
    // The child can change files, the tool is not available in plan mode.
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'A short name of the task, one line.'
        },
        prompt: {
          type: 'string',
          description: 'The task for the sub-agent, with every detail it needs.'
        },
        role: {
          type: 'string',
          enum: ['explore', 'worker', 'verifier'],
          description:
            'What the sub-agent is allowed to do. "explore" reads, "worker" changes files, "verifier" checks the work.'
        }
      },
      required: ['description', 'prompt']
    },
    async execute(input, ctx) {
      // One level of sub-agents, the depth of the agent stops the rest.
      if ((ctx.depth ?? 0) > 0) {
        return {
          content: 'A sub-agent cannot start another sub-agent.',
          isError: true
        };
      }
      const description = String(input['description'] ?? '').trim();
      const prompt = String(input['prompt'] ?? '').trim();
      const role = String(input['role'] ?? 'explore');
      if (prompt.length === 0) {
        return {
          content: 'The task has no prompt, the sub-agent has nothing to do.',
          isError: true
        };
      }
      if (!ROLES.includes(role as TaskRole)) {
        return {
          content:
            'The role of the task is "explore", "worker" or "verifier", not "' +
            role +
            '".',
          isError: true
        };
      }
      const outcome = await options.spawn(
        { description, prompt, role: role as TaskRole },
        ctx,
        (line) => ctx.progress?.(line)
      );
      return {
        content: outcome.content,
        isError: outcome.isError === true,
        usage: outcome.usage
      };
    }
  };
  return [task];
}
```

- [ ] **Step 5: The agent sends the journal of the action and counts the spend of the child**

In `src/agent/agent.ts`:

Add the event:

```ts
  | { type: 'tool_progress'; id: string; line: string }
```

Add the options:

```ts
export interface AgentOptions {
  ...
  // The id of the session, the tools know who they work for.
  sessionId?: string;
  ...
}
```

Extend the call of the tool:

```ts
          const result = await entry.execute(toolUse.input, {
            workspaceRoot: this.options.workspaceRoot,
            signal: this.controller.signal,
            logger: this.options.logger,
            depth: this.options.depth,
            sessionId: this.options.sessionId,
            sessionState: this.options.sessionState,
            progress: (line) =>
              this.options.onEvent({ type: 'tool_progress', id: toolUse.id, line })
          });
          // The spend of the child belongs to the action of the parent, the
          // column of the graph of the spend holds the sum.
          if (result.usage) {
            usage = addUsage(usage, result.usage);
          }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/unit/task-tool.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 7: Run the types**

Run: `npm run typecheck`

Expected: no errors. The options `depth` and `sessionState` of the agent are already there from the plans of the todolist and of the goal, the new one is `sessionId`.

- [ ] **Step 8: Commit**

```bash
git add -- src/tools/task.ts src/tools/types.ts src/agent/agent.ts test/unit/task-tool.test.ts
git commit -m "feat(агенты): инструмент task и контракт под-агента"
```

---

### Task 2: The host starts the child

**Files:**
- Modify: `src/agent/session.ts`
- Modify: `src/extension.ts`
- Modify: `src/tools/goal.ts`
- Test: `test/unit/session.test.ts`
- Test: `test/unit/goal-tool.test.ts`

**Interfaces:**
- Consumes: `createTaskTools`, `TaskRole`, `TaskRequest`, `TaskOutcome` and `describeInput` from `src/tools/task.ts`.
- Produces: `AgentSession.approve(id, allowForSession): boolean` and `AgentSession.reject(id): boolean`; the host starts the child with the method `spawnTask`.

- [ ] **Step 1: Write the failing test**

Add to `test/unit/session.test.ts`:

```ts
  it('tells that nobody waits for an unknown approval', () => {
    const session = makeSession();
    expect(session.approve('nobody-waits', false)).toBe(false);
    expect(session.reject('nobody-waits')).toBe(false);
  });
```

(Use the helper of the file that builds a session, if the file builds one in another way, follow that way.)

Add to `test/unit/goal-tool.test.ts`:

```ts
  it('refuses the call of a sub-agent', async () => {
    const tools = createGoalTools();
    const update = tools.find((tool) => tool.name === 'update_goal');
    const result = await update!.execute(
      { status: 'complete' },
      makeContext(GOAL, 1)
    );
    expect(result.isError).toBe(true);
    expect(result.state).toBeUndefined();
  });
```

Change the helper of that file so it takes the depth:

```ts
function makeContext(goal?: GoalState, depth?: number): ToolContext {
  return {
    workspaceRoot: '/tmp/root',
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined },
    depth,
    sessionState: goal ? { todos: [], goal } : { todos: [] }
  };
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/session.test.ts test/unit/goal-tool.test.ts`

Expected: FAIL, `approve` returns nothing and the goal does not know the depth.

- [ ] **Step 3: The approval of a sub-agent is a separate one**

In `src/agent/session.ts`:

```ts
  approve(id: string, allowForSession: boolean): boolean {
    const resolve = this.pending.get(id);
    if (!resolve) {
      return false;
    }
    this.pending.delete(id);
    resolve({ approved: true, allowForSession });
    return true;
  }

  reject(id: string): boolean {
    const resolve = this.pending.get(id);
    if (!resolve) {
      return false;
    }
    this.pending.delete(id);
    resolve({ approved: false, allowForSession: false });
    return true;
  }
```

- [ ] **Step 4: The goal belongs to the main agent**

In `src/tools/goal.ts`, in the `execute` of `update_goal`, add the check before the check of the status:

```ts
      if ((ctx.depth ?? 0) > 0) {
        return {
          content: 'The status of the goal belongs to the main agent.',
          isError: true
        };
      }
```

- [ ] **Step 5: The host starts the child**

In `src/extension.ts`:

Add the imports:

```ts
import { Agent, type AgentEvent } from './agent/agent';
import type { ToolContext } from './tools/types';
import {
  CHILD_MAX_ITERATIONS,
  createTaskTools,
  describeInput,
  type TaskOutcome,
  type TaskRequest,
  type TaskRole
} from './tools/task';
import type { ApprovalDecision, ApprovalRequest } from './ui/approvals';
```

(merge them with the existing import of the approvals module if there is one)

Add the field to the controller:

```ts
  // The approvals of the sub-agents wait here, the id of the request of the
  // child starts with "child-".
  private readonly childApprovals = new Map<string, (decision: ApprovalDecision) => void>();
```

Register the tool in the constructor:

```ts
      ...createGoalTools(),
      ...createTaskTools({
        spawn: async (request, ctx, progress) =>
          await this.spawnTask(request, ctx, progress)
      })
```

Add the roles of the children:

```ts
const ROLE_PROMPTS: Record<TaskRole, string> = {
  explore:
    'You are a sub-agent of the main agent. Your task is to explore: you read the files and you search the project, you never change anything. Answer with a short report: what you found, the paths and the facts. Your answer is the result of the task, write it as plain text.',
  worker:
    'You are a sub-agent of the main agent. Your task is to make the change: you edit the files and you run the commands. Answer with a short report: what you changed and what you checked. Your answer is the result of the task, write it as plain text.',
  verifier:
    'You are a sub-agent of the main agent. Your task is to check the work: you read the files and the changes and you look for the defects. Answer with the list of the defects you found, or with the words that there are none. Your answer is the result of the task, write it as plain text.'
};
```

Put it next to the other constants of the module, above the class.

Add the methods to the controller:

```ts
  // The registry of a child: the role decides what it may do. A role that
  // only reads gets the tools without a side effect.
  private registryForRole(role: TaskRole): ToolRegistry {
    const registry = new ToolRegistry();
    for (const entry of this.registry.list()) {
      if (entry.name === 'task') {
        continue;
      }
      if (role === 'worker' || !entry.sideEffect) {
        registry.register(entry);
      }
    }
    return registry;
  }

  // The gate of a child is the gate of the session: a write of the child
  // asks the user too.
  private childApproval(): ApprovalGate {
    return new ApprovalGate({
      autoApprove: getSettings().autoApprove,
      request: async (request) => await this.requestChildApproval(request)
    });
  }

  private requestChildApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    const id = 'child-' + request.id;
    const approval: UiApproval = { id, name: request.toolName, input: request.input };
    return new Promise<ApprovalDecision>((resolve) => {
      this.childApprovals.set(id, resolve);
      this.panel.post({ type: 'approval_request', approval });
    });
  }

  // The events of the child: the spend goes to the counter of the goal,
  // the rest goes into the journal of the card of the call.
  private handleChildEvent(
    runtime: RuntimeSession,
    event: AgentEvent,
    progress: (line: string) => void
  ): void {
    if (event.type === 'usage') {
      this.handleAgentEvent(runtime, event);
      return;
    }
    if (event.type === 'tool_start') {
      progress(event.name + ' ' + describeInput(event.input));
      return;
    }
    if (event.type === 'tool_end') {
      progress(
        event.name + (event.isError ? ' failed' : ' done')
      );
      return;
    }
    if (event.type === 'assistant_text') {
      const text = event.text.trim();
      if (text.length > 0) {
        progress(text.length > 160 ? text.slice(0, 160) + '…' : text);
      }
      return;
    }
    if (event.type === 'error') {
      progress('error: ' + event.message);
    }
  }

  // The child runs on its own: its own history, its own system prompt, its
  // own registry. The answer of the child is the result of the call.
  private async spawnTask(
    request: TaskRequest,
    ctx: ToolContext,
    progress: (line: string) => void
  ): Promise<TaskOutcome> {
    const runtime = ctx.sessionId ? this.sessions.get(ctx.sessionId) : this.activeSession();
    if (!runtime) {
      return { content: 'There is no session for the sub-agent.', isError: true };
    }
    const key = await getApiKey(this.context.secrets);
    if (!key) {
      return { content: 'No API key, the sub-agent cannot run.', isError: true };
    }
    const settings = getSettings();
    const model = MODELS.find((item) => item.id === settings.model);
    const child = new Agent({
      client: new HttpMiniMaxClient({
        baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl),
        apiKey: key
      }),
      registry: this.registryForRole(request.role),
      approval: this.childApproval(),
      model: settings.model,
      maxTokens: model?.maxTokens ?? 65_536,
      maxIterations: CHILD_MAX_ITERATIONS,
      effort: settings.effort,
      thinking: this.thinkingMode(settings),
      mode: settings.mode,
      systemPrompt: (await this.buildPrompt()) + '\n\n' + ROLE_PROMPTS[request.role],
      workspaceRoot: this.workspaceRoot(),
      depth: 1,
      sessionId: runtime.id,
      sessionState: {
        get todos() {
          return runtime.todos;
        },
        get goal() {
          return runtime.goal;
        }
      },
      budget: () => this.goalBudgetOk(runtime),
      logger: this.logger,
      onEvent: (event) => this.handleChildEvent(runtime, event, progress)
    });
    const result = await child.run(request.prompt, []);
    const text = finalText(result.messages);
    if (text.length === 0) {
      return {
        content:
          'The sub-agent finished without an answer, it stopped with: ' + result.stopReason + '.',
        isError: true,
        usage: result.usage
      };
    }
    return { content: text, usage: result.usage };
  }
```

Add the helper that takes the answer of the child, at the end of the module:

```ts
// The answer of the child is the text of its last message.
function finalText(messages: AnthropicMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== 'assistant') {
      continue;
    }
    const parts = message.content.flatMap((block) =>
      block.type === 'text' ? [block.text] : []
    );
    const text = parts.join('\n').trim();
    if (text.length > 0) {
      return text;
    }
  }
  return '';
}
```

Route the approval of a child in the host, in `handleWebviewMessage`:

```ts
    if (message.type === 'approve') {
      const runtime = this.activeSession();
      const handled = runtime?.agent?.approve(message.id, message.allowForSession) ?? false;
      if (!handled) {
        const resolve = this.childApprovals.get(message.id);
        if (resolve) {
          this.childApprovals.delete(message.id);
          resolve({ approved: true, allowForSession: message.allowForSession });
        }
      }
      this.panel.post({ type: 'approval_resolved', id: message.id, approved: true });
      return;
    }
    if (message.type === 'reject') {
      const runtime = this.activeSession();
      const handled = runtime?.agent?.reject(message.id) ?? false;
      if (!handled) {
        const resolve = this.childApprovals.get(message.id);
        if (resolve) {
          this.childApprovals.delete(message.id);
          resolve({ approved: false, allowForSession: false });
        }
      }
      this.panel.post({ type: 'approval_resolved', id: message.id, approved: false });
      return;
    }
```

Add the id of the session to the agent of the session, in `ensureAgent`:

```ts
      sessionId: runtime.id,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/unit/session.test.ts test/unit/goal-tool.test.ts`

Expected: PASS.

- [ ] **Step 7: Run the types**

Run: `npm run typecheck`

Expected: no errors. The imports `Agent`, `AgentEvent`, `HttpMiniMaxClient`, `MODELS`, `resolveBaseUrl`, `getApiKey`, `getSettings` and `AnthropicMessage` are already in the module, add the ones that are missing.

- [ ] **Step 8: Commit**

```bash
python C:\jtmp\mm-stage.py --repo 'H:\personal_project\minimax-vscode' --file src/extension.ts --keep 'spawnTask' --keep 'childApprovals' --keep 'registryForRole' --apply
git add -- src/agent/session.ts src/tools/goal.ts test/unit/session.test.ts test/unit/goal-tool.test.ts
git commit -m "feat(агенты): подтверждения под-агента и роль в промпте"
```

The changes of `src/extension.ts` belong to the parallel session, stage only your own hunks.

---

### Task 3: The card of the sub-agent

**Files:**
- Modify: `src/ui/protocol.ts`
- Modify: `src/extension.ts`
- Modify: `src/ui/webview/App.tsx`
- Modify: `src/ui/webview/components/ToolCard.tsx`
- Create: `src/ui/webview/components/AgentView.tsx`
- Modify: `src/ui/webview/strings.ts`
- Modify: `src/ui/webview/styles.css`
- Test: `test/unit/tool-card.test.ts`

**Interfaces:**
- Consumes: the event `tool_progress` of the agent.
- Produces: the message `{ type: 'tool_progress'; id: string; line: string }` of `ExtToWeb`; `UiToolCall.progress?: string[]`; the component `AgentView({ progress, content })`.

- [ ] **Step 1: Write the failing test**

Add to `test/unit/tool-card.test.ts`:

```ts
describe('the card of a sub-agent', () => {
  it('names the task and shows the journal of the child', () => {
    const markup = renderToStaticMarkup(
      createElement(ToolCard, {
        tool: {
          id: 'call-1',
          name: 'task',
          input: { description: 'Find the parser', prompt: 'Where is it?', role: 'explore' },
          content: 'The parser is in src/app.ts.',
          progress: ['read_file src/app.ts', 'search_code parser 3 matches']
        },
        collapsed: false
      })
    );
    expect(markup).toContain('Find the parser');
    expect(markup).toContain('agent-log');
    expect(markup).toContain('read_file src/app.ts');
    expect(markup).toContain('The parser is in src/app.ts.');
  });
});
```

(Use the helper of the file if it renders the card in another way.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/tool-card.test.ts`

Expected: FAIL, the card knows nothing about the sub-agent.

- [ ] **Step 3: The protocol carries the journal**

In `src/ui/protocol.ts`:

Add to `UiToolCall`:

```ts
  // The journal of a long action, the sub-agent writes its lines here.
  progress?: string[];
```

Add to `ExtToWeb`:

```ts
  | { type: 'tool_progress'; id: string; line: string }
```

- [ ] **Step 4: The host keeps the journal and sends it**

In `src/extension.ts`, in `handleAgentEvent`, add the branch:

```ts
    if (event.type === 'tool_progress') {
      for (const message of runtime.uiMessages) {
        if (message.tool && message.tool.id === event.id) {
          message.tool.progress = [...(message.tool.progress ?? []), event.line];
        }
      }
      this.panel.post({ type: 'tool_progress', id: event.id, line: event.line });
      return;
    }
```

- [ ] **Step 5: The panel collects the journal**

In `src/ui/webview/App.tsx`, in the handler of the messages:

```tsx
      if (message.type === 'tool_progress') {
        setMessages((prev) =>
          prev.map((item) =>
            item.tool && item.tool.id === message.id
              ? {
                  ...item,
                  tool: {
                    ...item.tool,
                    progress: [...(item.tool.progress ?? []), message.line]
                  }
                }
              : item
          )
        );
        return;
      }
```

- [ ] **Step 6: The view of the sub-agent**

Create `src/ui/webview/components/AgentView.tsx`:

```tsx
import { renderMarkdown } from '../markdown';

// The card of a sub-agent: the journal of the child on the top, the
// answer of the child under it.
export function AgentView({
  progress,
  content
}: {
  progress: string[];
  content: string;
}) {
  return (
    <>
      {progress.length > 0 ? (
        <div className="agent-log">
          {progress.map((line, index) => (
            <div key={index} className="agent-log-line">
              {line}
            </div>
          ))}
        </div>
      ) : null}
      <div
        className="markdown agent-answer"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      />
    </>
  );
}
```

- [ ] **Step 7: The card of the tool**

In `src/ui/webview/components/ToolCard.tsx`:

Add the import:

```tsx
import { AgentView } from './AgentView';
```

Add the icon to the import of the icons: `IconModel`.

Add the branch of the description, before the last return of `describeTool`:

```ts
  if (tool.name === 'task') {
    const description = text(tool.input['description']);
    const role = text(tool.input['role']);
    return {
      icon: <IconModel />,
      title:
        STRINGS.toolTask +
        (description.length > 0 ? ' ' + description : '') +
        (role.length > 0 ? ' (' + role + ')' : ''),
      summary: firstLine(content)
    };
  }
```

Add the branch of the body, next to the branch of `run_terminal`:

```tsx
          ) : tool.name === 'task' ? (
            <AgentView progress={tool.progress ?? []} content={tool.content ?? ''} />
          ) : (
```

- [ ] **Step 8: The texts**

In `src/ui/webview/strings.ts`, add the key:

```ts
  toolTask: 'Task',
```

- [ ] **Step 9: The style of the card**

In `src/ui/webview/styles.css`, add the rules:

```css
/* the card of a sub-agent */
.agent-log {
  margin-bottom: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  background: var(--code-bg);
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--fs-sm);
}

.agent-log-line {
  white-space: pre-wrap;
  word-break: break-word;
}

.agent-answer {
  font-size: var(--fs-md);
}
```

The style sheet is checked by `test/unit/styleguide.test.ts`: the size of the font comes from the type scale (`var(--fs-xs)`, `var(--fs-sm)`, `var(--fs-md)`, `var(--fs-base)`), the corner from the tokens (`var(--radius-sm)`, `var(--radius)`), the spacing from the scale of the guide (0, 1, 2, 4, 6, 8, 12, 16, 24, 32), the colors from the theme (`var(--fg)`, `var(--muted)`, `var(--border)`, `var(--accent)`, `var(--ok)`, `var(--surface)`, `var(--code-bg)`, `var(--hover)`, `var(--bg)`), and the weight is 400 or 600.

- [ ] **Step 10: Run the test to verify it passes**

Run: `npx vitest run test/unit/tool-card.test.ts`

Expected: PASS.

- [ ] **Step 11: Run the whole suite and the types**

Run: `npm run typecheck && npm test`

Expected: green.

- [ ] **Step 12: Commit**

```bash
python C:\jtmp\mm-stage.py --repo 'H:\personal_project\minimax-vscode' --file src/extension.ts --keep "'tool_progress'" --apply
python C:\jtmp\mm-stage.py --repo 'H:\personal_project\minimax-vscode' --file src/ui/protocol.ts --keep "'tool_progress'" --apply
python C:\jtmp\mm-stage.py --repo 'H:\personal_project\minimax-vscode' --file src/ui/webview/App.tsx --keep "'tool_progress'" --apply
python C:\jtmp\mm-stage.py --repo 'H:\personal_project\minimax-vscode' --file src/ui/webview/styles.css --keep '.agent-log' --apply
python C:\jtmp\mm-stage.py --repo 'H:\personal_project\minimax-vscode' --file src/ui/webview/strings.ts --keep 'toolTask' --apply
git add -- src/ui/webview/components/AgentView.tsx src/ui/webview/components/ToolCard.tsx test/unit/tool-card.test.ts
git commit -m "feat(панель): карточка под-агента с журналом и ответом"
```

The changes of `src/extension.ts`, of `src/ui/webview/App.tsx` and of `src/ui/webview/styles.css` belong to the parallel session, stage only your own hunks.

---

### Task 4: The version and the documentation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `AGENTS.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything of the tasks above.
- Produces: the version `0.12.0` and the rules of the project.

- [ ] **Step 1: Raise the version**

In `package.json` change the line 5:

```json
  "version": "0.12.0",
```

In `package-lock.json` change the lines 3 and 9, the version of the root package. Do not touch the version of the dependency `xml2js`.

- [ ] **Step 2: Write the rule of the project**

Add to `AGENTS.md`:

```
- Под-агент это отдельный запуск агента: своя история, свой промпт (промпт родителя плюс роль), свой реестр инструментов по роли (`explore` читает, `worker` пишет, `verifier` проверяет) и тот же гейт подтверждений, запись файла ребёнком спрашивает пользователя. Глубина живёт в `ToolContext.depth`, инструмент `task` отказывает при `depth > 0`. События ребёнка идут в карточку вызова через `tool_progress`, финальный текст ребёнка это результат вызова, его токены идут в счёт сессии и в граф расхода.
```

- [ ] **Step 3: Tell the user in the readme**

Add a paragraph to the readme:

```
Модель может отдать часть работы под-агенту через инструмент `task`. У ребёнка своя
история и своя роль: `explore` только читает, `worker` вносит правки, `verifier` проверяет.
Журнал ребёнка виден в карточке вызова, его ответ возвращается в ход родителя.
```

- [ ] **Step 4: Run the whole suite**

Run: `npm run typecheck && npm test`

Expected: green.

- [ ] **Step 5: Commit**

```bash
python C:\jtmp\mm-stage.py --repo 'H:\personal_project\minimax-vscode' --file package.json --keep '"version": "0.12.0"' --apply
python C:\jtmp\mm-stage.py --repo 'H:\personal_project\minimax-vscode' --file AGENTS.md --keep 'под-агент' --apply
git add -- package-lock.json README.md
git commit -m "chore: версия расширения 0.12.0"
```

Stage only your own hunks in `package.json`, `AGENTS.md` and `README.md`, the parallel session touches them.

- [ ] **Step 6: Live check**

```bash
npm run package
code --install-extension 'H:\personal_project\minimax-vscode\minimax-agent-0.12.0.vsix' --force
```

Ask the model: "delegate the reading of the parser to a sub-agent and tell me what it found". The card of the call has to show the journal of the child and the answer, the answer has to come back into the turn of the parent. Ask it to delegate a change of a file: the approval of the child has to reach the panel, and the child has to stop when the user rejects it. Ask it to delegate from a sub-agent: the model has to get the refusal of the depth.

## Отклонения от плана

Реализация разошлась с планом в шести местах, все изменения приняты ревью:

1. `src/extension.ts`, `buildPrompt` принимает реестр инструментов (`buildPrompt(registry = this.registry)`): промпт ребёнка перечисляет инструменты ребёнка, а не родителя, иначе ребёнок видит в промпте инструмент `task`, которого у него нет.
2. `src/extension.ts`, `spawnTask` слушает `ctx.signal`: остановка родителя прерывает ребёнка, и ожидающие подтверждения ребёнка снимаются отказом. Без этого ход мог не завершиться никогда.
3. `src/extension.ts`, `requestChildApproval` строит превью изменения через `buildPreview`: читатель видит диф до одобрения. Сам диф ребёнка идёт в журнал вызова строками со знаками `+` и `-`.
4. `src/extension.ts`, разрешение на всю сессию живёт в runtime сессии, а не в контроллере: разрешение ребёнка не протекает в другой чат.
5. `src/agent/session.ts`, `stop()` отпускает ожидающие подтверждения родителя: ход, который ждёт одобрения, заканчивается по кнопке Stop.
6. `src/extension.ts` и `src/ui/webview/App.tsx`, строка журнала идёт в последнюю карточку с тем же id: сервер может повторить id вызова в следующем ходе. `src/storage/sessions.ts` ограничивает журнал при сохранении сессии (`MAX_STORED_PROGRESS_LINES`).
