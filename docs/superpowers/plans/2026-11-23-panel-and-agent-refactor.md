# Уплотнение панели и агента: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разобрать результат кампании резки на четыре узких места: логика цели, таблица описаний карточек, общий `text()` панели и опции агента; добавить автостраж предела в 400 строк, чтобы правило держалось само.

**Architecture:** Разделение идёт по границам ответственности, а не по размеру: чистая логика цели уходит из React-компонента в модуль `.ts`, таблица описаний (данные) отделяется от вида, значение аргумента получает одно общее место, а опции сессии наследуют опции агента вместо копии полей. Каждая задача — перенос без изменения поведения, с тестом, который падает до правки и проходит после.

**Tech Stack:** TypeScript 5 (strict, `noUnusedLocals`), React 19 (webview), Vitest 2 (jsdom нет, статическая разметка через `renderToStaticMarkup`), VS Code extension API, esbuild + vsce.

## Global Constraints

- Ни один файл в `src/` и `test/` не превышает 400 строк. Считать `(Get-Content $f).Count`: пустые строки тоже занимают место, а `Measure-Object -Line` их пропускает и занижает результат на 10-20 процентов.
- Файл длиннее предела режут по смыслу, а не переименовывают в другое имя.
- Старый путь импорта остаётся рабочим: публичный API расширения (инструменты, состояние панели, хранилище) доступен и по старым путям.
- Тексты интерфейса, описания инструментов, тексты, уходящие в модель, и комментарии в коде — английский. Документация проекта и коммиты — русский.
- 2 пробела, одинарные кавычки, точка с запятой в конце строки.
- `noUnusedLocals` и `noUnusedParameters` включены: неиспользуемый импорт или параметр ломает сборку.
- Версия поднимается по semver после каждого изменения: patch на правку без новой возможности.
- После каждого шага: `npm run typecheck` и тесты той области, что затронута; перед коммитом — весь `npm test`.
- Тест логики панели не тянет React-компонент: чистая логика живёт в `.ts` модулях, компоненты проверяются статической разметкой.

---

### Task 1: Стражин предела в 400 строк

**Files:**
- Create: `test/unit/file-size.test.ts`

**Interfaces:**
- Consumes: ничего, стражин работает по файловой системе.
- Produces: `npm test` падает, если любой файл `src/` или `test/` (ts, tsx, css) стал длиннее 400 строк. Остальные задачи полагаются на этот тест: он ловит нарушение предела раньше ревью.

- [ ] **Step 1: Написать тест**

```
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 400;
const ROOTS = ['src', 'test'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (/\.(ts|tsx|css)$/.test(path)) {
      out.push(path);
    }
  }
  return out;
}

// The empty lines count, the last line of a file without a newline does not.
function lineCount(path: string): number {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.length;
}

describe('the size of the files', () => {
  it('keeps every file of the project under the limit', () => {
    const tooBig: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const count = lineCount(file);
        if (count > LIMIT) {
          tooBig.push(file + ': ' + count);
        }
      }
    }
    expect(tooBig).toEqual([]);
  });
});
```

- [ ] **Step 2: Убедиться, что стражин ловит нарушение**

Создать временный файл `test/unit/size-probe.ts` с 401 строкой вида `export const probe0 = 0;` ... `export const probe400 = 0;` (имя на каждой строке своё, иначе TypeScript ругается на повтор), запустить тест, ожидаемый провал с сообщением о файле, потом удалить файл.

Run: `npx vitest run test/unit/file-size.test.ts`
Expected: FAIL, в списке нарушителей `test/unit/size-probe.ts: 401`

- [ ] **Step 3: Удалить временный файл и убедиться, что тест зелёный**

Run: `npx vitest run test/unit/file-size.test.ts`
Expected: PASS, 1 test

- [ ] **Step 4: Закоммитить**

```
git add test/unit/file-size.test.ts
git commit -m "test(проект): стражин предела в 400 строк"
```

---

### Task 2: Логика цели в отдельном модуле

**Files:**
- Create: `src/ui/webview/goalForm.ts`
- Modify: `src/ui/webview/components/GoalBar.tsx:35-115`
- Modify: `test/unit/goal-bar.test.ts:2-9`

**Interfaces:**
- Consumes: `GoalState` из `src/agent/state`, `GoalForm`, `DEFAULT_GOAL_FORM`, `parseLimit` из `src/ui/webview/goalWizard.ts`.
- Produces: `src/ui/webview/goalForm.ts` экспортирует `GoalValues`, `formatDuration(seconds: number): string`, `goalFormValues(goal: GoalState | undefined): GoalForm`, `parseGoalForm(form: GoalForm): { values?: GoalValues; error?: 'empty' | 'badLimit' }`, `goalMatches(values: GoalValues, goal: GoalState | undefined): boolean`. `GoalBar.tsx` реэкспортирует эти пять имён, старый путь импорта остаётся рабочим.

- [ ] **Step 1: Перевести тест на новый модуль**

В `test/unit/goal-bar.test.ts` оставить в импорте из компонента только `GoalBar`, а четыре функции взять из нового модуля:

```
import {
  GoalBar
} from '../../src/ui/webview/components/GoalBar';
import {
  formatDuration,
  goalFormValues,
  goalMatches,
  parseGoalForm
} from '../../src/ui/webview/goalForm';
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/unit/goal-bar.test.ts`
Expected: FAIL, ошибка разрешения модуля `src/ui/webview/goalForm`

- [ ] **Step 3: Создать модуль логики цели**

`src/ui/webview/goalForm.ts`:

```
import type { GoalState } from '../../agent/state';
import { DEFAULT_GOAL_FORM, parseLimit, type GoalForm } from './goalWizard';

export interface GoalValues {
  objective: string;
  tokenBudget?: number;
  requestLimit?: number;
  secondsLimit?: number;
}

// The time of the goal is written in minutes and seconds.
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes === 0) {
    return rest + 's';
  }
  if (rest === 0) {
    return minutes + 'm';
  }
  return minutes + 'm ' + rest + 's';
}

// The form is filled from the goal when it opens, a new goal starts from
// the defaults.
export function goalFormValues(goal: GoalState | undefined): GoalForm {
  if (!goal) {
    return { ...DEFAULT_GOAL_FORM };
  }
  return {
    objective: goal.objective,
    tokens: goal.tokenBudget === undefined ? '' : String(goal.tokenBudget),
    requests: goal.requestLimit === undefined ? '' : String(goal.requestLimit),
    minutes: goal.secondsLimit === undefined ? '' : String(Math.round(goal.secondsLimit / 60))
  };
}

export function parseGoalForm(form: GoalForm): {
  values?: GoalValues;
  error?: 'empty' | 'badLimit';
} {
  if (form.objective.trim().length === 0) {
    return { error: 'empty' };
  }
  const tokens = parseLimit(form.tokens);
  const requests = parseLimit(form.requests);
  const minutes = parseLimit(form.minutes);
  if (!tokens.ok || !requests.ok || !minutes.ok) {
    return { error: 'badLimit' };
  }
  return {
    values: {
      // The objective is one line, the textarea of the wizard may wrap it.
      objective: form.objective.replace(/\s+/g, ' ').trim(),
      tokenBudget: tokens.value,
      requestLimit: requests.value,
      secondsLimit: minutes.value === undefined ? undefined : minutes.value * 60
    }
  };
}

// The host confirms the goal, the values of the form and the goal of the
// session have to be the same.
export function goalMatches(values: GoalValues, goal: GoalState | undefined): boolean {
  if (!goal) {
    return false;
  }
  return (
    goal.objective === values.objective &&
    goal.tokenBudget === values.tokenBudget &&
    goal.requestLimit === values.requestLimit &&
    goal.secondsLimit === values.secondsLimit
  );
}
```

- [ ] **Step 4: Убрать логику из компонента**

В `src/ui/webview/components/GoalBar.tsx` удалить определения `GoalValues`, `formatDuration`, `goalFormValues`, `parseGoalForm`, `goalMatches` (строки 20-100) и добавить импорт и реэкспорт:

```
import {
  formatDuration,
  goalFormValues,
  goalMatches,
  parseGoalForm,
  type GoalValues
} from '../goalForm';

export {
  formatDuration,
  goalFormValues,
  goalMatches,
  parseGoalForm
} from '../goalForm';
export type { GoalValues } from '../goalForm';
```

- [ ] **Step 5: Проверить, что всё зелёное**

Run: `npm run typecheck` && `npx vitest run test/unit/goal-bar.test.ts test/unit/goal-wizard.test.ts`
Expected: PASS, тесты зелёные, ошибок типов нет

- [ ] **Step 6: Закоммитить**

```
git add src/ui/webview/goalForm.ts src/ui/webview/components/GoalBar.tsx test/unit/goal-bar.test.ts
git commit -m "refactor(панель): логика цели вынесена из компонента в модуль"
```

---

### Task 3: Таблица описаний карточек отдельно от вида

**Files:**
- Create: `src/ui/webview/components/toolDescriptions/table.tsx`
- Modify: `src/ui/webview/components/toolDescriptions.tsx` (строки 17-60 и 265-380)
- Modify: `test/unit/tool-describers.test.ts:4`

**Interfaces:**
- Consumes: `UiToolCall` из `src/ui/protocol`, `STRINGS`, `todoItems`, хелперы `countLines`, `filePaths`, `firstLine`, `readRange`, `text` из `./toolCardHelpers`, иконки из `../icons`.
- Produces: `src/ui/webview/components/toolDescriptions/table.tsx` экспортирует `ToolView`, `DescriberContext`, `Describer`, `DESCRIBERS` и `describerNames(): string[]`. `toolDescriptions.tsx` оставляет `describe(tool, folded)` и `describeTool(tool, folded)` и реэкспортирует `ToolView`.

- [ ] **Step 1: Перевести тест на новый модуль**

В `test/unit/tool-describers.test.ts` заменить импорт:

```
import { describerNames } from '../../src/ui/webview/components/toolDescriptions/table';
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/unit/tool-describers.test.ts`
Expected: FAIL, модуля `toolDescriptions/table` нет

- [ ] **Step 3: Создать модуль таблицы**

В `src/ui/webview/components/toolDescriptions/table.tsx` перенести без изменений: интерфейс `ToolView`, `DescriberContext`, тип `Describer`, константу `REPL_TITLES`, описатель `replDescriber`, функцию `describerNames()` и таблицу `DESCRIBERS` (284 строки). Импорты файла: `ReactNode`, `UiToolCall`, `STRINGS`, `todoItems`, хелперы и иконки — пути те же, но `iconPaths` не нужен.

- [ ] **Step 4: Оставить в файле только вид**

В `src/ui/webview/components/toolDescriptions.tsx` удалить таблицу и описатели, добавить:

```
import {
  DESCRIBERS,
  describerNames,
  type ToolView
} from './toolDescriptions/table';

export type { ToolView } from './toolDescriptions/table';
export { describerNames } from './toolDescriptions/table';
```

Функция `describeTool` больше не нужна наружу: убрать из неё слово `export` (её зовёт только `describe` в этом же файле).

- [ ] **Step 5: Проверить, что всё зелёное**

Run: `npm run typecheck` && `npx vitest run test/unit/tool-describers.test.ts test/unit/tool-card.test.ts test/unit/tool-card-body.test.ts`
Expected: PASS

- [ ] **Step 6: Закоммитить**

```
git add src/ui/webview/components/toolDescriptions src/ui/webview/components/toolDescriptions.tsx test/unit/tool-describers.test.ts
git commit -m "refactor(панель): таблица описаний карточек вынесена из вида"
```

---

### Task 4: Одно место для значения аргумента в панели

**Files:**
- Create: `src/ui/webview/value.ts`
- Modify: `src/ui/webview/components/toolCardHelpers.ts:20-28`
- Modify: `src/ui/webview/toolText.ts:3-13`
- Modify: `src/ui/webview/editDiff.ts:26-28`

**Interfaces:**
- Consumes: ничего.
- Produces: `src/ui/webview/value.ts` экспортирует `text(value: unknown): string` (строка как есть, `undefined` как пусто, остальное через `JSON.stringify`) и `textOrEmpty(value: unknown): string` (только строка, остальное пусто). Хелперы панели импортируют их оттуда.

- [ ] **Step 1: Создать общий модуль**

`src/ui/webview/value.ts`:

```
// The value of an argument of a tool is shown as a text: a string is itself,
// an object is a short json.
export function text(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return '';
  }
  return JSON.stringify(value);
}

// The value of a file is a string, everything else is nothing.
export function textOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
```

- [ ] **Step 2: Перевести три модуля на общий модуль**

`src/ui/webview/components/toolCardHelpers.ts`: удалить своё определение `text`, добавить `import { text } from '../value';` и `export { text };`.

`src/ui/webview/toolText.ts`: удалить своё определение `text` (строки 3-13), добавить `import { text } from './value';`.

`src/ui/webview/editDiff.ts`: заменить своё определение на `import { textOrEmpty } from './value';` и переименовать вызовы: было `text(value)` — стало `textOrEmpty(value)`. Внимание: в файле есть и другие вызовы с именем `text`, их трогать нельзя, только определение и его вызовы.

- [ ] **Step 3: Проверить, что всё зелёное**

Run: `npm run typecheck` && `npx vitest run test/unit/tool-text.test.ts test/unit/edit-diff.test.ts test/unit/tool-card.test.ts test/unit/tool-card-body.test.ts`
Expected: PASS

- [ ] **Step 4: Закоммитить**

```
git add src/ui/webview/value.ts src/ui/webview/components/toolCardHelpers.ts src/ui/webview/toolText.ts src/ui/webview/editDiff.ts
git commit -m "refactor(панель): значение аргумента читается из одного места"
```

---

### Task 5: Опции сессии наследуют опции агента

**Files:**
- Modify: `src/agent/types.ts:44-74`
- Modify: `src/agent/session.ts:13-33` и `src/agent/session.ts:120-140`
- Create: `test/unit/agent-session.test.ts`

**Interfaces:**
- Consumes: `AgentOptions` (текущий набор из 19 полей), `ApprovalGate` из `src/ui/approvals`.
- Produces: `src/agent/types.ts` экспортирует `AgentRunOptions` (18 общих полей без `approval`) и `AgentOptions extends AgentRunOptions` (добавляет только `approval`). `src/agent/session.ts` экспортирует `SessionOptions extends AgentRunOptions` (добавляет `contextWindow`, `historyLimit`, `contextThreshold`, `sessionApproved`, `contextProvider`, `autoApprove`, `onApproval`). Поле агента передаётся спредом, перечисления полей вручную больше нет.

- [ ] **Step 1: Написать тест на пересылку опций**

Сейчас путь `AgentSession -> Agent` не покрыт тестом вовсе, поэтому поле можно потерять молча. Создать `test/unit/agent-session.test.ts`:

```
import { describe, expect, it } from 'vitest';
import { AgentSession } from '../../src/agent/session';
import type { MiniMaxClient } from '../../src/api/client';
import type { ChatRequest, StreamEvent } from '../../src/api/types';
import { ToolRegistry } from '../../src/tools/registry';

function makeClient(): { client: MiniMaxClient; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  const client: MiniMaxClient = {
    async *stream(request: ChatRequest): AsyncGenerator<StreamEvent> {
      requests.push(request);
      yield {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
        blocks: []
      };
    }
  };
  return { client, requests };
}

describe('the session of the agent', () => {
  it('gives the agent the options of the session', async () => {
    const { client, requests } = makeClient();
    const session = new AgentSession({
      client,
      registry: new ToolRegistry(),
      model: 'MiniMax-M3.1-Flash',
      maxTokens: 32000,
      maxIterations: 3,
      maxRetries: 4,
      effort: 'max',
      mode: 'code',
      systemPrompt: 'the prompt of the session',
      workspaceRoot: '/tmp/root',
      historyLimit: 50,
      contextThreshold: 50,
      autoApprove: [],
      logger: { info: () => undefined, error: () => undefined },
      onEvent: () => undefined,
      onApproval: () => undefined,
      contextProvider: async () => 'REPOSITORY: branch main'
    });
    await session.send('the question');
    const request = requests[0];
    expect(request?.model).toBe('MiniMax-M3.1-Flash');
    expect(request?.maxTokens).toBe(32000);
    expect(request?.effort).toBe('max');
    // The state of the repository comes before the prompt of the session.
    expect(request?.system).toContain('the prompt of the session');
    expect(request?.system).toContain('REPOSITORY: branch main');
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает или что он вскрывает дыру**

Run: `npx vitest run test/unit/agent-session.test.ts`
Expected: PASS сразу, но тест закрывает путь, которого не покрывали: он падает, если из пересылки убрать любое поле (проверить вручную, закомментировав одну строку в `send()`, и вернуть её).

- [ ] **Step 3: Выделить общую часть опций**

В `src/agent/types.ts`:

```
export interface AgentRunOptions {
  client: MiniMaxClient;
  registry: ToolRegistry;
  model: string;
  maxTokens: number;
  maxIterations: number;
  // How many times a request is repeated after the loss of the connection.
  // Zero turns the repeats off.
  maxRetries?: number;
  // The first pause between the attempts. The pause grows from it. The
  // tests use a small base, a real turn waits a second.
  retryBaseDelayMs?: number;
  effort?: EffortLevel;
  thinking?: 'adaptive';
  mode: AgentMode;
  systemPrompt: string;
  workspaceRoot: string;
  // How deep the agent is. Undefined is the main agent.
  depth?: number;
  // The budget of the goal. The agent stops when the guard says no.
  budget?: () => boolean;
  // The state of the session, the tools read it.
  sessionState?: SessionState;
  // The id of the session, the tools know who they work for.
  sessionId?: string;
  logger: Logger;
  onEvent: (event: AgentEvent) => void;
}

export interface AgentOptions extends AgentRunOptions {
  approval: ApprovalGate;
}
```

Поле `approval` уходит из общего набора: у сессии своя калитка, она строит её сама.

- [ ] **Step 4: Переписать опции сессии и пересылку**

В `src/agent/session.ts`:

```
export interface SessionOptions extends AgentRunOptions {
  // The context window of the model, the history is cut to fit into it.
  contextWindow?: number;
  // How many messages the history keeps before the old turns are cut.
  historyLimit: number;
  // The share of the context window the history may take, in percent.
  contextThreshold: number;
  // The permissions of the session. The gate of the agent uses this list,
  // the gate of a child of this session shares it.
  sessionApproved?: Set<string>;
  // The state of the repository is read before every turn, the prompt of
  // the model carries the fresh one.
  contextProvider?: () => Promise<string>;
  autoApprove: string[];
  onApproval: (approval: UiApproval) => void;
}
```

В `send()` заменить перечисление полей:

```
    const run: AgentRunOptions = this.options;
    this.agent = new Agent({
      ...run,
      approval: this.approval,
      systemPrompt,
      onEvent: (event) => this.options.onEvent(event)
    });
```

Переменная `run` нужна для типов: без неё спред тащит лишние поля сессии, и TypeScript ругается на лишние свойства.

- [ ] **Step 5: Проверить, что всё зелёное**

Run: `npm run typecheck` && `npx vitest run test/unit/agent-session.test.ts test/unit/agent.test.ts test/unit/agent-retry.test.ts`
Expected: PASS

- [ ] **Step 6: Закоммитить**

```
git add src/agent/types.ts src/agent/session.ts test/unit/agent-session.test.ts
git commit -m "refactor(агент): опции сессии наследуют опции агента, пересылка спредом"
```

---

### Task 6: Настройки панели: одно поле, секции отдельно

**Files:**
- Create: `test/helpers/settingsFixture.ts`
- Create: `test/unit/settings-view.test.ts`
- Create: `src/ui/webview/components/settings/Field.tsx`
- Modify: `src/ui/webview/components/SettingsView.tsx`
- Modify: `test/visual/preview.tsx:129-153`

**Interfaces:**
- Consumes: `UiSettings`, `UiSettingsValues` из `src/ui/protocol`, `STRINGS`.
- Produces: `test/helpers/settingsFixture.ts` экспортирует `SETTINGS: UiSettings` (объект, который сегодня лежит в стенде) и `MODELS`. `src/ui/webview/components/settings/Field.tsx` экспортирует `Field({ label, hint, children })` — подпись, подсказка и control в блоке `label.field`.

- [ ] **Step 1: Вынести фикстуру настроек и покрыть вид настроек тестом**

У `SettingsView` нет ни одного теста, а правка идёт в разметку: сначала страховка.

Вынести объект `SETTINGS` из `test/visual/preview.tsx` в `test/helpers/settingsFixture.ts` (вместе с `MODELS`, если он там тоже есть) и импортировать его в стенде обратно.

Создать `test/unit/settings-view.test.ts`:

```
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsView } from '../../src/ui/webview/components/SettingsView';
import { SETTINGS } from '../helpers/settingsFixture';

function markup(): string {
  return renderToStaticMarkup(
    createElement(SettingsView, {
      settings: SETTINGS,
      onSave: () => undefined,
      onSetApiKey: () => undefined,
      onClearApiKey: () => undefined
    })
  );
}

describe('the settings of the panel', () => {
  it('names every section of the settings', () => {
    const html = markup();
    for (const className of [
      'settings-section',
      'settings-row',
      'field',
      'hint'
    ]) {
      expect(html).toContain(className);
    }
  });

  it('shows the model and the endpoint of the panel', () => {
    const html = markup();
    expect(html).toContain('MiniMax');
    expect(html).toContain('api.minimax.io');
  });
});
```

Run: `npx vitest run test/unit/settings-view.test.ts`
Expected: PASS, разметка настроек покрыта

- [ ] **Step 2: Сделать компонент поля**

`src/ui/webview/components/settings/Field.tsx`:

```
import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

// The field of the settings: a name, the control and the hint under it.
// The markup of eleven полей was the same, the component keeps them alike.
export function Field({ label, hint, children }: FieldProps): ReactNode {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}
```

- [ ] **Step 3: Перевести одиннадцать полей на компонент**

В `src/ui/webview/components/SettingsView.tsx` заменить одиннадцать блоков

```
<label className="field">
  <span>{STRINGS.customBaseUrl}</span>
  <input
    type="text"
    value={values.customBaseUrl}
    placeholder="https://api.minimax.io/anthropic"
    onChange={(event) => patch({ customBaseUrl: event.target.value })}
  />
  <span className="hint">{STRINGS.customBaseUrlHint}</span>
</label>

на

<Field label={STRINGS.customBaseUrl} hint={STRINGS.customBaseUrlHint}>
  <input
    type="text"
    value={values.customBaseUrl}
    placeholder="https://api.minimax.io/anthropic"
    onChange={(event) => patch({ customBaseUrl: event.target.value })}
  />
</Field>
```

на

```
<Field label={STRINGS.customBaseUrl} hint={STRINGS.customBaseUrlHint}>
  <input
    type="text"
    value={values.customBaseUrl}
    placeholder="https://api.minimax.io/anthropic"
    onChange={(event) => patch({ customBaseUrl: event.target.value })}
  />
</Field>
```

Подсказку, которой нет, не передавать: компонент сам не рисует пустой блок.

- [ ] **Step 4: Проверить, что всё зелёное**

Run: `npm run typecheck` && `npx vitest run test/unit/settings-view.test.ts test/unit/styleguide.test.ts`
Expected: PASS. Проверить руками в стенде: `npm run preview`, вкладка Settings.

- [ ] **Step 5: Вынести две крупнейшие секции**

Секции `148-204` (модель, рассуждение, режим) и `221-274` (автоодобрение) унести в `src/ui/webview/components/settings/ModelSection.tsx` и `src/ui/webview/components/settings/AutoApproveSection.tsx`. Каждая секция получает свои значения и обработчик изменения, разметка переносится без изменений.

- [ ] **Step 6: Проверить, что всё зелёное**

Run: `npm run typecheck` && `npx vitest run test/unit/settings-view.test.ts`
Expected: PASS

- [ ] **Step 7: Закоммитить**

```
git add src/ui/webview/components/settings src/ui/webview/components/SettingsView.tsx test/helpers/settingsFixture.ts test/unit/settings-view.test.ts test/visual/preview.tsx
git commit -m "refactor(панель): поля и секции настроек вынесены из вида"
```

---

### Task 7: Логика карточки действия в одном модуле (по желанию)

**Files:**
- Create: `src/ui/webview/toolCard.ts`
- Delete: `src/ui/webview/toolCardState.ts`, `src/ui/webview/toolEnd.ts`, `src/ui/webview/toolSteps.ts`, `src/ui/webview/toolText.ts`
- Modify: импортёры: `src/ui/webview/components/ToolCard.tsx`, `src/ui/webview/components/ApprovalCard.tsx`, `src/ui/webview/components/ToolSteps.tsx`, `src/ui/webview/components/MessageList.tsx`, `src/ui/webview/usePanelMessages.ts`, `src/ui/webview/strings.ts`
- Modify: `AGENTS.md` (формулировка про реэкспорт)

**Interfaces:**
- Consumes: `UiMessage` из `../protocol`, `STRINGS`.
- Produces: `src/ui/webview/toolCard.ts` экспортирует `cardOpen`, `endTool`, `ToolStep`, `FeedItem`, `groupToolSteps`, `formatInput`, `approvalTitle` — те же имена и подписи, что были в четырёх модулях.

- [ ] **Step 1: Решить, нужны ли старые пути**

Шимы на старых путях дали бы пять файлов вместо четырёх, а импортируют эти модули только шесть файлов репозитория, наружу их никто не берёт. Поэтому шами не делаем: импортёры переставляем на новый путь, а в `AGENTS.md` уточняем, что обязательный реэкспорт касается публичного API расширения (инструменты, состояние панели, хранилище), а не внутренних модулей панели.

- [ ] **Step 2: Создать единый модуль**

`src/ui/webview/toolCard.ts`: содержимое четырёх модулей без изменений, в порядке: типы (`ToolStep`, `FeedItem`), `cardOpen`, `endTool`, `groupToolSteps`, `formatInput`, `approvalTitle`. Импорты те же, что были: `import type { UiMessage } from '../protocol';`, `import { STRINGS } from './strings';`.

- [ ] **Step 3: Переставить шесть импортёров**

В `src/ui/webview/components/*.tsx` путь становится `'../toolCard'`, в `src/ui/webview/usePanelMessages.ts` и `src/ui/webview/strings.ts` — `'./toolCard'`.

- [ ] **Step 4: Удалить четыре старых файла**

```
git rm src/ui/webview/toolCardState.ts src/ui/webview/toolEnd.ts src/ui/webview/toolSteps.ts src/ui/webview/toolText.ts
```

- [ ] **Step 5: Проверить, что всё зелёное**

Run: `npm run typecheck` && `npx vitest run test/unit/tool-card-state.test.ts test/unit/tool-end.test.ts test/unit/tool-steps.test.ts test/unit/tool-text.test.ts test/unit/tool-card.test.ts test/unit/message-list.test.ts`
Expected: PASS

- [ ] **Step 6: Закоммитить**

```
git add src/ui/webview/toolCard.ts src/ui/webview/components src/ui/webview/usePanelMessages.ts src/ui/webview/strings.ts AGENTS.md
git commit -m "refactor(панель): логика карточки действия собрана в один модуль"
```

---

### Task 8: Правила, версия и релиз

**Files:**
- Modify: `AGENTS.md`
- Modify: `package.json` (версия), `README.md` (версия в команде установки)
- Create (в репозитории): `scripts/test-split/dup-scan.mjs`, `scripts/test-split/helper-usage.mjs`, `scripts/test-split/shim-usage.mjs` (сейчас не закоммичены)

**Interfaces:**
- Consumes: всё, что сделано в задачах 1-7.
- Produces: правило предела в 400 строк проверяется тестом, структура панели описана в `AGENTS.md`, собран и установлен `minimax-agent-0.15.13.vsix`.

- [ ] **Step 1: Обновить правила проекта**

В `AGENTS.md` дописать:

- предел в 400 строк проверяется тестом `test/unit/file-size.test.ts`, файл длиннее предела это дефект;
- логика цели живёт в `src/ui/webview/goalForm.ts`, шаги мастера — в `src/ui/webview/goalWizard.ts`; React-компонент только рисует;
- таблица описаний карточек — в `src/ui/webview/components/toolDescriptions/table.tsx`, вид — в `toolDescriptions.tsx`;
- значение аргумента читается из `src/ui/webview/value.ts`;
- опции сессии наследуют опции агента (`AgentRunOptions` в `src/agent/types.ts`), пересылка спредом, тест `test/unit/agent-session.test.ts`;
- список инструментов расширения собирается в `src/tools/all.ts`.

- [ ] **Step 2: Поднять версию**

```
package.json:  "version": "0.15.12"  ->  "version": "0.15.13"
README.md:     minimax-agent-0.15.12.vsix  ->  minimax-agent-0.15.13.vsix
```

Изменение правит поведение, поэтому patch.

- [ ] **Step 3: Полный прогон**

Run: `npm run typecheck` && `npm test`
Expected: ошибок нет, все тесты зелёные, стражин предела молчит

- [ ] **Step 4: Собрать и поставить**

```
npm run package
code --install-extension minimax-agent-0.15.13.vsix --force
```

- [ ] **Step 5: Проверить вживую**

Окно VS Code перезагрузить (палитра команд, `Reload Window`), затем через CDP прочитать панель:

```
$env:CDP_PORT='9333'; node scripts/live-check/cdp.mjs eval minimax-agent "(() => { const d = frames[0].document; return d.body.innerText.slice(0, 200); })()"
```

Expected: в первой строке бейдж `v0.15.13`, вкладка Settings открывается и рисует разделы, история чата на месте.

- [ ] **Step 6: Закоммитить**

```
git add -A
git commit -m "chore: версия расширения 0.15.13 и правила предела в AGENTS.md"
```

---

## Порядок и почему такой

1. **Task 1** идёт первым: стражин предела закрывает все следующие задачи, иначе перенос может снова развести файл за 400 строк.
2. **Task 2** (логика цели) — самый дешёвый и самый заметный: файл у предела (380) получает 60 строк воздуха, а тест перестаёт тянуть React.
3. **Task 3** (таблица) снимает 284 строки из файла у предела и даёт таблице место; новый инструмент больше не правкует файл на грани.
4. **Task 4** (значение аргумента) — маленькая правка, убирающая копипаст, делается после крупных переносов, чтобы не смешивать.
5. **Task 5** (опции агента) — единственная задача с настоящим риском: путь `сессия -> агент` не был покрыт тестом, поэтому сначала тест, потом смена типа.
6. **Task 6** (настройки) — самый большой кусок разметки без покрытия, поэтому сначала фикстура и тест, потом компонент поля, потом секции.
7. **Task 7** (модуль карточки) — по желанию: выигрыш умеренный, а правило реэкспорта приходится уточнять.
8. **Task 8** — правила, версия и релиз.

Файлы, которые после задач остаются у предела (`extension.ts` 373, `project/class.ts` 372, `git/read.ts` 375, `git/write.ts` 350, `containers.ts` 347, `usePanelMessages.ts` 345, `Composer.tsx` 361, `App.tsx` 353), не трогаются заранее: стражин из задачи 1 скажет о них в момент правки, а не заранее.
