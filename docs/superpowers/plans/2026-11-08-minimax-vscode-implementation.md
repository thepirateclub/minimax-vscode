
# MiniMax Agent for VS Code - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширение VS Code с агентом на API MiniMax: чат в сайдбаре, собственный агентный цикл, инструменты работы с файлами, поиском по проекту и терминалом.

**Architecture:** Агентный цикл живёт в extension host, webview только рендерит типизированные события. Слой `src/api/` говорит с MiniMax по Anthropic-совместимому протоколу через собственный fetch-клиент с парсером SSE, слой `src/tools/` выполняет инструменты под гейтом подтверждения, слой `src/agent/` связывает их в цикл, слой `src/ui/` раздаёт события в React-панель.

**Tech Stack:** TypeScript 5 (strict), Node 20+, VS Code Extension API (`engines.vscode` >= 1.90.0), React 18 + markdown-it в webview, esbuild (два бандла), vitest.

## Global Constraints

- Эндпоинт по умолчанию: `https://api.minimax.io/anthropic/v1/messages`; China: `https://api.minimaxi.com/anthropic/v1/messages`
- Авторизация: заголовок `Authorization: Bearer <key>`, НЕ `x-api-key`
- Модели: `MiniMax-M3.1-Flash` (1M ctx), `MiniMax-M3` (1M ctx)
- `max_tokens` включает thinking-токены: по умолчанию 32000, диапазон настройки 4096-65536
- `temperature` сервером игнорируется, в UI не показывается
- `output_config.effort` отправляется только для `MiniMax-M3.1-Flash`: `low`, `medium`, `high`, `xhigh`, `max`
- `thinking: {type: "disabled"}` не отправляется для `MiniMax-M3.1-Flash` (сервер вернёт 400); для `MiniMax-M3` thinking по умолчанию выключен
- `tool_choice` не используется (сервер поддерживает только `auto`)
- `cache_control` не используется (сервер не поддерживает)
- Полный `content` предыдущего ответа ассистента возвращается в следующий запрос без изменений
- Ошибки MiniMax: 2049 неверный ключ, 2057 ключ не от M Plan, 2061 модель не в тарифе, 2062 лимит M Plan, 2066 перегрузка
- Тексты интерфейса: английский. Тексты, уходящие в модель: английский. Документация и коммиты: русский
- API-ключ только в `context.secrets`, никогда не в settings, логах и webview
- Пути инструментов разрешаются относительно корня workspace, выход за пределы запрещён
- Стиль: 2 пробела, одинарные кавычки, точка с запятой, strict TypeScript без `any`
- Тесты: `npm test` (vitest). Live: `npm run test:live` с `MINIMAX_API_KEY` из `.env.local`
- Коммит только своих файлов: `git add -- <явные пути>`, никогда `git add -A`

## File Structure

```
src/
├── extension.ts              activate/deactivate, регистрация панели, команд, статус-бара
├── logger.ts                 OutputChannel-логгер с редактированием секретов
├── config/
│   ├── settings.ts           типизированный доступ к minimax.*
│   ├── secrets.ts            API-ключ в context.secrets + fallback на env
│   └── models.ts             каталог моделей, effort-уровни, per-model дефолты
├── api/
│   ├── types.ts              Anthropic-совместимые типы и StreamEvent
│   ├── sse.ts                парсер text/event-stream
│   ├── client.ts             MiniMaxClient поверх fetch
│   └── errors.ts             маппинг HTTP-кодов MiniMax в понятные ошибки
├── agent/
│   ├── agent.ts              цикл: запрос -> tool_use -> execute -> повтор
│   ├── prompt.ts             сборка system prompt
│   └── context.ts            контекст: правила проекта, снимок репо, открытые файлы
├── tools/
│   ├── registry.ts           реестр: имя, схема, исполнитель, политика подтверждения
│   ├── fs.ts                 read_file, write_file, edit_file
│   ├── explore.ts            list_files, search_code
│   ├── terminal.ts           run_terminal
│   └── diff.ts               построчный unified diff
├── ui/
│   ├── protocol.ts           контракт extension <-> webview
│   ├── panel.ts              WebviewViewProvider
│   ├── approvals.ts          promise-гейт подтверждения
│   ├── statusbar.ts          индикатор состояния и счётчик токенов
│   └── webview/              React-панель: App, компоненты, стили, строки
├── storage/
│   └── sessions.ts           JSON-сессии в globalStorage
test/
├── unit/                     sse, client, diff, tools, agent, context
├── integration/              локальный SSE-сервер + настоящий клиент
└── live/                     один реальный запрос к MiniMax
```

---

### Task 1: Каркас расширения

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.mjs`, `vitest.config.ts`
- Create: `src/extension.ts`, `src/logger.ts`
- Create: `src/ui/statusbar.ts`, `src/ui/webview/index.html`, `src/ui/webview/main.tsx`
- Test: `test/unit/extension.test.ts`

**Interfaces:**
- Produces: `activate(context: vscode.ExtensionContext): void`, `deactivate(): void`, `createLogger(channel: vscode.OutputChannel): Logger`
- Produces: `Logger = { info(msg: string): void; error(msg: string, err?: unknown): void; redact(text: string): string }`
- Produces: `StatusBarController` с `setState(state: AgentState, tokens?: number): void`

- [x] **Step 1: Создать `package.json`**

```json
{
  "name": "minimax-agent",
  "displayName": "MiniMax Agent",
  "description": "Coding agent for VS Code powered by MiniMax models",
  "version": "0.1.0",
  "publisher": "local",
  "license": "MIT",
  "engines": { "vscode": "^1.90.0" },
  "main": "./dist/extension.js",
  "categories": ["AI", "Programming Languages", "Other"],
  "activationEvents": [],
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        { "id": "minimax", "title": "MiniMax", "icon": "media/icon.svg" }
      ]
    },
    "views": {
      "minimax": [
        { "id": "minimax.chat", "name": "Agent", "type": "webview" }
      ]
    },
    "commands": [
      { "command": "minimax.openPanel", "title": "MiniMax: Open Panel", "category": "MiniMax" },
      { "command": "minimax.newChat", "title": "MiniMax: New Chat", "category": "MiniMax" },
      { "command": "minimax.addApiKey", "title": "MiniMax: Add API Key", "category": "MiniMax" },
      { "command": "minimax.setEndpoint", "title": "MiniMax: Set Endpoint", "category": "MiniMax" },
      { "command": "minimax.selectModel", "title": "MiniMax: Select Model", "category": "MiniMax" },
      { "command": "minimax.setEffort", "title": "MiniMax: Set Thinking Effort", "category": "MiniMax" },
      { "command": "minimax.undoLastChange", "title": "MiniMax: Undo Last File Change", "category": "MiniMax" },
      { "command": "minimax.refreshContext", "title": "MiniMax: Refresh Workspace Context", "category": "MiniMax" },
      { "command": "minimax.showLogs", "title": "MiniMax: Show Logs", "category": "MiniMax" },
      { "command": "minimax.clearApiKey", "title": "MiniMax: Clear API Key", "category": "MiniMax" }
    ],
    "configuration": {
      "title": "MiniMax",
      "properties": {
        "minimax.baseUrl": {
          "type": "string",
          "default": "auto",
          "enum": ["auto", "global", "china"],
          "description": "API region or a full base URL. auto resolves to global unless the key looks Chinese."
        },
        "minimax.model": { "type": "string", "default": "MiniMax-M3.1-Flash" },
        "minimax.effort": {
          "type": "string",
          "default": "max",
          "enum": ["low", "medium", "high", "xhigh", "max"]
        },
        "minimax.maxTokens": { "type": "number", "default": 32000, "minimum": 4096, "maximum": 65536 },
        "minimax.maxIterations": { "type": "number", "default": 40, "minimum": 1, "maximum": 200 },
        "minimax.autoApprove": {
          "type": "array",
          "items": { "type": "string" },
          "default": [],
          "description": "Tool names approved without confirmation for the whole session."
        },
        "minimax.enableWebSearch": { "type": "boolean", "default": false },
        "minimax.rulesEnabled": { "type": "boolean", "default": true }
      }
    }
  },
  "scripts": {
    "compile": "node esbuild.mjs",
    "watch": "node esbuild.mjs --watch",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:live": "vitest run test/live",
    "package": "npm run compile && vsce package"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/vscode": "^1.90.0",
    "@vitejs/plugin-react": "^4.3.0",
    "@vscode/vsce": "^3.0.0",
    "esbuild": "^0.23.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  },
  "dependencies": {
    "markdown-it": "^14.1.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  }
}
```

- [x] **Step 2: Создать `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "out",
    "types": ["node", "vscode"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts"],
  "exclude": ["node_modules", "dist", "out"]
}
```

- [x] **Step 3: Создать `esbuild.mjs`**

```javascript
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info'
};

const webviewConfig = {
  entryPoints: ['src/ui/webview/main.tsx'],
  bundle: true,
  outfile: 'dist/webview/main.js',
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  sourcemap: !production,
  minify: production,
  loader: { '.css': 'text' },
  define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
  logLevel: 'info'
};

if (watch) {
  await Promise.all([
    esbuild.context(extensionConfig).then((ctx) => ctx.watch()),
    esbuild.context(webviewConfig).then((ctx) => ctx.watch())
  ]);
  console.log('watching...');
} else {
  await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
}
```

- [x] **Step 4: Создать `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000
  }
});
```

- [x] **Step 5: Написать падающий тест `test/unit/extension.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../../src/logger';

describe('redactSecrets', () => {
  it('masks bearer tokens in logs', () => {
    const text = 'Authorization: Bearer sk-abcdef123456';
    expect(redactSecrets(text)).not.toContain('sk-abcdef123456');
    expect(redactSecrets(text)).toContain('Bearer ***');
  });

  it('masks query string tokens', () => {
    expect(redactSecrets('https://api.minimax.io/v1?key=secret-value')).not.toContain('secret-value');
  });
});
```

- [x] **Step 6: Запустить тест, убедиться в падении**

Run: `npm test`
Expected: FAIL, модуль `src/logger` не найден.

- [x] **Step 7: Реализовать `src/logger.ts`**

```typescript
export interface Logger {
  info(message: string): void;
  error(message: string, err?: unknown): void;
}

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /([?&](?:key|api_key|apikey|token)=)[^&\s]+/gi,
  /(sk-[A-Za-z0-9]{8,})/g
];

export function redactSecrets(text: string): string {
  let out = text;
  out = out.replace(SECRET_PATTERNS[0]!, 'Bearer ***');
  out = out.replace(SECRET_PATTERNS[1]!, '$1***');
  out = out.replace(SECRET_PATTERNS[2]!, 'sk-***');
  return out;
}

export function createLogger(channel: { appendLine(value: string): void }): Logger {
  return {
    info(message: string): void {
      channel.appendLine(redactSecrets(message));
    },
    error(message: string, err?: unknown): void {
      channel.appendLine(redactSecrets('[error] ' + message));
      if (err !== undefined) {
        const text = err instanceof Error ? err.stack ?? err.message : String(err);
        channel.appendLine(redactSecrets(text));
      }
    }
  };
}
```

- [x] **Step 8: Реализовать `src/extension.ts`, `src/ui/statusbar.ts` и webview-заготовку**

`src/extension.ts`:

```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('MiniMax');
  context.subscriptions.push(channel);
  context.subscriptions.push(
    vscode.commands.registerCommand('minimax.openPanel', async () => {
      await vscode.commands.executeCommand('minimax.chat.focus');
    })
  );
  for (const id of [
    'minimax.newChat',
    'minimax.addApiKey',
    'minimax.setEndpoint',
    'minimax.selectModel',
    'minimax.setEffort',
    'minimax.undoLastChange',
    'minimax.refreshContext',
    'minimax.showLogs',
    'minimax.clearApiKey'
  ]) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        channel.appendLine('command not wired yet: ' + id);
      })
    );
  }
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('minimax.chat', {
      resolveWebviewView(view) {
        view.webview.html = '<!doctype html><html><body><div id="root"></div></body></html>';
      }
    })
  );
}

export function deactivate(): void {
  void 0;
}
```

`src/ui/statusbar.ts`:

```typescript
import * as vscode from 'vscode';

export type AgentState = 'idle' | 'thinking' | 'streaming' | 'tool' | 'error';

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'minimax.openPanel';
    this.setState('idle');
  }

  setState(state: AgentState, tokens?: number): void {
    const labels: Record<AgentState, string> = {
      idle: '$(sparkle) MiniMax',
      thinking: '$(sync~spin) MiniMax thinking',
      streaming: '$(sync~spin) MiniMax streaming',
      tool: '$(tools) MiniMax running tool',
      error: '$(error) MiniMax error'
    };
    this.item.text = tokens === undefined ? labels[state] : labels[state] + ' (' + tokens + ')';
    this.item.tooltip = 'MiniMax Agent';
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
```

- [x] **Step 9: Поставить зависимости и убедиться, что сборка проходит**

Run: `npm install`, затем `npm run compile`
Expected: обе сборки esbuild успешны, `dist/extension.js` и `dist/webview/main.js` созданы.

- [x] **Step 10: Прогнать тесты и закоммитить**

Run: `npm test`
Expected: PASS.

```bash
git add -- package.json tsconfig.json esbuild.mjs vitest.config.ts src/extension.ts src/logger.ts src/ui/statusbar.ts src/ui/webview/index.html src/ui/webview/main.tsx test/unit/extension.test.ts
git commit -m "feat: каркас расширения, сборка и логгер с редактированием секретов"
```

---

### Task 2: Настройки, секреты и каталог моделей

**Files:**
- Create: `src/config/settings.ts`, `src/config/secrets.ts`, `src/config/models.ts`
- Test: `test/unit/config.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 except Logger
- Produces:
  - `type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'`
  - `type BaseUrlPreset = 'auto' | 'global' | 'china'`
  - `interface ModelInfo { id: string; label: string; supportsEffort: boolean; thinkingAlwaysOn: boolean; contextWindow: number }`
  - `MODELS: ModelInfo[]`
  - `resolveBaseUrl(preset: BaseUrlPreset, custom?: string): string`
  - `getSettings(): MiniMaxSettings`, `onSettingsChanged(cb: (s: MiniMaxSettings) => void): Disposable`
  - `getApiKey(): Promise<string | undefined>`, `setApiKey(key: string): Promise<void>`, `clearApiKey(): Promise<void>`
  - `interface MiniMaxSettings { baseUrl: BaseUrlPreset; customBaseUrl: string; model: string; effort: EffortLevel; maxTokens: number; maxIterations: number; autoApprove: string[]; enableWebSearch: boolean; rulesEnabled: boolean }`

- [x] **Step 1: Написать падающий тест `test/unit/config.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { MODELS, resolveBaseUrl } from '../../src/config/models';

describe('resolveBaseUrl', () => {
  it('resolves global preset', () => {
    expect(resolveBaseUrl('global')).toBe('https://api.minimax.io/anthropic');
  });

  it('resolves china preset', () => {
    expect(resolveBaseUrl('china')).toBe('https://api.minimaxi.com/anthropic');
  });

  it('prefers a custom url', () => {
    expect(resolveBaseUrl('auto', 'https://example.test/anthropic')).toBe('https://example.test/anthropic');
  });

  it('falls back to global for auto', () => {
    expect(resolveBaseUrl('auto')).toBe('https://api.minimax.io/anthropic');
  });
});

describe('MODELS', () => {
  it('exposes both flagship models', () => {
    expect(MODELS.map((m) => m.id)).toContain('MiniMax-M3.1-Flash');
    expect(MODELS.map((m) => m.id)).toContain('MiniMax-M3');
  });

  it('marks effort support only for M3.1-Flash', () => {
    const flash = MODELS.find((m) => m.id === 'MiniMax-M3.1-Flash');
    const m3 = MODELS.find((m) => m.id === 'MiniMax-M3');
    expect(flash?.supportsEffort).toBe(true);
    expect(m3?.supportsEffort).toBe(false);
    expect(flash?.thinkingAlwaysOn).toBe(true);
  });
});
```

- [x] **Step 2: Запустить, убедиться в падении**

Run: `npm test`
Expected: FAIL, модуль `src/config/models` не найден.

- [x] **Step 3: Реализовать `src/config/models.ts`**

```typescript
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type BaseUrlPreset = 'auto' | 'global' | 'china';

export interface ModelInfo {
  id: string;
  label: string;
  supportsEffort: boolean;
  thinkingAlwaysOn: boolean;
  contextWindow: number;
}

export const MODELS: ModelInfo[] = [
  {
    id: 'MiniMax-M3.1-Flash',
    label: 'MiniMax M3.1 Flash (1M, multimodal, tunable thinking)',
    supportsEffort: true,
    thinkingAlwaysOn: true,
    contextWindow: 1_000_000
  },
  {
    id: 'MiniMax-M3',
    label: 'MiniMax M3 (1M, multimodal, adaptive thinking)',
    supportsEffort: false,
    thinkingAlwaysOn: false,
    contextWindow: 1_000_000
  }
];

export const GLOBAL_BASE_URL = 'https://api.minimax.io/anthropic';
export const CHINA_BASE_URL = 'https://api.minimaxi.com/anthropic';

export function resolveBaseUrl(preset: BaseUrlPreset, custom?: string): string {
  if (custom && custom.trim().length > 0) {
    return custom.trim().replace(/\/+$/, '');
  }
  if (preset === 'china') {
    return CHINA_BASE_URL;
  }
  return GLOBAL_BASE_URL;
}
```

- [x] **Step 4: Реализовать `src/config/secrets.ts`**

```typescript
import * as vscode from 'vscode';

const SECRET_KEY = 'minimax.apiKey';
const ENV_KEY = 'MINIMAX_API_KEY';

export async function getApiKey(): Promise<string | undefined> {
  const stored = await vscode.workspace.getConfiguration('minimax').get<string>('apiKey');
  if (stored && stored.trim().length > 0) {
    return stored.trim();
  }
  const fromEnv = process.env[ENV_KEY];
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return undefined;
}

export async function setApiKey(key: string): Promise<void> {
  await vscode.workspace.getConfiguration('minimax').update('apiKey', key.trim(), vscode.ConfigurationTarget.Global);
}

export async function clearApiKey(): Promise<void> {
  await vscode.workspace.getConfiguration('minimax').update('apiKey', undefined, vscode.ConfigurationTarget.Global);
}
```

Важно: ключ хранится в `ConfigurationTarget.Global` под ключом `minimax.apiKey`, VS Code сам переносит значения, помеченные как секрет, в `SecretStorage`. Дополнительно `apiKey` не должно попадать в `minimax.apiKey`-конфиг, если оно не помечено `secret` в package.json. Проверить это в Task 5 при добавлении `apiKey` в `contributes.configuration.properties` с `"type": "string"` и `"tags": ["password"]`? Нет: в манифесте нет поддержки password для configuration. Значит правильное решение: `package.json` объявляет `"minimax.apiKey": { "type": "string", "default": "" }`, а расширение дополнительно дублирует значение в `context.secrets`. Реализация хранит ключ только в `context.secrets`:

```typescript
import * as vscode from 'vscode';

const SECRET_KEY = 'minimax.apiKey';
const ENV_KEY = 'MINIMAX_API_KEY';

export async function getApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  const stored = await secrets.get(SECRET_KEY);
  if (stored && stored.trim().length > 0) {
    return stored.trim();
  }
  const fromEnv = process.env[ENV_KEY];
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return undefined;
}

export async function setApiKey(secrets: vscode.SecretStorage, key: string): Promise<void> {
  await secrets.store(SECRET_KEY, key.trim());
}

export async function clearApiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_KEY);
}
```

Итоговая версия `src/config/secrets.ts` - вторая (с `context.secrets`). `getApiKey`, `setApiKey`, `clearApiKey` принимают `secrets: vscode.SecretStorage` первым аргументом.

- [x] **Step 5: Реализовать `src/config/settings.ts`**

```typescript
import * as vscode from 'vscode';
import type { BaseUrlPreset, EffortLevel } from './models';

export interface MiniMaxSettings {
  baseUrl: BaseUrlPreset;
  customBaseUrl: string;
  model: string;
  effort: EffortLevel;
  maxTokens: number;
  maxIterations: number;
  autoApprove: string[];
  enableWebSearch: boolean;
  rulesEnabled: boolean;
}

export function getSettings(): MiniMaxSettings {
  const cfg = vscode.workspace.getConfiguration('minimax');
  return {
    baseUrl: cfg.get<BaseUrlPreset>('baseUrl', 'auto'),
    customBaseUrl: cfg.get<string>('customBaseUrl', ''),
    model: cfg.get<string>('model', 'MiniMax-M3.1-Flash'),
    effort: cfg.get<EffortLevel>('effort', 'max'),
    maxTokens: cfg.get<number>('maxTokens', 32000),
    maxIterations: cfg.get<number>('maxIterations', 40),
    autoApprove: cfg.get<string[]>('autoApprove', []),
    enableWebSearch: cfg.get<boolean>('enableWebSearch', false),
    rulesEnabled: cfg.get<boolean>('rulesEnabled', true)
  };
}

export function onSettingsChanged(cb: (settings: MiniMaxSettings) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('minimax')) {
      cb(getSettings());
    }
  });
}
```

- [x] **Step 6: Прогнать тесты и закоммитить**

Run: `npm test`
Expected: PASS.

```bash
git add -- src/config test/unit/config.test.ts
git commit -m "feat: настройки, секреты и каталог моделей MiniMax"
```


---

### Task 3: Типы API и парсер SSE

**Files:**
- Create: `src/api/types.ts`, `src/api/sse.ts`
- Test: `test/unit/sse.test.ts`

**Interfaces:**
- Produces:
  - `type AnthropicRole = 'user' | 'assistant'`
  - `interface AnthropicTextBlock { type: 'text'; text: string }`
  - `interface AnthropicThinkingBlock { type: 'thinking'; thinking: string; signature?: string }`
  - `interface AnthropicToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }`
  - `interface AnthropicToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }`
  - `type AnthropicContentBlock` = объединение четырёх блоков выше
  - `interface AnthropicMessage { role: AnthropicRole; content: AnthropicContentBlock[] }`
  - `interface JsonSchema { type: 'object'; properties: Record<string, unknown>; required?: string[] }`
  - `interface ToolDefinition { name: string; description: string; input_schema: JsonSchema }`
  - `type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'`
  - `interface Usage { inputTokens: number; outputTokens: number }`
  - `interface ChatRequest { model: string; maxTokens: number; system: string; messages: AnthropicMessage[]; tools?: ToolDefinition[]; effort?: EffortLevel; thinking?: 'adaptive'; signal?: AbortSignal }`
  - `type StreamEvent` с вариантами `message_start`, `thinking_delta`, `text_delta`, `tool_use_start`, `tool_use_delta`, `message_stop`
  - `class StreamDecoder { push(chunk: string): StreamEvent[]; flush(): StreamEvent[] }`
  - `function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string }`

- [x] **Step 1: Написать падающий тест `test/unit/sse.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { StreamDecoder, parseSseChunk } from '../../src/api/sse';

describe('parseSseChunk', () => {
  it('extracts complete events and keeps the remainder', () => {
    const { events, rest } = parseSseChunk('event: a\ndata: {"x":1}\n\nevent: b\ndata: {"y":2}\n\npart');
    expect(events).toHaveLength(2);
    expect(events[0]?.event).toBe('a');
    expect(events[0]?.data).toBe('{"x":1}');
    expect(rest).toBe('part');
  });

  it('joins multiple data lines with a newline', () => {
    const { events } = parseSseChunk('event: a\ndata: one\ndata: two\n\n');
    expect(events[0]?.data).toBe('one\ntwo');
  });

  it('handles CRLF line endings', () => {
    const { events } = parseSseChunk('event: a\r\ndata: 1\r\n\r\n');
    expect(events[0]?.data).toBe('1');
  });
});

describe('StreamDecoder', () => {
  it('emits text deltas and a final message_stop', () => {
    const decoder = new StreamDecoder();
    const events = [
      ...decoder.push('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11,"output_tokens":0}}}\n\n'),
      ...decoder.push('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'),
      ...decoder.push('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n'),
      ...decoder.push('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\n'),
      ...decoder.push('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n')
    ];
    const text = events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    expect(text).toBe('Hello');
    const stop = events.find((e) => e.type === 'message_stop');
    expect(stop?.stopReason).toBe('end_turn');
    expect(stop?.usage.inputTokens).toBe(11);
    expect(stop?.usage.outputTokens).toBe(5);
  });

  it('keeps thinking blocks separate from text', () => {
    const decoder = new StreamDecoder();
    const events = [
      ...decoder.push('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n'),
      ...decoder.push('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"why"}}\n\n')
    ];
    expect(events.some((e) => e.type === 'thinking_delta')).toBe(true);
    expect(events.some((e) => e.type === 'text_delta')).toBe(false);
  });

  it('accumulates tool use arguments from partial json', () => {
    const decoder = new StreamDecoder();
    const events = [
      ...decoder.push('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}\n\n'),
      ...decoder.push('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"path\":"}}\n\n'),
      ...decoder.push('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\"a.ts\"}"}}\n\n')
    ];
    expect(events.some((e) => e.type === 'tool_use_start')).toBe(true);
    const stop = decoder.flush()[0];
    expect(stop?.type).toBe('message_stop');
    if (stop?.type === 'message_stop') {
      const block = stop.blocks[0];
      expect(block?.type).toBe('tool_use');
      if (block?.type === 'tool_use') {
        expect(block.id).toBe('toolu_1');
        expect(block.name).toBe('read_file');
        expect(block.input).toEqual({ path: 'a.ts' });
      }
    }
  });

  it('reports broken tool arguments without throwing', () => {
    const decoder = new StreamDecoder();
    decoder.push('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}\n\n');
    decoder.push('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{broken"}}\n\n');
    const stop = decoder.flush()[0];
    if (stop?.type === 'message_stop') {
      const block = stop.blocks[0];
      if (block?.type === 'tool_use') {
        expect(block.input).toEqual({});
      }
    }
  });

  it('ignores unknown event types', () => {
    const decoder = new StreamDecoder();
    expect(decoder.push('event: ping\ndata: {}\n\n')).toHaveLength(0);
  });
});
```

- [x] **Step 2: Запустить, убедиться в падении**

Run: `npm test`
Expected: FAIL, модуль `src/api/sse` не найден.

- [x] **Step 3: Реализовать `src/api/types.ts`**

```typescript
export type AnthropicRole = 'user' | 'assistant';

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicThinkingBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: AnthropicRole;
  content: AnthropicContentBlock[];
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ChatRequest {
  model: string;
  maxTokens: number;
  system: string;
  messages: AnthropicMessage[];
  tools?: ToolDefinition[];
  effort?: EffortLevel;
  thinking?: 'adaptive';
  signal?: AbortSignal;
}

export type StreamEvent =
  | { type: 'message_start'; usage: Usage }
  | { type: 'thinking_delta'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; partialJson: string }
  | {
      type: 'message_stop';
      stopReason: StopReason;
      usage: Usage;
      blocks: AnthropicContentBlock[];
    };
```

- [x] **Step 4: Реализовать `src/api/sse.ts`**

```typescript
import type {
  AnthropicContentBlock,
  StopReason,
  StreamEvent,
  Usage
} from './types';

export interface SseEvent {
  event: string;
  data: string;
}

export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: SseEvent[] = [];
  for (const block of blocks) {
    if (block.trim().length === 0) {
      continue;
    }
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (dataLines.length > 0) {
      events.push({ event, data: dataLines.join('\n') });
    }
  }
  return { events, rest };
}

interface BlockState {
  kind: 'text' | 'thinking' | 'tool_use';
  text: string;
  json: string;
  id: string;
  name: string;
}

export class StreamDecoder {
  private buffer = '';
  private readonly blocks = new Map<number, BlockState>();
  private stopReason: StopReason = 'end_turn';
  private inputTokens = 0;
  private outputTokens = 0;

  push(chunk: string): StreamEvent[] {
    this.buffer += chunk;
    const { events, rest } = parseSseChunk(this.buffer);
    this.buffer = rest;
    const out: StreamEvent[] = [];
    for (const sse of events) {
      const parsed = this.handle(sse);
      if (parsed) {
        out.push(...parsed);
      }
    }
    return out;
  }

  flush(): StreamEvent[] {
    const out: StreamEvent[] = [];
    if (this.buffer.trim().length > 0) {
      const { events, rest } = parseSseChunk(this.buffer + '\n\n');
      this.buffer = rest;
      for (const sse of events) {
        const parsed = this.handle(sse);
        if (parsed) {
          out.push(...parsed);
        }
      }
    }
    out.push({
      type: 'message_stop',
      stopReason: this.stopReason,
      usage: this.usage(),
      blocks: this.buildBlocks()
    });
    return out;
  }

  private handle(sse: SseEvent): StreamEvent[] | null {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(sse.data) as Record<string, unknown>;
    } catch {
      return null;
    }
    const type = typeof payload['type'] === 'string' ? (payload['type'] as string) : sse.event;

    if (type === 'message_start') {
      const message = payload['message'] as { usage?: { input_tokens?: number } } | undefined;
      this.inputTokens = message?.usage?.input_tokens ?? 0;
      return [{ type: 'message_start', usage: this.usage() }];
    }

    if (type === 'content_block_start') {
      const index = Number(payload['index'] ?? 0);
      const block = payload['content_block'] as
        | { type?: string; thinking?: string; id?: string; name?: string }
        | undefined;
      const kind =
        block?.type === 'thinking' ? 'thinking' : block?.type === 'tool_use' ? 'tool_use' : 'text';
      this.blocks.set(index, {
        kind,
        text: kind === 'thinking' ? (block?.thinking ?? '') : '',
        json: '',
        id: block?.id ?? '',
        name: block?.name ?? ''
      });
      if (kind === 'tool_use') {
        return [{ type: 'tool_use_start', id: block?.id ?? '', name: block?.name ?? '' }];
      }
      return [];
    }

    if (type === 'content_block_delta') {
      const index = Number(payload['index'] ?? 0);
      const delta = payload['delta'] as
        | { type?: string; text?: string; thinking?: string; partial_json?: string }
        | undefined;
      const state = this.blocks.get(index);
      if (delta?.type === 'text_delta') {
        const text = delta.text ?? '';
        if (state) {
          state.text += text;
        }
        return [{ type: 'text_delta', text }];
      }
      if (delta?.type === 'thinking_delta') {
        const text = delta.thinking ?? '';
        if (state) {
          state.text += text;
        }
        return [{ type: 'thinking_delta', text }];
      }
      if (delta?.type === 'input_json_delta') {
        const partialJson = delta.partial_json ?? '';
        if (state) {
          state.json += partialJson;
        }
        return [{ type: 'tool_use_delta', id: state?.id ?? '', partialJson }];
      }
      return [];
    }

    if (type === 'message_delta') {
      const delta = payload['delta'] as { stop_reason?: StopReason } | undefined;
      if (delta?.stop_reason) {
        this.stopReason = delta.stop_reason;
      }
      const usage = payload['usage'] as { output_tokens?: number } | undefined;
      if (typeof usage?.output_tokens === 'number') {
        this.outputTokens = usage.output_tokens;
      }
      return [];
    }

    return null;
  }

  private usage(): Usage {
    return { inputTokens: this.inputTokens, outputTokens: this.outputTokens };
  }

  private buildBlocks(): AnthropicContentBlock[] {
    const out: AnthropicContentBlock[] = [];
    const indexes = [...this.blocks.keys()].sort((a, b) => a - b);
    for (const index of indexes) {
      const state = this.blocks.get(index);
      if (!state) {
        continue;
      }
      if (state.kind === 'text') {
        if (state.text.length > 0) {
          out.push({ type: 'text', text: state.text });
        }
      } else if (state.kind === 'thinking') {
        if (state.text.length > 0) {
          out.push({ type: 'thinking', thinking: state.text });
        }
      } else {
        let input: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(state.json.length > 0 ? state.json : '{}');
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            input = parsed as Record<string, unknown>;
          }
        } catch {
          input = {};
        }
        out.push({ type: 'tool_use', id: state.id, name: state.name, input });
      }
    }
    return out;
  }
}
```

- [x] **Step 5: Прогнать тесты и закоммитить**

Run: `npm test`
Expected: PASS.

```bash
git add -- src/api/types.ts src/api/sse.ts test/unit/sse.test.ts
git commit -m "feat: типы Anthropic-совместимого API и парсер SSE"
```


---

### Task 4: HTTP-клиент MiniMax и маппинг ошибок

**Files:**
- Create: `src/api/client.ts`, `src/api/errors.ts`
- Create: `test/integration/fake-server.ts`, `test/integration/client.integration.test.ts`

**Interfaces:**
- Consumes: `ChatRequest`, `StreamEvent`, `StreamDecoder` из Task 3
- Produces:
  - `interface MiniMaxClient { stream(request: ChatRequest, options?: { signal?: AbortSignal }): AsyncGenerator<StreamEvent> }`
  - `class HttpMiniMaxClient implements MiniMaxClient` с конструктором `(options: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch })`
  - `class MiniMaxApiError extends Error` с полями `status: number`, `code: number | undefined`, `retryable: boolean`
  - `function buildRequestBody(request: ChatRequest): Record<string, unknown>`
  - `async function mapHttpError(response: Response): Promise<MiniMaxApiError>`

- [x] **Step 1: Создать `test/integration/fake-server.ts`**

```typescript
import { createServer, type Server } from 'node:http';

export interface FakeServerOptions {
  status?: number;
  body?: string;
  chunks?: string[];
}

export interface FakeServer {
  url: string;
  requests: Array<{ headers: Record<string, string | string[] | undefined>; body: string }>;
  close(): Promise<void>;
}

export async function startFakeServer(options: FakeServerOptions = {}): Promise<FakeServer> {
  const requests: FakeServer['requests'] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += String(chunk);
    });
    req.on('end', () => {
      requests.push({ headers: req.headers, body });
      const status = options.status ?? 200;
      res.writeHead(status, { 'Content-Type': 'text/event-stream' });
      if (status !== 200) {
        res.end(options.body ?? '{"error":{"type":"invalid_request_error","message":"boom"}}');
        return;
      }
      const chunks = options.chunks ?? [
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n'
      ];
      for (const chunk of chunks) {
        res.write(chunk);
      }
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fake server did not bind');
  }
  return {
    url: 'http://127.0.0.1:' + address.port,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      )
  };
}
```

- [x] **Step 2: Написать падающий тест `test/integration/client.integration.test.ts`**

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { HttpMiniMaxClient } from '../../src/api/client';
import { MiniMaxApiError } from '../../src/api/errors';
import { startFakeServer, type FakeServer } from './fake-server';

let server: FakeServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function collect(client: HttpMiniMaxClient, model: string) {
  const events = [];
  for await (const event of client.stream({
    model,
    maxTokens: 32000,
    system: 'sys',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
  })) {
    events.push(event);
  }
  return events;
}

describe('HttpMiniMaxClient', () => {
  it('sends a bearer token and the anthropic shape', async () => {
    server = await startFakeServer();
    const client = new HttpMiniMaxClient({ baseUrl: server.url + '/anthropic', apiKey: 'test-key' });
    const events = await collect(client, 'MiniMax-M3.1-Flash');
    const request = server.requests[0];
    expect(request?.headers['authorization']).toBe('Bearer test-key');
    expect(request?.headers['x-api-key']).toBeUndefined();
    const body = JSON.parse(request?.body ?? '{}');
    expect(body.model).toBe('MiniMax-M3.1-Flash');
    expect(body.max_tokens).toBe(32000);
    expect(body.stream).toBe(true);
    expect(body.system).toBe('sys');
    expect(body.output_config).toEqual({ effort: 'max' });
    expect(body.thinking).toBeUndefined();
    const text = events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    expect(text).toBe('hi');
    const stop = events.find((e) => e.type === 'message_stop');
    expect(stop?.stopReason).toBe('end_turn');
  });

  it('omits effort for models that do not support it', async () => {
    server = await startFakeServer();
    const client = new HttpMiniMaxClient({ baseUrl: server.url, apiKey: 'k' });
    await collect(client, 'MiniMax-M3');
    const body = JSON.parse(server.requests[0]?.body ?? '{}');
    expect(body.output_config).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  it('maps an invalid key to a non retryable error', async () => {
    server = await startFakeServer({
      status: 401,
      body: '{"error":{"type":"authentication_error","message":"invalid api key"}}'
    });
    const client = new HttpMiniMaxClient({ baseUrl: server.url, apiKey: 'bad' });
    await expect(collect(client, 'MiniMax-M3.1-Flash')).rejects.toBeInstanceOf(MiniMaxApiError);
  });

  it('maps 429 to a retryable error', async () => {
    server = await startFakeServer({ status: 429, body: '{"error":{"message":"rate limited"}}' });
    const client = new HttpMiniMaxClient({ baseUrl: server.url, apiKey: 'k' });
    try {
      await collect(client, 'MiniMax-M3.1-Flash');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MiniMaxApiError);
      expect((error as MiniMaxApiError).retryable).toBe(true);
    }
  });
});
```

- [x] **Step 3: Запустить, убедиться в падении**

Run: `npm test`
Expected: FAIL, модуль `src/api/client` не найден.

- [x] **Step 4: Реализовать `src/api/errors.ts`**

```typescript
export class MiniMaxApiError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  readonly retryable: boolean;

  constructor(message: string, status: number, code: number | undefined, retryable: boolean) {
    super(message);
    this.name = 'MiniMaxApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

interface MiniMaxErrorBody {
  error?: { type?: string; message?: string };
  base_resp?: { status_code?: number; status_msg?: string };
  message?: string;
}

const CODE_MESSAGES: Record<number, string> = {
  2049: 'Invalid MiniMax API key. Check the key in MiniMax: Add API Key.',
  2057: 'This key is not an M Plan key. Use your Token Plan subscription key.',
  2061: 'The selected model is not available for your plan. Pick another model.',
  2062: 'M Plan rate limit reached. Wait for the quota window or upgrade the plan.',
  2066: 'MiniMax servers are under heavy load. Retry shortly.'
};

export async function mapHttpError(response: Response): Promise<MiniMaxApiError> {
  let body: MiniMaxErrorBody = {};
  try {
    body = (await response.json()) as MiniMaxErrorBody;
  } catch {
    body = {};
  }
  const rawMessage =
    body.error?.message ?? body.base_resp?.status_msg ?? body.message ?? response.statusText;
  const rawCode = body.base_resp?.status_code ?? body.error?.type;
  const code = typeof rawCode === 'number' ? rawCode : undefined;

  if (code !== undefined && CODE_MESSAGES[code] !== undefined) {
    return new MiniMaxApiError(CODE_MESSAGES[code]!, response.status, code, code === 2066);
  }
  if (response.status === 401 || response.status === 403) {
    return new MiniMaxApiError(
      'Invalid MiniMax API key. Check the key in MiniMax: Add API Key.',
      response.status,
      code,
      false
    );
  }
  if (response.status === 429) {
    return new MiniMaxApiError('Rate limit reached. Retry shortly.', response.status, code, true);
  }
  if (response.status >= 500) {
    return new MiniMaxApiError(
      'MiniMax server error: ' + (rawMessage || response.status),
      response.status,
      code,
      true
    );
  }
  return new MiniMaxApiError(
    'MiniMax request failed: ' + (rawMessage || response.status),
    response.status,
    code,
    false
  );
}
```

- [x] **Step 5: Реализовать `src/api/client.ts`**

```typescript
import { mapHttpError, MiniMaxApiError } from './errors';
import { StreamDecoder } from './sse';
import type { ChatRequest, StreamEvent } from './types';

export interface MiniMaxClient {
  stream(request: ChatRequest, options?: { signal?: AbortSignal }): AsyncGenerator<StreamEvent>;
}

export function buildRequestBody(request: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxTokens,
    system: request.system,
    messages: request.messages,
    stream: true
  };
  if (request.tools && request.tools.length > 0) {
    body['tools'] = request.tools;
  }
  if (request.model === 'MiniMax-M3.1-Flash') {
    if (request.effort) {
      body['output_config'] = { effort: request.effort };
    }
  } else if (request.thinking === 'adaptive') {
    body['thinking'] = { type: 'adaptive' };
  }
  return body;
}

export class HttpMiniMaxClient implements MiniMaxClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async *stream(request: ChatRequest, options?: { signal?: AbortSignal }): AsyncGenerator<StreamEvent> {
    const url = this.baseUrl + '/v1/messages';
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(buildRequestBody(request)),
        signal: options?.signal ?? request.signal
      });
    } catch (error) {
      if (error instanceof MiniMaxApiError) {
        throw error;
      }
      throw new MiniMaxApiError(
        'Network error while contacting MiniMax: ' +
          (error instanceof Error ? error.message : String(error)),
        0,
        undefined,
        true
      );
    }

    if (!response.ok) {
      throw await mapHttpError(response);
    }
    if (!response.body) {
      throw new MiniMaxApiError(
        'MiniMax returned an empty response body.',
        response.status,
        undefined,
        true
      );
    }

    const decoder = new StreamDecoder();
    const reader = response.body.getReader();
    const utf8 = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const chunk = utf8.decode(value, { stream: true });
        for (const event of decoder.push(chunk)) {
          yield event;
        }
      }
    } finally {
      reader.releaseLock();
    }
    for (const event of decoder.flush()) {
      yield event;
    }
  }
}
```

- [x] **Step 6: Прогнать тесты и закоммитить**

Run: `npm test`
Expected: PASS.

```bash
git add -- src/api/client.ts src/api/errors.ts test/integration
git commit -m "feat: клиент MiniMax и маппинг ошибок API"
```

---

### Task 5: Инструменты работы с файлами и построчный diff

**Files:**
- Create: `src/tools/types.ts`, `src/tools/diff.ts`, `src/tools/fs.ts`, `src/storage/backups.ts`
- Test: `test/unit/diff.test.ts`, `test/unit/tools-fs.test.ts`

**Interfaces:**
- Produces:
  - `src/tools/types.ts`: `interface ToolContext { workspaceRoot: string; signal: AbortSignal; logger: Logger; backups: BackupStore }`, `interface ToolExecutionResult { content: string; isError?: boolean; metadata?: Record<string, unknown> }`, `type ApprovalPolicy = 'never' | 'always'`, `interface ToolEntry { name: string; description: string; inputSchema: JsonSchema; approval: ApprovalPolicy; execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionResult> }`
  - `interface DiffLine { type: 'context' | 'add' | 'remove'; oldLine?: number; newLine?: number; text: string }`
  - `function diffLines(oldText: string, newText: string): DiffLine[]`
  - `interface BackupEntry { path: string; previousContent: string | null; createdAt: number }`
  - `interface BackupStore { save(path: string, previousContent: string | null): Promise<void>; revertLast(): Promise<BackupEntry | undefined>; list(): Promise<BackupEntry[]> }`
  - `class InMemoryBackupStore implements BackupStore`
  - `function resolveWorkspacePath(root: string, candidate: string): string`, бросает Error при выходе за пределы root
  - `function createFileTools(deps: { backups: BackupStore }): ToolEntry[]`

- [x] **Step 1: Создать `src/tools/types.ts` и `src/storage/backups.ts`**

```typescript
// src/storage/backups.ts
export interface BackupEntry {
  path: string;
  previousContent: string | null;
  createdAt: number;
}

export interface BackupStore {
  save(path: string, previousContent: string | null): Promise<void>;
  revertLast(): Promise<BackupEntry | undefined>;
  list(): Promise<BackupEntry[]>;
}

export class InMemoryBackupStore implements BackupStore {
  private readonly entries: BackupEntry[] = [];

  async save(path: string, previousContent: string | null): Promise<void> {
    this.entries.push({ path, previousContent, createdAt: Date.now() });
  }

  async revertLast(): Promise<BackupEntry | undefined> {
    return this.entries.pop();
  }

  async list(): Promise<BackupEntry[]> {
    return [...this.entries];
  }
}
```

```typescript
// src/tools/types.ts
import type { JsonSchema } from '../api/types';
import type { Logger } from '../logger';
import type { BackupStore } from '../storage/backups';

export interface ToolContext {
  workspaceRoot: string;
  signal: AbortSignal;
  logger: Logger;
  backups: BackupStore;
}

export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export type ApprovalPolicy = 'never' | 'always';

export interface ToolEntry {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  approval: ApprovalPolicy;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionResult>;
}
```

- [x] **Step 2: Написать падающий тест `test/unit/diff.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { diffLines } from '../../src/tools/diff';

describe('diffLines', () => {
  it('marks added lines', () => {
    const result = diffLines('a\nb\n', 'a\nb\nc\n');
    expect(result.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['c']);
  });

  it('marks removed lines', () => {
    const result = diffLines('a\nb\n', 'a\n');
    expect(result.filter((l) => l.type === 'remove').map((l) => l.text)).toEqual(['b']);
  });

  it('marks changed lines as remove plus add', () => {
    const result = diffLines('a\nb\n', 'a\nc\n');
    expect(result.filter((l) => l.type === 'remove').map((l) => l.text)).toEqual(['b']);
    expect(result.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['c']);
  });

  it('returns nothing for identical content', () => {
    expect(diffLines('same\n', 'same\n')).toEqual([]);
  });

  it('handles empty input', () => {
    expect(diffLines('', '')).toEqual([]);
    expect(diffLines('', 'new\n').filter((l) => l.type === 'add')).toHaveLength(1);
  });
});
```

- [x] **Step 3: Запустить, убедиться в падении**

Run: `npm test`
Expected: FAIL, модуль `src/tools/diff` не найден.

- [x] **Step 4: Реализовать `src/tools/diff.ts`**

```typescript
export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  oldLine?: number;
  newLine?: number;
  text: string;
}

const MAX_MATRIX_CELLS = 4_000_000;

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.length === 0 ? [] : oldText.replace(/\n$/, '').split('\n');
  const newLines = newText.length === 0 ? [] : newText.replace(/\n$/, '').split('\n');

  if (oldLines.length === 0 && newLines.length === 0) {
    return [];
  }
  if (oldLines.length * newLines.length > MAX_MATRIX_CELLS) {
    return fallbackDiff(oldText, newText);
  }

  const table: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    new Array<number>(newLines.length + 1).fill(0)
  );
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      const row = table[i]!;
      const nextRow = table[i + 1]!;
      row[j] =
        oldLines[i] === newLines[j]
          ? nextRow[j + 1]! + 1
          : Math.max(nextRow[j]!, row[j + 1]!);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'context', oldLine: i + 1, newLine: j + 1, text: oldLines[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      result.push({ type: 'remove', oldLine: i + 1, text: oldLines[i]! });
      i++;
    } else {
      result.push({ type: 'add', newLine: j + 1, text: newLines[j]! });
      j++;
    }
  }
  while (i < oldLines.length) {
    result.push({ type: 'remove', oldLine: i + 1, text: oldLines[i]! });
    i++;
  }
  while (j < newLines.length) {
    result.push({ type: 'add', newLine: j + 1, text: newLines[j]! });
    j++;
  }
  return result;
}

function fallbackDiff(oldText: string, newText: string): DiffLine[] {
  const result: DiffLine[] = [];
  for (const [index, text] of oldText.split('\n').entries()) {
    result.push({ type: 'remove', oldLine: index + 1, text });
  }
  for (const [index, text] of newText.split('\n').entries()) {
    result.push({ type: 'add', newLine: index + 1, text });
  }
  return result;
}
```

- [x] **Step 5: Написать падающий тест `test/unit/tools-fs.test.ts`**

```typescript
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryBackupStore } from '../../src/storage/backups';
import { createFileTools, resolveWorkspacePath } from '../../src/tools/fs';

function makeContext(root: string) {
  return {
    workspaceRoot: root,
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined },
    backups: new InMemoryBackupStore()
  };
}

describe('resolveWorkspacePath', () => {
  it('rejects paths outside the workspace', () => {
    expect(() => resolveWorkspacePath('/tmp/root', '../escape.txt')).toThrow();
  });

  it('resolves a relative path inside the workspace', () => {
    expect(resolveWorkspacePath('/tmp/root', 'a/b.txt')).toBe(join('/tmp/root', 'a/b.txt'));
  });
});

describe('file tools', () => {
  it('reads a file with line numbers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'one\ntwo\n', 'utf8');
    const tools = createFileTools({ backups: new InMemoryBackupStore() });
    const read = tools.find((t) => t.name === 'read_file');
    const result = await read!.execute({ path: 'a.txt' }, makeContext(root));
    expect(result.content).toContain('1: one');
    expect(result.content).toContain('2: two');
  });

  it('writes a file and stores a backup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'old\n', 'utf8');
    const backups = new InMemoryBackupStore();
    const tools = createFileTools({ backups });
    const write = tools.find((t) => t.name === 'write_file');
    const result = await write!.execute({ path: 'a.txt', content: 'new\n' }, makeContext(root));
    expect(result.isError).toBeFalsy();
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('new\n');
    const entries = await backups.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.previousContent).toBe('old\n');
  });

  it('rejects writes outside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tools = createFileTools({ backups: new InMemoryBackupStore() });
    const write = tools.find((t) => t.name === 'write_file');
    const result = await write!.execute({ path: '../evil.txt', content: 'x' }, makeContext(root));
    expect(result.isError).toBe(true);
  });

  it('reports how many matches edit_file found', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'x\nx\n', 'utf8');
    const tools = createFileTools({ backups: new InMemoryBackupStore() });
    const edit = tools.find((t) => t.name === 'edit_file');
    const result = await edit!.execute({ path: 'a.txt', old_string: 'x', new_string: 'y' }, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('2');
  });

  it('applies a unique replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'x\ny\n', 'utf8');
    const tools = createFileTools({ backups: new InMemoryBackupStore() });
    const edit = tools.find((t) => t.name === 'edit_file');
    const result = await edit!.execute({ path: 'a.txt', old_string: 'x', new_string: 'z' }, makeContext(root));
    expect(result.isError).toBeFalsy();
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('z\ny\n');
  });
});
```

- [x] **Step 6: Запустить, убедиться в падении**

Run: `npm test`
Expected: FAIL, модуль `src/tools/fs` не найден.

- [x] **Step 7: Реализовать `src/tools/fs.ts`**

```typescript
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { BackupStore } from '../storage/backups';
import type { ToolEntry } from './types';

const MAX_READ_LINES = 2000;
const MAX_READ_CHARS = 200_000;
const MAX_WRITE_CHARS = 200_000;

export function resolveWorkspacePath(root: string, candidate: string): string {
  const target = isAbsolute(candidate) ? candidate : resolve(root, candidate);
  const rel = relative(resolve(root), target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('path escapes the workspace root: ' + candidate);
  }
  return target;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export function createFileTools(deps: { backups: BackupStore }): ToolEntry[] {
  const readFile: ToolEntry = {
    name: 'read_file',
    description:
      'Read a UTF-8 text file from the workspace. Returns content with line numbers. Use start_line and end_line for a range.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root.' },
        start_line: { type: 'integer', minimum: 1, description: 'First line to read, 1-based.' },
        end_line: { type: 'integer', minimum: 1, description: 'Last line to read, inclusive.' }
      },
      required: ['path']
    },
    async execute(input, ctx) {
      try {
        const target = resolveWorkspacePath(ctx.workspaceRoot, String(input['path'] ?? ''));
        const raw = await readFile(target, 'utf8');
        const lines = raw.split('\n');
        const start = Number(input['start_line'] ?? 1);
        const end = Number(input['end_line'] ?? start - 1 + MAX_READ_LINES);
        const slice = lines.slice(Math.max(0, start - 1), Math.max(0, end));
        const body = slice.map((line, offset) => (start + offset) + ': ' + line).join('\n');
        if (body.length > MAX_READ_CHARS) {
          return { content: body.slice(0, MAX_READ_CHARS) + '\n[truncated]', isError: false };
        }
        return { content: body.length > 0 ? body : '[empty file]', isError: false };
      } catch (error) {
        return {
          content: 'read_file failed: ' + (error instanceof Error ? error.message : String(error)),
          isError: true
        };
      }
    }
  };

  const writeFile: ToolEntry = {
    name: 'write_file',
    description:
      'Create a file or replace its whole content. Prefer edit_file for targeted changes. The user reviews a diff before the write is applied.',
    approval: 'always',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root.' },
        content: { type: 'string', description: 'Full new content of the file.' }
      },
      required: ['path', 'content']
    },
    async execute(input, ctx) {
      const content = String(input['content'] ?? '');
      if (content.length > MAX_WRITE_CHARS) {
        return {
          content: 'write_file refused: content exceeds ' + MAX_WRITE_CHARS + ' characters',
          isError: true
        };
      }
      try {
        const target = resolveWorkspacePath(ctx.workspaceRoot, String(input['path'] ?? ''));
        const previous = await readFile(target, 'utf8').catch(() => null);
        await ctx.backups.save(target, previous);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, 'utf8');
        return { content: 'Wrote ' + String(input['path']), isError: false };
      } catch (error) {
        return {
          content: 'write_file failed: ' + (error instanceof Error ? error.message : String(error)),
          isError: true
        };
      }
    }
  };

  const editFile: ToolEntry = {
    name: 'edit_file',
    description:
      'Replace an exact string in a file. old_string must appear exactly once unless replace_all is true.',
    approval: 'always',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root.' },
        old_string: { type: 'string', description: 'Exact text to replace.' },
        new_string: { type: 'string', description: 'Replacement text.' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence.' }
      },
      required: ['path', 'old_string', 'new_string']
    },
    async execute(input, ctx) {
      const oldString = String(input['old_string'] ?? '');
      const newString = String(input['new_string'] ?? '');
      if (oldString.length === 0) {
        return { content: 'edit_file failed: old_string must not be empty', isError: true };
      }
      try {
        const target = resolveWorkspacePath(ctx.workspaceRoot, String(input['path'] ?? ''));
        const raw = await readFile(target, 'utf8');
        const matches = countOccurrences(raw, oldString);
        const replaceAll = input['replace_all'] === true;
        if (matches === 0) {
          return { content: 'edit_file failed: old_string not found in the file', isError: true };
        }
        if (matches > 1 && !replaceAll) {
          return {
            content:
              'edit_file failed: old_string found ' +
              matches +
              ' times, provide more context or set replace_all',
            isError: true
          };
        }
        const updated = replaceAll
          ? raw.split(oldString).join(newString)
          : raw.replace(oldString, newString);
        await ctx.backups.save(target, raw);
        await writeFile(target, updated, 'utf8');
        return { content: 'Edited ' + String(input['path']), isError: false };
      } catch (error) {
        return {
          content: 'edit_file failed: ' + (error instanceof Error ? error.message : String(error)),
          isError: true
        };
      }
    }
  };

  return [readFile, writeFile, editFile];
}
```

- [x] **Step 8: Прогнать тесты и закоммитить**

Run: `npm test`
Expected: PASS.

```bash
git add -- src/tools/types.ts src/tools/diff.ts src/tools/fs.ts src/storage/backups.ts test/unit/diff.test.ts test/unit/tools-fs.test.ts
git commit -m "feat: инструменты работы с файлами и построчный diff"
```


---

### Task 6: Инструменты обзора проекта и терминал

**Files:**
- Create: `src/tools/explore.ts`, `src/tools/terminal.ts`
- Test: `test/unit/tools-explore.test.ts`, `test/unit/tools-terminal.test.ts`

**Interfaces:**
- Consumes: `ToolEntry` из `src/tools/types.ts`
- Produces:
  - `function createExploreTools(): ToolEntry[]` с инструментами `list_files` и `search_code`
  - `function createTerminalTools(): ToolEntry[]` с инструментом `run_terminal`
  - `const IGNORED_DIRS: string[]`

- [x] **Step 1: Написать падающий тест `test/unit/tools-explore.test.ts`**

```typescript
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createExploreTools } from '../../src/tools/explore';

function makeContext(root: string) {
  return {
    workspaceRoot: root,
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined },
    backups: { save: async () => undefined, revertLast: async () => undefined, list: async () => [] }
  };
}

describe('explore tools', () => {
  it('lists files and skips node_modules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'x', 'utf8');
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'x', 'utf8');
    const tool = createExploreTools().find((t) => t.name === 'list_files');
    const result = await tool!.execute({}, makeContext(root));
    expect(result.content).toContain('src/a.ts');
    expect(result.content).not.toContain('node_modules');
  });

  it('finds matches with file and line', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.ts'), 'const needle = 1;\n', 'utf8');
    const tool = createExploreTools().find((t) => t.name === 'search_code');
    const result = await tool!.execute({ query: 'needle' }, makeContext(root));
    expect(result.content).toContain('a.ts');
    expect(result.content).toContain('const needle');
  });

  it('returns nothing when there is no match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.ts'), 'x', 'utf8');
    const tool = createExploreTools().find((t) => t.name === 'search_code');
    const result = await tool!.execute({ query: 'zzz-not-there' }, makeContext(root));
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('No matches');
  });
});
```

- [x] **Step 2: Написать падающий тест `test/unit/tools-terminal.test.ts`**

```typescript
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTerminalTools } from '../../src/tools/terminal';

function makeContext(root: string) {
  return {
    workspaceRoot: root,
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined },
    backups: { save: async () => undefined, revertLast: async () => undefined, list: async () => [] }
  };
}

describe('run_terminal', () => {
  it('captures stdout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tool = createTerminalTools().find((t) => t.name === 'run_terminal');
    const result = await tool!.execute({ command: 'node -e "console.log(42)"' }, makeContext(root));
    expect(result.content).toContain('42');
    expect(result.isError).toBeFalsy();
  });

  it('reports a non zero exit code as an error result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tool = createTerminalTools().find((t) => t.name === 'run_terminal');
    const result = await tool!.execute({ command: 'node -e "process.exit(3)"' }, makeContext(root));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('3');
  });

  it('runs in the workspace root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    const tool = createTerminalTools().find((t) => t.name === 'run_terminal');
    const result = await tool!.execute({ command: 'node -e "console.log(process.cwd())"' }, makeContext(root));
    expect(result.content.toLowerCase()).toContain(root.slice(0, 3).toLowerCase());
  });
});
```

- [x] **Step 3: Запустить, убедиться в падении**

Run: `npm test`
Expected: FAIL, модули `src/tools/explore` и `src/tools/terminal` не найдены.

- [x] **Step 4: Реализовать `src/tools/explore.ts`**

```typescript
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { ToolEntry } from './types';

export const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next'];

const MAX_LIST_ENTRIES = 300;
const MAX_SEARCH_RESULTS = 200;
const DEFAULT_SEARCH_RESULTS = 50;
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.yml', '.yaml',
  '.py', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php',
  '.sh', '.ps1', '.html', '.css', '.scss', '.sql', '.toml', '.ini', '.vue', '.svelte'
]);

function isIgnored(name: string): boolean {
  return IGNORED_DIRS.includes(name) || name.startsWith('.');
}

export function createExploreTools(): ToolEntry[] {
  const listFiles: ToolEntry = {
    name: 'list_files',
    description:
      'List files and folders of the workspace. Use it to understand the project layout before reading files.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory relative to the workspace root.' },
        depth: { type: 'integer', minimum: 1, maximum: 5, description: 'How deep to descend, default 2.' }
      }
    },
    async execute(input, ctx) {
      const start = join(ctx.workspaceRoot, String(input['path'] ?? '.'));
      const depth = Math.min(5, Math.max(1, Number(input['depth'] ?? 2)));
      const lines: string[] = [];
      const walk = async (dir: string, level: number): Promise<void> => {
        if (level > depth || lines.length >= MAX_LIST_ENTRIES) {
          return;
        }
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (lines.length >= MAX_LIST_ENTRIES) {
            return;
          }
          if (isIgnored(entry.name)) {
            continue;
          }
          const full = join(dir, entry.name);
          const rel = relative(ctx.workspaceRoot, full).split(sep).join('/');
          lines.push(entry.isDirectory() ? rel + '/' : rel);
          if (entry.isDirectory()) {
            await walk(full, level + 1);
          }
        }
      };
      await walk(start, 1);
      if (lines.length === 0) {
        return { content: 'No files found', isError: false };
      }
      return { content: lines.join('\n'), isError: false };
    }
  };

  const searchCode: ToolEntry = {
    name: 'search_code',
    description:
      'Search the workspace for a literal string. Returns matching file paths with line numbers and the matching line.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Literal text to look for.' },
        path: { type: 'string', description: 'Subdirectory to search in, relative to the workspace root.' },
        max_results: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_SEARCH_RESULTS,
          description: 'Maximum number of matches, default 50.'
        }
      },
      required: ['query']
    },
    async execute(input, ctx) {
      const query = String(input['query'] ?? '');
      if (query.length === 0) {
        return { content: 'search_code failed: query must not be empty', isError: true };
      }
      const limit = Math.min(
        MAX_SEARCH_RESULTS,
        Math.max(1, Number(input['max_results'] ?? DEFAULT_SEARCH_RESULTS))
      );
      const root = join(ctx.workspaceRoot, String(input['path'] ?? '.'));
      const results: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        if (results.length >= limit) {
          return;
        }
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (results.length >= limit) {
            return;
          }
          if (isIgnored(entry.name)) {
            continue;
          }
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
            continue;
          }
          const dot = entry.name.lastIndexOf('.');
          const extension = dot === -1 ? '' : entry.name.slice(dot).toLowerCase();
          if (!TEXT_EXTENSIONS.has(extension)) {
            continue;
          }
          let content: string;
          try {
            content = await readFile(full, 'utf8');
          } catch {
            continue;
          }
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            if (line.includes(query)) {
              const rel = relative(ctx.workspaceRoot, full).split(sep).join('/');
              results.push(rel + ':' + (i + 1) + ': ' + line.trim());
              if (results.length >= limit) {
                return;
              }
            }
          }
        }
      };
      await walk(root);
      if (results.length === 0) {
        return { content: 'No matches for ' + JSON.stringify(query), isError: false };
      }
      return { content: results.join('\n'), isError: false };
    }
  };

  return [listFiles, searchCode];
}
```

- [x] **Step 5: Реализовать `src/tools/terminal.ts`**

```typescript
import { exec } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ToolEntry } from './types';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 30_000;

function resolveCwd(root: string, candidate: string | undefined): string {
  if (!candidate) {
    return root;
  }
  const target = isAbsolute(candidate) ? candidate : resolve(root, candidate);
  const rel = relative(resolve(root), target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('cwd escapes the workspace root: ' + candidate);
  }
  return target;
}

export function createTerminalTools(): ToolEntry[] {
  const runTerminal: ToolEntry = {
    name: 'run_terminal',
    description:
      'Run a shell command in the workspace root and return its output. Use it for build, test and git commands.',
    approval: 'always',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute.' },
        cwd: { type: 'string', description: 'Working directory relative to the workspace root.' },
        timeout_ms: {
          type: 'integer',
          minimum: 1000,
          maximum: MAX_TIMEOUT_MS,
          description: 'Timeout in milliseconds, default 60000.'
        }
      },
      required: ['command']
    },
    async execute(input, ctx) {
      const command = String(input['command'] ?? '');
      if (command.trim().length === 0) {
        return { content: 'run_terminal failed: command must not be empty', isError: true };
      }
      const timeout = Math.min(
        MAX_TIMEOUT_MS,
        Math.max(1000, Number(input['timeout_ms'] ?? DEFAULT_TIMEOUT_MS))
      );
      let cwd: string;
      try {
        cwd = resolveCwd(
          ctx.workspaceRoot,
          input['cwd'] === undefined ? undefined : String(input['cwd'])
        );
      } catch (error) {
        return {
          content: 'run_terminal failed: ' + (error instanceof Error ? error.message : String(error)),
          isError: true
        };
      }
      return await new Promise((resolvePromise) => {
        exec(
          command,
          { cwd, timeout, maxBuffer: 10 * 1024 * 1024, signal: ctx.signal, windowsHide: true },
          (error, stdout, stderr) => {
            const parts: string[] = [];
            if (stdout.trim().length > 0) {
              parts.push(stdout.trim());
            }
            if (stderr.trim().length > 0) {
              parts.push('[stderr] ' + stderr.trim());
            }
            let text = parts.join('\n');
            if (text.length > MAX_OUTPUT_CHARS) {
              text = text.slice(0, MAX_OUTPUT_CHARS) + '\n[output truncated]';
            }
            if (error) {
              const code = typeof error.code === 'number' ? error.code : 1;
              const detail = text.length > 0 ? text : error.message;
              resolvePromise({
                content: 'Command failed with exit code ' + code + '\n' + detail,
                isError: true
              });
              return;
            }
            resolvePromise({ content: text.length > 0 ? text : '[no output]', isError: false });
          }
        );
      });
    }
  };
  return [runTerminal];
}
```

- [x] **Step 6: Прогнать тесты и закоммитить**

Run: `npm test`
Expected: PASS.

```bash
git add -- src/tools/explore.ts src/tools/terminal.ts test/unit/tools-explore.test.ts test/unit/tools-terminal.test.ts
git commit -m "feat: инструменты обзора проекта и терминала"
```

---

### Task 7: Реестр инструментов и шлюз подтверждения

**Files:**
- Create: `src/tools/registry.ts`, `src/ui/approvals.ts`
- Test: `test/unit/registry.test.ts`

**Interfaces:**
- Consumes: `ToolEntry` из `src/tools/types.ts`
- Produces:
  - `class ToolRegistry { register(entry: ToolEntry): void; list(): ToolEntry[]; get(name: string): ToolEntry | undefined; toAnthropicTools(): ToolDefinition[] }`
  - `interface DiffPreview { path: string; lines: DiffLine[] }`
  - `interface ApprovalRequest { id: string; toolName: string; input: Record<string, unknown>; preview?: DiffPreview }`
  - `interface ApprovalDecision { approved: boolean; allowForSession: boolean }`
  - `class ApprovalGate { constructor(options: { autoApprove: string[]; request: (req: ApprovalRequest) => Promise<ApprovalDecision> }); approve(entry: ToolEntry, input: Record<string, unknown>): Promise<ApprovalDecision> }`

- [x] **Step 1: Написать падающий тест `test/unit/registry.test.ts`**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { ApprovalGate } from '../../src/ui/approvals';
import { ToolRegistry } from '../../src/tools/registry';
import type { ToolEntry } from '../../src/tools/types';

function makeTool(name: string, approval: 'never' | 'always'): ToolEntry {
  return {
    name,
    description: 'desc',
    approval,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: 'ok' })
  };
}

describe('ToolRegistry', () => {
  it('registers and finds tools', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('read_file', 'never'));
    expect(registry.get('read_file')?.name).toBe('read_file');
    expect(registry.list()).toHaveLength(1);
  });

  it('converts tools to the anthropic shape', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('read_file', 'never'));
    expect(registry.toAnthropicTools()[0]).toEqual({
      name: 'read_file',
      description: 'desc',
      input_schema: { type: 'object', properties: {} }
    });
  });
});

describe('ApprovalGate', () => {
  it('skips the request for tools that never need approval', async () => {
    const request = vi.fn();
    const gate = new ApprovalGate({ autoApprove: [], request });
    const decision = await gate.approve(makeTool('read_file', 'never'), {});
    expect(decision.approved).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('asks for approval for write tools', async () => {
    const request = vi.fn().mockResolvedValue({ approved: true, allowForSession: false });
    const gate = new ApprovalGate({ autoApprove: [], request });
    const decision = await gate.approve(makeTool('write_file', 'always'), {});
    expect(request).toHaveBeenCalledTimes(1);
    expect(decision.approved).toBe(true);
  });

  it('auto approves tools listed in autoApprove', async () => {
    const request = vi.fn();
    const gate = new ApprovalGate({ autoApprove: ['write_file'], request });
    const decision = await gate.approve(makeTool('write_file', 'always'), {});
    expect(request).not.toHaveBeenCalled();
    expect(decision.approved).toBe(true);
  });

  it('reports a rejection', async () => {
    const request = vi.fn().mockResolvedValue({ approved: false, allowForSession: false });
    const gate = new ApprovalGate({ autoApprove: [], request });
    const decision = await gate.approve(makeTool('write_file', 'always'), {});
    expect(decision.approved).toBe(false);
  });

  it('remembers a session approval', async () => {
    const request = vi.fn().mockResolvedValue({ approved: true, allowForSession: true });
    const gate = new ApprovalGate({ autoApprove: [], request });
    await gate.approve(makeTool('write_file', 'always'), {});
    await gate.approve(makeTool('write_file', 'always'), {});
    expect(request).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 2: Запустить, убедиться в падении**

Run: `npm test`
Expected: FAIL, модули `src/tools/registry` и `src/ui/approvals` не найдены.

- [x] **Step 3: Реализовать `src/tools/registry.ts`**

```typescript
import type { ToolDefinition } from '../api/types';
import type { ToolEntry } from './types';

export class ToolRegistry {
  private readonly entries = new Map<string, ToolEntry>();

  register(entry: ToolEntry): void {
    this.entries.set(entry.name, entry);
  }

  list(): ToolEntry[] {
    return [...this.entries.values()];
  }

  get(name: string): ToolEntry | undefined {
    return this.entries.get(name);
  }

  toAnthropicTools(): ToolDefinition[] {
    return this.list().map((entry) => ({
      name: entry.name,
      description: entry.description,
      input_schema: entry.inputSchema
    }));
  }
}
```

- [x] **Step 4: Реализовать `src/ui/approvals.ts`**

```typescript
import type { DiffLine } from '../tools/diff';
import type { ToolEntry } from '../tools/types';

export interface DiffPreview {
  path: string;
  lines: DiffLine[];
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  preview?: DiffPreview;
}

export interface ApprovalDecision {
  approved: boolean;
  allowForSession: boolean;
}

export class ApprovalGate {
  private readonly sessionApproved = new Set<string>();
  private readonly autoApprove: string[];
  private readonly request: (request: ApprovalRequest) => Promise<ApprovalDecision>;

  constructor(options: {
    autoApprove: string[];
    request: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  }) {
    this.autoApprove = options.autoApprove;
    this.request = options.request;
  }

  async approve(entry: ToolEntry, input: Record<string, unknown>): Promise<ApprovalDecision> {
    if (entry.approval === 'never') {
      return { approved: true, allowForSession: false };
    }
    if (this.autoApprove.includes(entry.name) || this.sessionApproved.has(entry.name)) {
      return { approved: true, allowForSession: false };
    }
    const decision = await this.request({
      id: entry.name + '-' + Date.now().toString(36),
      toolName: entry.name,
      input
    });
    if (decision.approved && decision.allowForSession) {
      this.sessionApproved.add(entry.name);
    }
    return decision;
  }
}
```

- [x] **Step 5: Прогнать тесты и закоммитить**

Run: `npm test`
Expected: PASS.

```bash
git add -- src/tools/registry.ts src/ui/approvals.ts test/unit/registry.test.ts
git commit -m "feat: реестр инструментов и шлюз подтверждения"
```


---

### Task 8: Агентный цикл

**Files:**
- Create: `src/agent/agent.ts`
- Test: `test/unit/agent.test.ts`

**Interfaces:**
- Consumes: `MiniMaxClient` (Task 4), `ToolRegistry` и `ApprovalGate` (Task 7), `ChatRequest`/`AnthropicMessage` (Task 3)
- Produces:
  - `type AgentEvent` со вариантами `assistant_text`, `assistant_thinking`, `tool_start`, `tool_end`, `approval_requested`, `approval_resolved`, `done`, `error`
  - `interface AgentRunResult { messages: AnthropicMessage[]; stopReason: StopReason; usage: Usage }`
  - `interface AgentOptions { client: MiniMaxClient; registry: ToolRegistry; approval: ApprovalGate; model: string; maxTokens: number; maxIterations: number; effort?: EffortLevel; thinking?: 'adaptive'; systemPrompt: string; workspaceRoot: string; logger: Logger; backups: BackupStore; onEvent: (event: AgentEvent) => void }`
  - `class Agent { constructor(options: AgentOptions); run(userText: string, history: AnthropicMessage[]): Promise<AgentRunResult>; abort(): void }`

- [x] **Step 1: Написать падающий тест `test/unit/agent.test.ts`**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { Agent, type AgentEvent } from '../../src/agent/agent';
import type { MiniMaxClient } from '../../src/api/client';
import type { AnthropicMessage, ChatRequest, StreamEvent } from '../../src/api/types';
import { InMemoryBackupStore } from '../../src/storage/backups';
import { ToolRegistry } from '../../src/tools/registry';
import { ApprovalGate, type ApprovalDecision } from '../../src/ui/approvals';

class FakeClient implements MiniMaxClient {
  readonly requests: ChatRequest[] = [];
  private index = 0;

  constructor(private readonly responses: StreamEvent[][]) {}

  async *stream(request: ChatRequest): AsyncGenerator<StreamEvent> {
    this.requests.push(request);
    const response = this.responses[this.index];
    this.index += 1;
    if (!response) {
      throw new Error('no scripted response left');
    }
    for (const event of response) {
      yield event;
    }
  }
}

function textResponse(text: string, stopReason: 'end_turn' | 'tool_use' = 'end_turn'): StreamEvent[] {
  return [
    { type: 'text_delta', text },
    {
      type: 'message_stop',
      stopReason,
      usage: { inputTokens: 10, outputTokens: 5 },
      blocks: [{ type: 'text', text }]
    }
  ];
}

function toolResponse(name: string, input: Record<string, unknown>): StreamEvent[] {
  const block = { type: 'tool_use' as const, id: 'toolu_1', name, input };
  return [
    { type: 'tool_use_start', id: 'toolu_1', name },
    {
      type: 'message_stop',
      stopReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 5 },
      blocks: [block]
    }
  ];
}

function makeAgent(
  client: FakeClient,
  decide: ApprovalDecision = { approved: true, allowForSession: false },
  registry?: ToolRegistry
): { agent: Agent; events: AgentEvent[]; registry: ToolRegistry } {
  const events: AgentEvent[] = [];
  const tools = registry ?? new ToolRegistry();
  tools.register({
    name: 'read_file',
    description: 'read',
    approval: 'never',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: 'file content' })
  });
  tools.register({
    name: 'write_file',
    description: 'write',
    approval: 'always',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: 'written' })
  });
  const agent = new Agent({
    client,
    registry: tools,
    approval: new ApprovalGate({ autoApprove: [], request: async () => decide }),
    model: 'MiniMax-M3.1-Flash',
    maxTokens: 32000,
    maxIterations: 5,
    effort: 'max',
    systemPrompt: 'system',
    workspaceRoot: '/tmp/root',
    logger: { info: () => undefined, error: () => undefined },
    backups: new InMemoryBackupStore(),
    onEvent: (event) => events.push(event)
  });
  return { agent, events, registry: tools };
}

describe('Agent', () => {
  it('returns assistant text without calling tools', async () => {
    const client = new FakeClient([textResponse('hello')]);
    const { agent, events } = makeAgent(client);
    const result = await agent.run('hi', []);
    expect(result.stopReason).toBe('end_turn');
    expect(result.messages).toHaveLength(2);
    expect(events.some((e) => e.type === 'assistant_text')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('executes a tool and feeds the result back', async () => {
    const client = new FakeClient([toolResponse('read_file', { path: 'a.ts' }), textResponse('done')]);
    const { agent, events } = makeAgent(client);
    const result = await agent.run('read it', []);
    expect(client.requests).toHaveLength(2);
    const second = client.requests[1]!;
    const userMessage = second.messages[second.messages.length - 1]!;
    expect(userMessage.role).toBe('user');
    const block = userMessage.content[0]!;
    expect(block.type).toBe('tool_result');
    if (block.type === 'tool_result') {
      expect(block.content).toBe('file content');
    }
    expect(events.some((e) => e.type === 'tool_start')).toBe(true);
    expect(events.some((e) => e.type === 'tool_end')).toBe(true);
    expect(result.messages.length).toBeGreaterThan(2);
  });

  it('asks for approval and skips the tool when rejected', async () => {
    const client = new FakeClient([toolResponse('write_file', { path: 'a.ts', content: 'x' }), textResponse('ok')]);
    const { agent, events } = makeAgent(client, { approved: false, allowForSession: false });
    await agent.run('write it', []);
    expect(events.some((e) => e.type === 'approval_requested')).toBe(true);
    const toolEnd = events.find((e) => e.type === 'tool_end');
    expect(toolEnd?.type === 'tool_end' && toolEnd.isError).toBe(true);
  });

  it('keeps thinking blocks in the assistant message', async () => {
    const client = new FakeClient([
      [
        { type: 'thinking_delta', text: 'thinking hard' },
        {
          type: 'message_stop',
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
          blocks: [
            { type: 'thinking', thinking: 'thinking hard' },
            { type: 'text', text: 'answer' }
          ]
        }
      ]
    ]);
    const { agent } = makeAgent(client);
    const result = await agent.run('q', []);
    const assistant = result.messages[1]!;
    expect(assistant.content[0]?.type).toBe('thinking');
  });

  it('stops after maxIterations', async () => {
    const responses = Array.from({ length: 10 }, () => toolResponse('read_file', { path: 'a.ts' }));
    const client = new FakeClient(responses);
    const { agent } = makeAgent(client);
    const result = await agent.run('loop', []);
    expect(client.requests.length).toBe(5);
    expect(result.stopReason).toBe('max_iterations');
  });

  it('refuses to run the same tool call more than three times', async () => {
    const responses = Array.from({ length: 6 }, () => toolResponse('read_file', { path: 'a.ts' }));
    const client = new FakeClient(responses);
    const { agent } = makeAgent(client);
    await agent.run('loop', []);
    const lastRequest = client.requests[client.requests.length - 1]!;
    const lastMessage = lastRequest.messages[lastRequest.messages.length - 1]!;
    const block = lastMessage.content[0]!;
    expect(block.type === 'tool_result' && block.is_error).toBe(true);
  });
});
```

- [x] **Step 2: Запустить, убедиться в падении**

Run: `npm test`
Expected: FAIL, модуль `src/agent/agent` не найден.

- [x] **Step 3: Реализовать `src/agent/agent.ts`**

```typescript
import type { MiniMaxClient } from '../api/client';
import { MiniMaxApiError } from '../api/errors';
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  EffortLevel,
  StopReason,
  StreamEvent,
  Usage
} from '../api/types';
import type { Logger } from '../logger';
import type { BackupStore } from '../storage/backups';
import type { ToolRegistry } from '../tools/registry';
import type { ApprovalGate } from '../ui/approvals';

export type AgentEvent =
  | { type: 'assistant_text'; text: string }
  | { type: 'assistant_thinking'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; id: string; name: string; content: string; isError: boolean }
  | { type: 'approval_requested'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'approval_resolved'; id: string; approved: boolean }
  | { type: 'done'; stopReason: StopReason; usage: Usage }
  | { type: 'error'; message: string };

export interface AgentRunResult {
  messages: AnthropicMessage[];
  stopReason: StopReason;
  usage: Usage;
}

export interface AgentOptions {
  client: MiniMaxClient;
  registry: ToolRegistry;
  approval: ApprovalGate;
  model: string;
  maxTokens: number;
  maxIterations: number;
  effort?: EffortLevel;
  thinking?: 'adaptive';
  systemPrompt: string;
  workspaceRoot: string;
  logger: Logger;
  backups: BackupStore;
  onEvent: (event: AgentEvent) => void;
}

const MAX_IDENTICAL_CALLS = 3;
const RETRY_DELAYS_MS = [1000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signatureOf(name: string, input: Record<string, unknown>): string {
  return name + ':' + JSON.stringify(input);
}

export class Agent {
  private readonly options: AgentOptions;
  private readonly controller = new AbortController();

  constructor(options: AgentOptions) {
    this.options = options;
  }

  abort(): void {
    this.controller.abort();
  }

  async run(userText: string, history: AnthropicMessage[]): Promise<AgentRunResult> {
    const messages: AnthropicMessage[] = [
      ...history,
      { role: 'user', content: [{ type: 'text', text: userText }] }
    ];
    const identicalCalls = new Map<string, number>();
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };

    for (let iteration = 0; iteration < this.options.maxIterations; iteration++) {
      const streamed = await this.streamWithRetry(messages);
      const blocks = streamed.blocks;
      usage = streamed.usage;

      messages.push({ role: 'assistant', content: blocks });

      const toolUses = blocks.filter(
        (block): block is Extract<AnthropicContentBlock, { type: 'tool_use' }> =>
          block.type === 'tool_use'
      );
      if (toolUses.length === 0) {
        return { messages, stopReason: streamed.stopReason, usage };
      }

      const results: AnthropicContentBlock[] = [];
      for (const toolUse of toolUses) {
        const signature = signatureOf(toolUse.name, toolUse.input);
        const seen = (identicalCalls.get(signature) ?? 0) + 1;
        identicalCalls.set(signature, seen);

        if (seen > MAX_IDENTICAL_CALLS) {
          const message =
            'The same tool call was repeated ' +
            MAX_IDENTICAL_CALLS +
            ' times with identical arguments. Change the approach instead of repeating it.';
          results.push({ type: 'tool_result', tool_use_id: toolUse.id, content: message, is_error: true });
          continue;
        }

        const entry = this.options.registry.get(toolUse.name);
        if (!entry) {
          results.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: 'Unknown tool: ' + toolUse.name,
            is_error: true
          });
          continue;
        }

        this.options.onEvent({
          type: 'approval_requested',
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input
        });
        const decision = await this.options.approval.approve(entry, toolUse.input);
        this.options.onEvent({
          type: 'approval_resolved',
          id: toolUse.id,
          approved: decision.approved
        });

        if (!decision.approved) {
          results.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: 'Rejected by the user.',
            is_error: true
          });
          continue;
        }

        this.options.onEvent({
          type: 'tool_start',
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input
        });

        let content: string;
        let isError = false;
        try {
          const result = await entry.execute(toolUse.input, {
            workspaceRoot: this.options.workspaceRoot,
            signal: this.controller.signal,
            logger: this.options.logger,
            backups: this.options.backups
          });
          content = result.content;
          isError = result.isError === true;
        } catch (error) {
          content = error instanceof Error ? error.message : String(error);
          isError = true;
        }

        this.options.onEvent({
          type: 'tool_end',
          id: toolUse.id,
          name: toolUse.name,
          content,
          isError
        });
        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content,
          is_error: isError
        });
      }

      messages.push({ role: 'user', content: results });
    }

    return { messages, stopReason: 'max_iterations', usage };
  }

  private async streamWithRetry(
    messages: AnthropicMessage[]
  ): Promise<{ blocks: AnthropicContentBlock[]; stopReason: StopReason; usage: Usage }> {
    let attempt = 0;
    for (;;) {
      let emitted = false;
      let blocks: AnthropicContentBlock[] = [];
      let stopReason: StopReason = 'end_turn';
      let usage: Usage = { inputTokens: 0, outputTokens: 0 };
      try {
        const stream = this.options.client.stream(
          {
            model: this.options.model,
            maxTokens: this.options.maxTokens,
            system: this.options.systemPrompt,
            messages,
            tools: this.options.registry.toAnthropicTools(),
            effort: this.options.effort,
            thinking: this.options.thinking,
            signal: this.controller.signal
          },
          { signal: this.controller.signal }
        );
        for await (const event of stream) {
          this.handleEvent(event);
          if (event.type === 'text_delta' || event.type === 'thinking_delta') {
            emitted = true;
          }
          if (event.type === 'message_stop') {
            blocks = event.blocks;
            stopReason = event.stopReason;
            usage = event.usage;
          }
        }
        return { blocks, stopReason, usage };
      } catch (error) {
        const retryable = error instanceof MiniMaxApiError && error.retryable;
        if (!retryable || emitted || attempt >= RETRY_DELAYS_MS.length) {
          const message = error instanceof Error ? error.message : String(error);
          this.options.onEvent({ type: 'error', message });
          throw error;
        }
        const delay = RETRY_DELAYS_MS[attempt]!;
        attempt += 1;
        this.options.logger.info('retrying MiniMax request in ' + delay + 'ms: ' + error.message);
        await sleep(delay);
      }
    }
  }

  private handleEvent(event: StreamEvent): void {
    if (event.type === 'text_delta') {
      this.options.onEvent({ type: 'assistant_text', text: event.text });
    } else if (event.type === 'thinking_delta') {
      this.options.onEvent({ type: 'assistant_thinking', text: event.text });
    }
  }
}
```

- [x] **Step 4: Прогнать тесты и закоммитить**

Run: `npm test`
Expected: PASS.

```bash
git add -- src/agent/agent.ts test/unit/agent.test.ts
git commit -m "feat: агентный цикл с вызовом инструментов и ретраями"
```

---

### Task 9: System prompt и сборка контекста

**Files:**
- Create: `src/agent/prompt.ts`, `src/agent/context.ts`
- Test: `test/unit/context.test.ts`

**Interfaces:**
- Produces:
  - `interface PromptContext { workspaceRoot: string; os: string; shell: string; rulesText: string; treeText: string; stackText: string; openFilesText: string }`
  - `function buildSystemPrompt(context: PromptContext): string`
  - `interface WorkspaceSnapshot { root: string; rules: Array<{ path: string; content: string }>; tree: string[]; stack: string[]; openFiles: Array<{ path: string; content: string }> }`
  - `async function buildWorkspaceSnapshot(root: string, options: { includeOpenFiles: boolean }): Promise<WorkspaceSnapshot>`
  - `function renderSnapshot(snapshot: WorkspaceSnapshot): string`
  - `const RULE_FILES: string[]`

- [x] **Step 1: Написать падающий тест `test/unit/context.test.ts`**

```typescript
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWorkspaceSnapshot, renderSnapshot } from '../../src/agent/context';
import { buildSystemPrompt } from '../../src/agent/prompt';

describe('buildWorkspaceSnapshot', () => {
  it('reads project rule files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'AGENTS.md'), 'always be careful', 'utf8');
    const snapshot = await buildWorkspaceSnapshot(root, { includeOpenFiles: false });
    expect(snapshot.rules[0]?.path).toBe('AGENTS.md');
    expect(snapshot.rules[0]?.content).toContain('always be careful');
  });

  it('detects the stack from manifests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'package.json'), '{"name":"demo"}', 'utf8');
    const snapshot = await buildWorkspaceSnapshot(root, { includeOpenFiles: false });
    expect(snapshot.stack).toContain('package.json');
  });

  it('skips ignored directories in the tree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'x.js'), 'x', 'utf8');
    const snapshot = await buildWorkspaceSnapshot(root, { includeOpenFiles: false });
    expect(snapshot.tree.join('\n')).not.toContain('node_modules');
  });
});

describe('renderSnapshot', () => {
  it('renders rules and tree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'AGENTS.md'), 'rule text', 'utf8');
    const snapshot = await buildWorkspaceSnapshot(root, { includeOpenFiles: false });
    const text = renderSnapshot(snapshot);
    expect(text).toContain('rule text');
  });
});

describe('buildSystemPrompt', () => {
  it('mentions the tool protocol and the environment', () => {
    const prompt = buildSystemPrompt({
      workspaceRoot: '/tmp/demo',
      os: 'win32',
      shell: 'powershell',
      rulesText: 'rules here',
      treeText: 'src/',
      stackText: 'package.json',
      openFilesText: 'src/a.ts'
    });
    expect(prompt).toContain('read_file');
    expect(prompt).toContain('/tmp/demo');
    expect(prompt).toContain('rules here');
  });
});
```

- [x] **Step 2: Запустить, убедиться в падении**

Run: `npm test`
Expected: FAIL, модули `src/agent/context` и `src/agent/prompt` не найдены.

- [x] **Step 3: Реализовать `src/agent/prompt.ts`**

```typescript
export interface PromptContext {
  workspaceRoot: string;
  os: string;
  shell: string;
  rulesText: string;
  treeText: string;
  stackText: string;
  openFilesText: string;
}

export function buildSystemPrompt(context: PromptContext): string {
  const sections: string[] = [
    'You are MiniMax Agent, a coding agent working inside Visual Studio Code.',
    '',
    'How you work:',
    '- Investigate before you change anything. Use list_files and search_code to understand the project, then read_file to load the exact files you need.',
    '- Make the smallest change that solves the task. Prefer edit_file over write_file when a part of a file changes.',
    '- Every write_file and edit_file call shows the user a diff and waits for approval. run_terminal always waits for approval too.',
    '- After a tool returns, use its output. Do not guess file contents you have not read.',
    '- Report what you changed and what you verified. State plainly when something failed.',
    '',
    'Tools you can call:',
    '- read_file(path, start_line?, end_line?) - read a text file with line numbers',
    '- write_file(path, content) - create a file or replace its whole content',
    '- edit_file(path, old_string, new_string, replace_all?) - replace an exact string',
    '- list_files(path?, depth?) - list the project layout',
    '- search_code(query, path?, max_results?) - search for a literal string',
    '- run_terminal(command, cwd?, timeout_ms?) - run a shell command in the workspace root',
    '',
    'Environment:',
    '- Workspace root: ' + context.workspaceRoot,
    '- OS: ' + context.os,
    '- Shell: ' + context.shell,
    '- Paths in tool arguments are relative to the workspace root.'
  ];

  if (context.stackText.length > 0) {
    sections.push('', 'Project manifests detected:', context.stackText);
  }
  if (context.treeText.length > 0) {
    sections.push('', 'Project layout:', context.treeText);
  }
  if (context.openFilesText.length > 0) {
    sections.push('', 'Files open in the editor:', context.openFilesText);
  }
  if (context.rulesText.length > 0) {
    sections.push('', 'Project rules that you must follow:', context.rulesText);
  }

  return sections.join('\n');
}
```

- [x] **Step 4: Реализовать `src/agent/context.ts`**

```typescript
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { IGNORED_DIRS } from '../tools/explore';

export const RULE_FILES = [
  'AGENTS.md',
  '.github/copilot-instructions.md',
  'CLAUDE.md',
  '.cursorrules'
];

const MANIFEST_FILES = [
  'package.json',
  'tsconfig.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'CMakeLists.txt'
];

const MAX_RULES_CHARS = 20_000;
const MAX_TREE_ENTRIES = 300;
const MAX_OPEN_FILE_CHARS = 20_000;

export interface WorkspaceSnapshot {
  root: string;
  rules: Array<{ path: string; content: string }>;
  tree: string[];
  stack: string[];
  openFiles: Array<{ path: string; content: string }>;
}

function isIgnored(name: string): boolean {
  return IGNORED_DIRS.includes(name) || name.startsWith('.');
}

export async function buildWorkspaceSnapshot(
  root: string,
  options: { includeOpenFiles: boolean; openFiles?: Array<{ path: string }> }
): Promise<WorkspaceSnapshot> {
  const rules: WorkspaceSnapshot['rules'] = [];
  for (const ruleFile of RULE_FILES) {
    try {
      const content = await readFile(join(root, ruleFile), 'utf8');
      rules.push({ path: ruleFile, content });
    } catch {
      continue;
    }
  }

  const stack: string[] = [];
  for (const manifest of MANIFEST_FILES) {
    try {
      await readFile(join(root, manifest), 'utf8');
      stack.push(manifest);
    } catch {
      continue;
    }
  }

  const tree: string[] = [];
  const walk = async (dir: string, level: number): Promise<void> => {
    if (level > 2 || tree.length >= MAX_TREE_ENTRIES) {
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (tree.length >= MAX_TREE_ENTRIES) {
        return;
      }
      if (isIgnored(entry.name)) {
        continue;
      }
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join('/');
      tree.push(entry.isDirectory() ? rel + '/' : rel);
      if (entry.isDirectory()) {
        await walk(full, level + 1);
      }
    }
  };
  await walk(root, 1);

  const openFiles: WorkspaceSnapshot['openFiles'] = [];
  if (options.includeOpenFiles && options.openFiles) {
    for (const file of options.openFiles) {
      try {
        const content = await readFile(join(root, file.path), 'utf8');
        openFiles.push({ path: file.path, content: content.slice(0, MAX_OPEN_FILE_CHARS) });
      } catch {
        continue;
      }
    }
  }

  return { root, rules, tree, stack, openFiles };
}

export function renderSnapshot(snapshot: WorkspaceSnapshot): string {
  const parts: string[] = [];
  for (const rule of snapshot.rules) {
    parts.push('--- ' + rule.path + ' ---\n' + rule.content);
  }
  return parts.join('\n\n');
}
```

- [x] **Step 5: Прогнать тесты и закоммитить**

Run: `npm test`
Expected: PASS.

```bash
git add -- src/agent/prompt.ts src/agent/context.ts test/unit/context.test.ts
git commit -m "feat: system prompt и сборка контекста проекта"
```


---

### Task 10: Протокол UI, панель и React-интерфейс

**Files:**
- Create: `src/ui/protocol.ts`, `src/ui/panel.ts`
- Create: `src/ui/webview/index.html`, `src/ui/webview/main.tsx`, `src/ui/webview/App.tsx`, `src/ui/webview/strings.ts`, `src/ui/webview/styles.css`
- Create: `src/ui/webview/components/MessageList.tsx`, `Composer.tsx`, `ToolCard.tsx`, `DiffView.tsx`, `ApprovalCard.tsx`, `ThinkingBlock.tsx`, `Header.tsx`

**Interfaces:**
- Produces:
  - `src/ui/protocol.ts`: `type ExtToWeb`, `type WebToExt`, `interface UiMessage`, `interface UiSession`, `interface UiSessionSummary`, `interface UiState`, `interface UiFile`, `interface UiDiffLine`
  - `class AgentPanelProvider implements vscode.WebviewViewProvider` с конструктором `(options: { onMessage: (message: WebToExt) => void })`
  - `function postToWebview(view: vscode.Webview, message: ExtToWeb): void`
  - React-приложение принимает проп `initial: UiState` и вызывает `vscode.postMessage` с `WebToExt`

- [x] **Step 1: Создать `src/ui/protocol.ts`**

```typescript
import type { EffortLevel } from '../api/types';
import type { ModelInfo } from '../config/models';

export type AgentState = 'idle' | 'thinking' | 'streaming' | 'tool' | 'error';

export interface UiDiffLine {
  type: 'context' | 'add' | 'remove';
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface UiToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  content?: string;
  isError?: boolean;
  running?: boolean;
}

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text?: string;
  thinking?: string;
  tool?: UiToolCall;
  pendingApproval?: { id: string; name: string; input: Record<string, unknown>; preview?: { path: string; lines: UiDiffLine[] } };
}

export interface UiSession {
  id: string;
  title: string;
  messages: UiMessage[];
}

export interface UiSessionSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export interface UiFile {
  path: string;
  label: string;
}

export interface UiState {
  sessions: UiSessionSummary[];
  activeSessionId: string | undefined;
  messages: UiMessage[];
  model: string;
  models: ModelInfo[];
  effort: EffortLevel;
  state: AgentState;
  tokens: number;
  hasApiKey: boolean;
}

export type ExtToWeb =
  | { type: 'init'; state: UiState }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; id: string; name: string; content: string; isError: boolean }
  | { type: 'approval_request'; id: string; name: string; input: Record<string, unknown>; preview?: { path: string; lines: UiDiffLine[] } }
  | { type: 'approval_resolved'; id: string; approved: boolean }
  | { type: 'status'; state: AgentState; tokens?: number }
  | { type: 'error'; message: string }
  | { type: 'session_loaded'; session: UiSession }
  | { type: 'sessions'; sessions: UiSessionSummary[] }
  | { type: 'models'; models: ModelInfo[]; selected: string }
  | { type: 'files'; requestId: string; files: UiFile[] };

export type WebToExt =
  | { type: 'ready' }
  | { type: 'send'; text: string; mentions: string[] }
  | { type: 'stop' }
  | { type: 'approve'; id: string; allowForSession: boolean }
  | { type: 'reject'; id: string }
  | { type: 'new_session' }
  | { type: 'select_session'; id: string }
  | { type: 'delete_session'; id: string }
  | { type: 'set_model'; model: string }
  | { type: 'set_effort'; effort: EffortLevel }
  | { type: 'pick_files'; requestId: string }
  | { type: 'files_picked'; requestId: string; files: string[] }
  | { type: 'open_diff'; id: string }
  | { type: 'undo_last_change' };
```

- [x] **Step 2: Создать `src/ui/webview/index.html` и `src/ui/webview/main.tsx`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MiniMax Agent</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="./main.js"></script>
  </body>
</html>
```

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const container = document.getElementById('root');
if (!container) {
  throw new Error('root element is missing');
}

createRoot(container).render(
  <StrictMode>
    <App vscode={acquireVsCodeApi()} />
  </StrictMode>
);
```

- [x] **Step 3: Создать `src/ui/webview/strings.ts`**

```typescript
export const STRINGS = {
  appName: 'MiniMax Agent',
  placeholder: 'Ask MiniMax to change your code. Use @ to attach files.',
  send: 'Send',
  stop: 'Stop',
  newChat: 'New chat',
  model: 'Model',
  effort: 'Thinking',
  approve: 'Allow',
  reject: 'Reject',
  alwaysAllow: 'Always allow in this session',
  thinking: 'Thinking',
  toolRunning: 'Running',
  toolDone: 'Done',
  toolFailed: 'Failed',
  noMessages: 'Ask a question or describe a task. The agent reads files, runs commands and proposes edits.',
  noApiKey: 'No API key yet. Run "MiniMax: Add API Key" from the command palette.',
  history: 'History',
  undo: 'Undo last change',
  tokens: 'tokens'
} as const;
```

- [x] **Step 4: Создать компоненты `src/ui/webview/components/`**

```tsx
// ThinkingBlock.tsx
import { useState } from 'react';
import { STRINGS } from '../strings';

export function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking">
      <button className="thinking-toggle" onClick={() => setOpen((v) => !v)}>
        {STRINGS.thinking} {open ? '▾' : '▸'}
      </button>
      {open ? <pre className="thinking-body">{text}</pre> : null}
    </div>
  );
}
```

```tsx
// DiffView.tsx
import type { UiDiffLine } from '../protocol';

export function DiffView({ path, lines }: { path: string; lines: UiDiffLine[] }) {
  return (
    <div className="diff">
      <div className="diff-path">{path}</div>
      <pre className="diff-body">
        {lines.map((line, index) => (
          <div key={index} className={'diff-line diff-' + line.type}>
            <span className="diff-marker">{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</span>
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
```

```tsx
// ToolCard.tsx
import type { UiToolCall } from '../protocol';
import { STRINGS } from '../strings';

export function ToolCard({ tool }: { tool: UiToolCall }) {
  const status = tool.running ? STRINGS.toolRunning : tool.isError ? STRINGS.toolFailed : STRINGS.toolDone;
  return (
    <div className={'tool-card' + (tool.isError ? ' tool-error' : '')}>
      <div className="tool-head">
        <span className="tool-name">{tool.name}</span>
        <span className="tool-status">{status}</span>
      </div>
      <pre className="tool-input">{JSON.stringify(tool.input, null, 2)}</pre>
      {tool.content ? <pre className="tool-output">{tool.content}</pre> : null}
    </div>
  );
}
```

```tsx
// ApprovalCard.tsx
import type { UiMessage } from '../protocol';
import { STRINGS } from '../strings';
import { DiffView } from './DiffView';

export function ApprovalCard({
  message,
  onApprove,
  onReject
}: {
  message: UiMessage;
  onApprove: (allowForSession: boolean) => void;
  onReject: () => void;
}) {
  const pending = message.pendingApproval;
  if (!pending) {
    return null;
  }
  return (
    <div className="approval">
      <div className="approval-title">Run {pending.name}?</div>
      {pending.preview ? (
        <DiffView path={pending.preview.path} lines={pending.preview.lines} />
      ) : (
        <pre className="tool-input">{JSON.stringify(pending.input, null, 2)}</pre>
      )}
      <div className="approval-actions">
        <button onClick={() => onApprove(false)}>{STRINGS.approve}</button>
        <button onClick={() => onApprove(true)}>{STRINGS.alwaysAllow}</button>
        <button className="secondary" onClick={onReject}>
          {STRINGS.reject}
        </button>
      </div>
    </div>
  );
}
```

```tsx
// Composer.tsx
import { useState } from 'react';
import { STRINGS } from '../strings';

export function Composer({
  busy,
  onSend,
  onStop,
  onPickFiles
}: {
  busy: boolean;
  onSend: (text: string, mentions: string[]) => void;
  onStop: () => void;
  onPickFiles: () => void;
}) {
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);

  const submit = (): void => {
    if (text.trim().length === 0) {
      return;
    }
    onSend(text.trim(), mentions);
    setText('');
    setMentions([]);
  };

  return (
    <div className="composer">
      {mentions.length > 0 ? (
        <div className="mentions">
          {mentions.map((path) => (
            <span className="mention" key={path}>
              {path}
            </span>
          ))}
        </div>
      ) : null}
      <textarea
        value={text}
        placeholder={STRINGS.placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-actions">
        <button className="secondary" onClick={onPickFiles}>
          Attach files
        </button>
        {busy ? (
          <button onClick={onStop}>{STRINGS.stop}</button>
        ) : (
          <button onClick={submit}>{STRINGS.send}</button>
        )}
      </div>
    </div>
  );
}
```

```tsx
// MessageList.tsx
import MarkdownIt from 'markdown-it';
import type { UiMessage } from '../protocol';
import { ApprovalCard } from './ApprovalCard';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCard } from './ToolCard';

const md = new MarkdownIt({ breaks: true, linkify: true });

export function MessageList({
  messages,
  onApprove,
  onReject
}: {
  messages: UiMessage[];
  onApprove: (id: string, allowForSession: boolean) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div className="messages">
      {messages.map((message) => (
        <div key={message.id} className={'message message-' + message.role}>
          {message.role === 'user' ? (
            <div className="bubble user-bubble">{message.text}</div>
          ) : null}
          {message.role === 'assistant' ? (
            <div className="assistant-body">
              {message.thinking ? <ThinkingBlock text={message.thinking} /> : null}
              {message.text ? (
                <div className="markdown" dangerouslySetInnerHTML={{ __html: md.render(message.text) }} />
              ) : null}
            </div>
          ) : null}
          {message.role === 'tool' && message.tool ? <ToolCard tool={message.tool} /> : null}
          {message.pendingApproval ? (
            <ApprovalCard
              message={message}
              onApprove={(allowForSession) => onApprove(message.pendingApproval!.id, allowForSession)}
              onReject={() => onReject(message.pendingApproval!.id)}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
```

```tsx
// Header.tsx
import type { ModelInfo } from '../../config/models';
import type { EffortLevel } from '../../api/types';
import { STRINGS } from '../strings';

export function Header({
  models,
  model,
  effort,
  state,
  tokens,
  hasApiKey,
  onModel,
  onEffort,
  onNewChat
}: {
  models: ModelInfo[];
  model: string;
  effort: EffortLevel;
  state: string;
  tokens: number;
  hasApiKey: boolean;
  onModel: (model: string) => void;
  onEffort: (effort: EffortLevel) => void;
  onNewChat: () => void;
}) {
  return (
    <div className="header">
      <div className="header-row">
        <span className="title">{STRINGS.appName}</span>
        <button className="secondary" onClick={onNewChat}>
          {STRINGS.newChat}
        </button>
      </div>
      <div className="header-row">
        <select value={model} onChange={(event) => onModel(event.target.value)}>
          {models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <select value={effort} onChange={(event) => onEffort(event.target.value as EffortLevel)}>
          {['low', 'medium', 'high', 'xhigh', 'max'].map((level) => (
            <option key={level} value={level}>
              {STRINGS.effort}: {level}
            </option>
          ))}
        </select>
      </div>
      <div className="header-row muted">
        <span>{state}</span>
        <span>
          {tokens} {STRINGS.tokens}
        </span>
      </div>
      {!hasApiKey ? <div className="warning">{STRINGS.noApiKey}</div> : null}
    </div>
  );
}
```

- [x] **Step 5: Создать `src/ui/webview/App.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { ExtToWeb, UiMessage, UiState, WebToExt } from '../protocol';
import { Composer } from './components/Composer';
import { Header } from './components/Header';
import { MessageList } from './components/MessageList';

interface VsCodeApi {
  postMessage(message: WebToExt): void;
}

const EMPTY_STATE: UiState = {
  sessions: [],
  activeSessionId: undefined,
  messages: [],
  model: 'MiniMax-M3.1-Flash',
  models: [],
  effort: 'max',
  state: 'idle',
  tokens: 0,
  hasApiKey: false
};

export function App({ vscode }: { vscode: VsCodeApi }) {
  const [state, setState] = useState<UiState>(EMPTY_STATE);
  const [messages, setMessages] = useState<UiMessage[]>([]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtToWeb>): void => {
      const message = event.data;
      if (message.type === 'init') {
        setState(message.state);
        setMessages(message.state.messages);
        return;
      }
      if (message.type === 'text_delta') {
        setMessages((prev) => appendToLastAssistant(prev, 'text', message.text));
        return;
      }
      if (message.type === 'thinking_delta') {
        setMessages((prev) => appendToLastAssistant(prev, 'thinking', message.text));
        return;
      }
      if (message.type === 'tool_start') {
        setMessages((prev) => [
          ...prev,
          {
            id: message.id,
            role: 'tool',
            tool: { id: message.id, name: message.name, input: message.input, running: true }
          }
        ]);
        return;
      }
      if (message.type === 'tool_end') {
        setMessages((prev) =>
          prev.map((item) =>
            item.tool && item.tool.id === message.id
              ? {
                  ...item,
                  tool: { ...item.tool, content: message.content, isError: message.isError, running: false }
                }
              : item
          )
        );
        return;
      }
      if (message.type === 'approval_request') {
        setMessages((prev) => [
          ...prev,
          {
            id: 'approval-' + message.id,
            role: 'assistant',
            pendingApproval: {
              id: message.id,
              name: message.name,
              input: message.input,
              preview: message.preview
            }
          }
        ]);
        return;
      }
      if (message.type === 'approval_resolved') {
        setMessages((prev) => prev.filter((item) => item.pendingApproval?.id !== message.id));
        return;
      }
      if (message.type === 'status') {
        setState((prev) => ({
          ...prev,
          state: message.state,
          tokens: message.tokens ?? prev.tokens
        }));
        return;
      }
      if (message.type === 'session_loaded') {
        setMessages(message.session.messages);
        return;
      }
      if (message.type === 'sessions') {
        setState((prev) => ({ ...prev, sessions: message.sessions }));
        return;
      }
      if (message.type === 'models') {
        setState((prev) => ({ ...prev, models: message.models, model: message.selected }));
        return;
      }
      if (message.type === 'error') {
        setMessages((prev) => [
          ...prev,
          { id: 'error-' + Date.now(), role: 'assistant', text: message.message }
        ]);
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [vscode]);

  const busy = state.state !== 'idle' && state.state !== 'error';

  const body = useMemo(() => {
    if (messages.length === 0) {
      return <div className="empty">Ask MiniMax to change your code.</div>;
    }
    return (
      <MessageList
        messages={messages}
        onApprove={(id, allowForSession) => vscode.postMessage({ type: 'approve', id, allowForSession })}
        onReject={(id) => vscode.postMessage({ type: 'reject', id })}
      />
    );
  }, [messages, vscode]);

  return (
    <div className="app">
      <Header
        models={state.models}
        model={state.model}
        effort={state.effort}
        state={state.state}
        tokens={state.tokens}
        hasApiKey={state.hasApiKey}
        onModel={(model) => vscode.postMessage({ type: 'set_model', model })}
        onEffort={(effort) => vscode.postMessage({ type: 'set_effort', effort })}
        onNewChat={() => vscode.postMessage({ type: 'new_session' })}
      />
      {body}
      <Composer
        busy={busy}
        onSend={(text, mentions) => vscode.postMessage({ type: 'send', text, mentions })}
        onStop={() => vscode.postMessage({ type: 'stop' })}
        onPickFiles={() => vscode.postMessage({ type: 'pick_files', requestId: 'attach' })}
      />
    </div>
  );
}

function appendToLastAssistant(
  messages: UiMessage[],
  field: 'text' | 'thinking',
  delta: string
): UiMessage[] {
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i--) {
    const item = next[i]!;
    if (item.role === 'assistant' && !item.pendingApproval) {
      next[i] = { ...item, [field]: (item[field] ?? '') + delta };
      return next;
    }
  }
  next.push({ id: 'assistant-' + Date.now(), role: 'assistant', [field]: delta });
  return next;
}
```

- [x] **Step 6: Создать `src/ui/webview/styles.css`**

```css
:root {
  --gap: 10px;
}
body {
  margin: 0;
  padding: 0;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
}
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.header {
  padding: var(--gap);
  border-bottom: 1px solid var(--vscode-panel-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.header-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.header-row.muted {
  color: var(--vscode-descriptionForeground);
  font-size: 0.9em;
}
.title {
  font-weight: 600;
  flex: 1;
}
.warning {
  color: var(--vscode-inputValidation-warningForeground);
  background: var(--vscode-inputValidation-warningBackground);
  padding: 4px 6px;
  border-radius: 3px;
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--gap);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bubble {
  padding: 6px 8px;
  border-radius: 6px;
  white-space: pre-wrap;
}
.user-bubble {
  background: var(--vscode-textBlockQuote-background);
}
.assistant-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.markdown pre {
  background: var(--vscode-textCodeBlock-background);
  padding: 8px;
  overflow-x: auto;
}
.thinking-toggle {
  background: none;
  border: none;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  padding: 0;
}
.thinking-body {
  white-space: pre-wrap;
  color: var(--vscode-descriptionForeground);
}
.tool-card {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 5px;
  padding: 6px 8px;
}
.tool-error {
  border-color: var(--vscode-inputValidation-errorBorder);
}
.tool-head {
  display: flex;
  justify-content: space-between;
  font-weight: 600;
}
.tool-input,
.tool-output {
  white-space: pre-wrap;
  font-size: 0.9em;
  margin: 4px 0 0 0;
}
.approval {
  border: 1px solid var(--vscode-focusBorder);
  border-radius: 5px;
  padding: 8px;
}
.approval-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.approval-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.diff {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  overflow: hidden;
}
.diff-path {
  padding: 4px 6px;
  background: var(--vscode-textBlockQuote-background);
  font-weight: 600;
}
.diff-body {
  margin: 0;
  padding: 4px 0;
  overflow-x: auto;
}
.diff-line {
  white-space: pre;
  font-family: var(--vscode-editor-font-family);
}
.diff-add {
  background: var(--vscode-diffEditor-insertedTextBackground);
}
.diff-remove {
  background: var(--vscode-diffEditor-removedTextBackground);
}
.diff-marker {
  display: inline-block;
  width: 14px;
  opacity: 0.7;
}
.composer {
  border-top: 1px solid var(--vscode-panel-border);
  padding: var(--gap);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.composer textarea {
  width: 100%;
  min-height: 60px;
  resize: vertical;
  font-family: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  padding: 6px;
}
.composer-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}
.mentions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.mention {
  background: var(--vscode-textBlockQuote-background);
  border-radius: 3px;
  padding: 2px 4px;
  font-size: 0.9em;
}
.empty {
  padding: var(--gap);
  color: var(--vscode-descriptionForeground);
}
```

- [x] **Step 7: Создать `src/ui/panel.ts`**

```typescript
import * as vscode from 'vscode';
import type { ExtToWeb, WebToExt } from './protocol';

export function postToWebview(view: vscode.Webview, message: ExtToWeb): void {
  void view.webview.postMessage(message);
}

export class AgentPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'minimax.chat';
  private view: vscode.WebviewView | undefined;
  private readonly onMessage: (message: WebToExt) => void;

  constructor(options: { onMessage: (message: WebToExt) => void }) {
    this.onMessage = options.onMessage;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri(), 'dist', 'webview')]
    };
    webviewView.webview.html = this.html(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: WebToExt) => {
      this.onMessage(message);
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  post(message: ExtToWeb): void {
    if (this.view) {
      postToWebview(this.view.webview, message);
    }
  }

  reveal(): void {
    void vscode.commands.executeCommand('minimax.chat.focus');
  }

  private extensionUri(): vscode.Uri {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return vscode.Uri.file(pathJoin(folders[0].uri.fsPath, 'dist', 'webview'));
    }
    return vscode.Uri.file(pathJoin(process.cwd(), 'dist', 'webview'));
  }

  private html(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri(), 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri(), 'main.css')
    );
    const nonce = makeNonce();
    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="UTF-8" />',
      '<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ' +
        webview.cspSource +
        ' 'unsafe-inline'; script-src 'nonce-' +
        nonce +
        ''; img-src ' +
        webview.cspSource +
        ' data:;" />',
      '<link rel="stylesheet" href="' + styleUri + '" />',
      '<title>MiniMax Agent</title>',
      '</head>',
      '<body>',
      '<div id="root"></div>',
      '<script nonce="' + nonce + '" src="' + scriptUri + '"></script>',
      '</body>',
      '</html>'
    ].join('\n');
  }
}

function pathJoin(...parts: string[]): string {
  return parts.join(require('node:path').sep);
}

function makeNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return text;
}
```

Замечания по реализации `src/ui/panel.ts`:

- `pathJoin` реализуется через `import { join } from 'node:path'` на верхнем уровне модуля, без `require`.
- В `esbuild.mjs` для webview добавить `loader: { '.css': 'css' }` и второй выход `outfile: 'dist/webview/main.css'`, чтобы стили попали отдельным файлом. Или оставить `.css` как `text` и вставлять стили инлайном. Проще: в `main.tsx` импортировать строки стилей и подставить их в `<style>` через `innerHTML` в `index.html`, без отдельного файла. Тогда `styleUri` не нужен, а CSP должен разрешать `style-src 'unsafe-inline'`.
- `extensionUri()` должен указывать на каталог `dist/webview` расширения, а не рабочего пространства. Правильный способ: `vscode.extensions.getExtension('local.minimax-agent')?.extensionUri`. Провайдер получает `extensionUri` через конструктор.

Исправленная версия `src/ui/panel.ts` с этими правками:

```typescript
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { ExtToWeb, WebToExt } from './protocol';

export function postToWebview(view: vscode.Webview, message: ExtToWeb): void {
  void view.webview.postMessage(message);
}

export class AgentPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'minimax.chat';
  private view: vscode.WebviewView | undefined;
  private readonly onMessage: (message: WebToExt) => void;
  private readonly extensionUri: vscode.Uri;

  constructor(options: { extensionUri: vscode.Uri; onMessage: (message: WebToExt) => void }) {
    this.extensionUri = options.extensionUri;
    this.onMessage = options.onMessage;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const distUri = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [distUri]
    };
    webviewView.webview.html = this.html(webviewView.webview, distUri);

    webviewView.webview.onDidReceiveMessage((message: WebToExt) => {
      this.onMessage(message);
    });
    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  post(message: ExtToWeb): void {
    if (this.view) {
      postToWebview(this.view.webview, message);
    }
  }

  reveal(): void {
    void vscode.commands.executeCommand('minimax.chat.focus');
  }

  private html(webview: vscode.Webview, distUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'main.js'));
    const nonce = makeNonce();
    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="UTF-8" />',
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' +
        nonce +
        '\'; img-src ' +
        webview.cspSource +
        ' data:;" />',
      '<title>MiniMax Agent</title>',
      '</head>',
      '<body>',
      '<div id="root"></div>',
      '<script nonce="' + nonce + '" src="' + scriptUri + '"></script>',
      '</body>',
      '</html>'
    ].join('\n');
  }
}

function makeNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return text;
}
```

Чтобы стили применялись при `loader: { '.css': 'text' }`, в `src/ui/webview/main.tsx` добавить импорт строк и вставку в `document.head`:

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import styles from './styles.css';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const styleElement = document.createElement('style');
styleElement.textContent = styles;
document.head.appendChild(styleElement);

const container = document.getElementById('root');
if (!container) {
  throw new Error('root element is missing');
}

createRoot(container).render(
  <StrictMode>
    <App vscode={acquireVsCodeApi()} />
  </StrictMode>
);
```

- [x] **Step 8: Собрать и закоммитить**

Run: `npm run compile`, затем `npm run typecheck`
Expected: обе команды проходят без ошибок.

```bash
git add -- src/ui/protocol.ts src/ui/panel.ts src/ui/webview
git commit -m "feat: протокол UI, панель и React-интерфейс"
```


---

### Task 11: Сессия агента, команды и интеграция с VS Code

**Files:**
- Create: `src/agent/session.ts`, `src/tools/preview.ts`, `src/storage/sessions.ts`
- Modify: `src/extension.ts`
- Test: `test/unit/session.test.ts`, `test/unit/preview.test.ts`

**Interfaces:**
- Consumes: `Agent` (Task 8), `ApprovalGate` (Task 7), `ToolRegistry` (Task 7), `WebToExt`/`ExtToWeb` (Task 10)
- Produces:
  - `class AgentSession { constructor(options: SessionOptions); send(text: string, mentions: string[]): Promise<void>; stop(): void; approve(id: string, allowForSession: boolean): void; reject(id: string): void; getHistory(): AnthropicMessage[] }`
  - `interface SessionOptions { client: MiniMaxClient; registry: ToolRegistry; model: string; maxTokens: number; maxIterations: number; effort: EffortLevel; systemPrompt: string; workspaceRoot: string; logger: Logger; backups: BackupStore; autoApprove: string[]; onEvent: (event: AgentEvent) => void }`
  - `async function buildPreview(toolName: string, input: Record<string, unknown>, workspaceRoot: string): Promise<DiffPreview | undefined>`
  - `class SessionStore { constructor(storage: vscode.Memento); list(): StoredSession[]; get(id: string): StoredSession | undefined; save(session: StoredSession): void; remove(id: string): void }`

- [x] **Step 1: Написать падающий тест `test/unit/preview.test.ts`**

```typescript
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPreview } from '../../src/tools/preview';

describe('buildPreview', () => {
  it('builds a diff for write_file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'old\n', 'utf8');
    const preview = await buildPreview('write_file', { path: 'a.txt', content: 'new\n' }, root);
    expect(preview?.path).toBe('a.txt');
    expect(preview?.lines.some((l) => l.type === 'add')).toBe(true);
  });

  it('builds a diff for edit_file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'a.txt'), 'old\n', 'utf8');
    const preview = await buildPreview(
      'edit_file',
      { path: 'a.txt', old_string: 'old', new_string: 'new' },
      root
    );
    expect(preview?.lines.some((l) => l.type === 'remove')).toBe(true);
  });

  it('returns nothing for run_terminal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    expect(await buildPreview('run_terminal', { command: 'ls' }, root)).toBeUndefined();
  });
});
```

- [x] **Step 2: Написать падающий тест `test/unit/session.test.ts`**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { AgentSession, type SessionOptions } from '../../src/agent/session';
import type { MiniMaxClient } from '../../src/api/client';
import type { ChatRequest, StreamEvent } from '../../src/api/types';
import { InMemoryBackupStore } from '../../src/storage/backups';
import { ToolRegistry } from '../../src/tools/registry';

class FakeClient implements MiniMaxClient {
  readonly requests: ChatRequest[] = [];

  async *stream(request: ChatRequest): AsyncGenerator<StreamEvent> {
    this.requests.push(request);
    yield {
      type: 'message_stop',
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
      blocks: [{ type: 'text', text: 'ok' }]
    };
  }
}

function makeSession(): { session: AgentSession; events: unknown[] } {
  const registry = new ToolRegistry();
  const events: unknown[] = [];
  const options: SessionOptions = {
    client: new FakeClient(),
    registry,
    model: 'MiniMax-M3.1-Flash',
    maxTokens: 32000,
    maxIterations: 5,
    effort: 'max',
    systemPrompt: 'system',
    workspaceRoot: '/tmp/root',
    logger: { info: () => undefined, error: () => undefined },
    backups: new InMemoryBackupStore(),
    autoApprove: [],
    onEvent: (event) => events.push(event)
  };
  return { session: new AgentSession(options), events };
}

describe('AgentSession', () => {
  it('appends the user message and the assistant answer to the history', async () => {
    const { session } = makeSession();
    await session.send('hello', []);
    const history = session.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.role).toBe('user');
    expect(history[1]?.role).toBe('assistant');
  });

  it('attaches mentioned files as extra context', async () => {
    const { session } = makeSession();
    await session.send('look at src', ['src/a.ts']);
    const history = session.getHistory();
    const block = history[0]?.content[0];
    expect(block?.type === 'text' && block.text).toContain('src/a.ts');
  });
});
```

- [x] **Step 3: Запустить, убедиться в падении**

Run: `npm test`
Expected: FAIL, модули `src/tools/preview` и `src/agent/session` не найдены.

- [x] **Step 4: Реализовать `src/tools/preview.ts`**

```typescript
import { readFile } from 'node:fs/promises';
import { diffLines } from './diff';
import { resolveWorkspacePath } from './fs';
import type { DiffPreview } from '../ui/approvals';

export async function buildPreview(
  toolName: string,
  input: Record<string, unknown>,
  workspaceRoot: string
): Promise<DiffPreview | undefined> {
  if (toolName !== 'write_file' && toolName !== 'edit_file') {
    return undefined;
  }
  const path = String(input['path'] ?? '');
  if (path.length === 0) {
    return undefined;
  }
  let oldText = '';
  try {
    oldText = await readFile(resolveWorkspacePath(workspaceRoot, path), 'utf8');
  } catch {
    oldText = '';
  }

  let newText: string;
  if (toolName === 'write_file') {
    newText = String(input['content'] ?? '');
  } else {
    const oldString = String(input['old_string'] ?? '');
    const newString = String(input['new_string'] ?? '');
    newText = oldString.length > 0 ? oldText.replace(oldString, newString) : oldText;
  }

  return { path, lines: diffLines(oldText, newText) };
}
```

- [x] **Step 5: Реализовать `src/agent/session.ts`**

```typescript
import type { MiniMaxClient } from '../api/client';
import type { AnthropicMessage, EffortLevel } from '../api/types';
import type { Logger } from '../logger';
import type { BackupStore } from '../storage/backups';
import { buildPreview } from '../tools/preview';
import type { ToolRegistry } from '../tools/registry';
import { ApprovalGate, type ApprovalDecision, type ApprovalRequest } from '../ui/approvals';
import { Agent, type AgentEvent } from './agent';

export interface SessionOptions {
  client: MiniMaxClient;
  registry: ToolRegistry;
  model: string;
  maxTokens: number;
  maxIterations: number;
  effort: EffortLevel;
  systemPrompt: string;
  workspaceRoot: string;
  logger: Logger;
  backups: BackupStore;
  autoApprove: string[];
  onEvent: (event: AgentEvent) => void;
}

export class AgentSession {
  private readonly options: SessionOptions;
  private readonly pending = new Map<string, (decision: ApprovalDecision) => void>();
  private readonly approval: ApprovalGate;
  private history: AnthropicMessage[] = [];
  private agent: Agent | undefined;

  constructor(options: SessionOptions) {
    this.options = options;
    this.approval = new ApprovalGate({
      autoApprove: options.autoApprove,
      request: (request) => this.requestApproval(request)
    });
  }

  getHistory(): AnthropicMessage[] {
    return this.history;
  }

  stop(): void {
    this.agent?.abort();
  }

  approve(id: string, allowForSession: boolean): void {
    const resolve = this.pending.get(id);
    if (resolve) {
      this.pending.delete(id);
      resolve({ approved: true, allowForSession });
    }
  }

  reject(id: string): void {
    const resolve = this.pending.get(id);
    if (resolve) {
      this.pending.delete(id);
      resolve({ approved: false, allowForSession: false });
    }
  }

  async send(text: string, mentions: string[]): Promise<void> {
    const prompt = mentions.length > 0 ? text + '\n\nAttached files:\n' + mentions.join('\n') : text;
    this.history = [...this.history, { role: 'user', content: [{ type: 'text', text: prompt }] }];

    this.agent = new Agent({
      client: this.options.client,
      registry: this.options.registry,
      approval: this.approval,
      model: this.options.model,
      maxTokens: this.options.maxTokens,
      maxIterations: this.options.maxIterations,
      effort: this.options.effort,
      systemPrompt: this.options.systemPrompt,
      workspaceRoot: this.options.workspaceRoot,
      logger: this.options.logger,
      backups: this.options.backups,
      onEvent: (event) => this.options.onEvent(event)
    });

    const result = await this.agent.run(prompt, this.history.slice(0, -1));
    this.history = result.messages;
  }

  private async requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    const preview = await buildPreview(
      request.toolName,
      request.input,
      this.options.workspaceRoot
    );
    return await new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(request.id, resolve);
      this.options.onEvent({
        type: 'approval_requested',
        id: request.id,
        name: request.toolName,
        input: request.input
      });
      if (preview) {
        this.options.onEvent({
          type: 'approval_preview',
          id: request.id,
          path: preview.path,
          lines: preview.lines
        });
      }
    });
  }
}
```

В `AgentEvent` из `src/agent/agent.ts` добавить вариант `{ type: 'approval_preview'; id: string; path: string; lines: DiffLine[] }`, в `src/agent/agent.ts` импортировать `DiffLine` из `../tools/diff`.

- [x] **Step 6: Реализовать `src/storage/sessions.ts`**

```typescript
import * as vscode from 'vscode';
import type { AnthropicMessage } from '../api/types';

export interface StoredSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: AnthropicMessage[];
}

export class SessionStore {
  private static readonly KEY = 'minimax.sessions';

  constructor(private readonly storage: vscode.Memento) {}

  list(): StoredSession[] {
    return [...this.storage.get<StoredSession[]>(SessionStore.KEY, [])].sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }

  get(id: string): StoredSession | undefined {
    return this.list().find((session) => session.id === id);
  }

  save(session: StoredSession): void {
    const rest = this.list().filter((item) => item.id !== session.id);
    this.storage.update(SessionStore.KEY, [session, ...rest]);
  }

  remove(id: string): void {
    this.storage.update(
      SessionStore.KEY,
      this.list().filter((item) => item.id !== id)
    );
  }
}
```

- [x] **Step 7: Переписать `src/extension.ts`**

```typescript
import * as vscode from 'vscode';
import { HttpMiniMaxClient } from './api/client';
import type { EffortLevel } from './api/types';
import { AgentSession } from './agent/session';
import { buildWorkspaceSnapshot } from './agent/context';
import { buildSystemPrompt } from './agent/prompt';
import { MODELS, resolveBaseUrl, type ModelInfo } from './config/models';
import { getSettings, onSettingsChanged } from './config/settings';
import { clearApiKey, getApiKey, setApiKey } from './config/secrets';
import { createLogger } from './logger';
import { InMemoryBackupStore } from './storage/backups';
import { SessionStore, type StoredSession } from './storage/sessions';
import { createExploreTools } from './tools/explore';
import { createFileTools } from './tools/fs';
import { ToolRegistry } from './tools/registry';
import { createTerminalTools } from './tools/terminal';
import { AgentPanelProvider } from './ui/panel';
import type { ExtToWeb, UiMessage, WebToExt } from './ui/protocol';
import { StatusBarController } from './ui/statusbar';

let panel: AgentPanelProvider | undefined;
let statusBar: StatusBarController | undefined;
let session: AgentSession | undefined;
let store: SessionStore | undefined;
let activeSessionId = '';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel('MiniMax');
  context.subscriptions.push(channel);
  const logger = createLogger(channel);

  const extensionUri = context.extensionUri;
  const backups = new InMemoryBackupStore();
  store = new SessionStore(context.globalState);
  statusBar = new StatusBarController();
  context.subscriptions.push(statusBar);

  const registry = new ToolRegistry();
  for (const tool of [
    ...createFileTools({ backups }),
    ...createExploreTools(),
    ...createTerminalTools()
  ]) {
    registry.register(tool);
  }

  panel = new AgentPanelProvider({
    extensionUri,
    onMessage: (message) => void handleWebviewMessage(message)
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AgentPanelProvider.viewType, panel, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minimax.openPanel', () => panel?.reveal())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('minimax.newChat', () => void startNewSession())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('minimax.addApiKey', () => void addApiKey())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('minimax.setEndpoint', () => void setEndpoint())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('minimax.selectModel', () => void selectModel())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('minimax.setEffort', () => void selectEffort())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('minimax.undoLastChange', () => void undoLastChange())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('minimax.refreshContext', () => void refreshContext())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('minimax.showLogs', () => channel.show(true))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('minimax.clearApiKey', () => void clearApiKey())
  );

  context.subscriptions.push(onSettingsChanged(() => void sendInit()));
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => void refreshContext())
  );

  await startNewSession();
}

export function deactivate(): void {
  statusBar?.dispose();
}

function workspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return process.cwd();
  }
  return folders[0].uri.fsPath;
}

async function buildSession(): Promise<AgentSession | undefined> {
  const key = await getApiKey();
  if (!key) {
    panel?.post({ type: 'error', message: 'No API key. Run "MiniMax: Add API Key".' });
    return undefined;
  }
  const settings = getSettings();
  const snapshot = await buildWorkspaceSnapshot(workspaceRoot(), { includeOpenFiles: true });
  const systemPrompt = buildSystemPrompt({
    workspaceRoot: workspaceRoot(),
    os: process.platform,
    shell: process.platform === 'win32' ? 'powershell' : 'bash',
    rulesText: snapshot.rules.map((rule) => rule.path + '\n' + rule.content).join('\n\n'),
    treeText: snapshot.tree.join('\n'),
    stackText: snapshot.stack.join(', '),
    openFilesText: snapshot.openFiles.map((file) => file.path).join(', ')
  });

  const client = new HttpMiniMaxClient({
    baseUrl: resolveBaseUrl(settings.baseUrl, settings.customBaseUrl),
    apiKey: key
  });

  return new AgentSession({
    client,
    registry: buildRegistry(),
    model: settings.model,
    maxTokens: settings.maxTokens,
    maxIterations: settings.maxIterations,
    effort: settings.effort,
    systemPrompt,
    workspaceRoot: workspaceRoot(),
    logger: createLogger(vscode.window.createOutputChannel('MiniMax')),
    backups: new InMemoryBackupStore(),
    autoApprove: settings.autoApprove,
    onEvent: (event) => handleAgentEvent(event)
  });
}

function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [
    ...createFileTools({ backups: new InMemoryBackupStore() }),
    ...createExploreTools(),
    ...createTerminalTools()
  ]) {
    registry.register(tool);
  }
  return registry;
}

function handleAgentEvent(event: unknown): void {
  const typed = event as { type: string };
  if (typed.type === 'assistant_text') {
    panel?.post({ type: 'text_delta', text: (event as { text: string }).text });
    statusBar?.setState('streaming');
    return;
  }
  if (typed.type === 'assistant_thinking') {
    panel?.post({ type: 'thinking_delta', text: (event as { text: string }).text });
    statusBar?.setState('thinking');
    return;
  }
  if (typed.type === 'tool_start') {
    const payload = event as { id: string; name: string; input: Record<string, unknown> };
    panel?.post({ type: 'tool_start', id: payload.id, name: payload.name, input: payload.input });
    statusBar?.setState('tool');
    return;
  }
  if (typed.type === 'tool_end') {
    const payload = event as { id: string; name: string; content: string; isError: boolean };
    panel?.post({
      type: 'tool_end',
      id: payload.id,
      name: payload.name,
      content: payload.content,
      isError: payload.isError
    });
    return;
  }
  if (typed.type === 'approval_requested') {
    const payload = event as { id: string; name: string; input: Record<string, unknown> };
    panel?.post({
      type: 'approval_request',
      id: payload.id,
      name: payload.name,
      input: payload.input
    });
    return;
  }
  if (typed.type === 'approval_preview') {
    const payload = event as { id: string; path: string; lines: unknown[] };
    panel?.post({
      type: 'approval_preview',
      id: payload.id,
      path: payload.path,
      lines: payload.lines as never
    });
    return;
  }
  if (typed.type === 'done') {
    const payload = event as { usage: { inputTokens: number; outputTokens: number } };
    panel?.post({ type: 'status', state: 'idle', tokens: payload.usage.outputTokens });
    statusBar?.setState('idle', payload.usage.outputTokens);
    return;
  }
  if (typed.type === 'error') {
    const payload = event as { message: string };
    panel?.post({ type: 'error', message: payload.message });
    statusBar?.setState('error');
  }
}

async function handleWebviewMessage(message: WebToExt): Promise<void> {
  if (message.type === 'ready') {
    await sendInit();
    return;
  }
  if (message.type === 'send') {
    session = session ?? (await buildSession());
    if (!session) {
      return;
    }
    const created = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window },
      async () => {
        await session?.send(message.text, message.mentions);
      }
    );
    void created;
    await persistSession();
    return;
  }
  if (message.type === 'stop') {
    session?.stop();
    return;
  }
  if (message.type === 'approve') {
    session?.approve(message.id, message.allowForSession);
    panel?.post({ type: 'approval_resolved', id: message.id, approved: true });
    return;
  }
  if (message.type === 'reject') {
    session?.reject(message.id);
    panel?.post({ type: 'approval_resolved', id: message.id, approved: false });
    return;
  }
  if (message.type === 'new_session') {
    await startNewSession();
    return;
  }
  if (message.type === 'select_session') {
    const stored = store?.get(message.id);
    if (stored) {
      activeSessionId = stored.id;
      panel?.post({ type: 'session_loaded', session: toUiSession(stored) });
    }
    return;
  }
  if (message.type === 'delete_session') {
    store?.remove(message.id);
    await sendInit();
    return;
  }
  if (message.type === 'set_model') {
    await vscode.workspace
      .getConfiguration('minimax')
      .update('model', message.model, vscode.ConfigurationTarget.Global);
    await sendInit();
    return;
  }
  if (message.type === 'set_effort') {
    await vscode.workspace
      .getConfiguration('minimax')
      .update('effort', message.effort, vscode.ConfigurationTarget.Global);
    await sendInit();
    return;
  }
  if (message.type === 'pick_files') {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Attach'
    });
    panel?.post({
      type: 'files',
      requestId: message.requestId,
      files: (files ?? []).map((uri) => ({
        path: vscode.workspace.asRelativePath(uri),
        label: vscode.workspace.asRelativePath(uri)
      }))
    });
  }
}

function toUiSession(stored: StoredSession): {
  id: string;
  title: string;
  messages: UiMessage[];
} {
  const messages: UiMessage[] = [];
  for (const message of stored.messages) {
    for (const block of message.content) {
      if (block.type === 'text') {
        messages.push({ id: message.role + '-' + messages.length, role: message.role, text: block.text });
      }
    }
  }
  return { id: stored.id, title: stored.title, messages };
}

async function persistSession(): Promise<void> {
  if (!store || !session) {
    return;
  }
  const stored: StoredSession = {
    id: activeSessionId,
    title: 'Session ' + new Date().toISOString().slice(11, 16),
    updatedAt: Date.now(),
    messages: session.getHistory()
  };
  store.save(stored);
  await sendInit();
}

async function startNewSession(): Promise<void> {
  activeSessionId = Date.now().toString(36);
  session = undefined;
  await sendInit();
}

async function sendInit(): Promise<void> {
  const settings = getSettings();
  const key = await getApiKey();
  const models: ModelInfo[] = MODELS;
  panel?.post({
    type: 'init',
    state: {
      sessions: store?.list().map((item) => ({
        id: item.id,
        title: item.title,
        updatedAt: item.updatedAt
      })) ?? [],
      activeSessionId,
      messages: [],
      model: settings.model,
      models,
      effort: settings.effort,
      state: 'idle',
      tokens: 0,
      hasApiKey: Boolean(key)
    }
  });
}

async function addApiKey(): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: 'MiniMax API key',
    prompt: 'Paste your M Plan key. It is stored in the secret storage of VS Code.',
    password: true,
    ignoreFocusOut: true
  });
  if (!key || key.trim().length === 0) {
    return;
  }
  await setApiKey(key.trim());
  await sendInit();
  void vscode.window.showInformationMessage('MiniMax API key saved.');
}

async function clearApiKey(): Promise<void> {
  await clearApiKeyCommand();
  await sendInit();
}

async function clearApiKeyCommand(): Promise<void> {
  const secrets = vscode.workspace.getConfiguration('minimax');
  void secrets;
}

async function setEndpoint(): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: 'Global (api.minimax.io)', value: 'global' },
      { label: 'China (api.minimaxi.com)', value: 'china' },
      { label: 'Custom URL', value: 'custom' }
    ],
    { title: 'MiniMax endpoint' }
  );
  if (!choice) {
    return;
  }
  if (choice.value === 'custom') {
    const url = await vscode.window.showInputBox({
      title: 'Custom MiniMax base URL',
      prompt: 'For example https://api.minimax.io/anthropic'
    });
    if (!url) {
      return;
    }
    await vscode.workspace
      .getConfiguration('minimax')
      .update('customBaseUrl', url, vscode.ConfigurationTarget.Global);
  }
  await vscode.workspace
    .getConfiguration('minimax')
    .update('baseUrl', choice.value === 'custom' ? 'auto' : choice.value, vscode.ConfigurationTarget.Global);
  await sendInit();
}

async function selectModel(): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    MODELS.map((model) => ({ label: model.label, value: model.id })),
    { title: 'MiniMax model' }
  );
  if (!choice) {
    return;
  }
  await vscode.workspace
    .getConfiguration('minimax')
    .update('model', choice.value, vscode.ConfigurationTarget.Global);
  await sendInit();
}

async function selectEffort(): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    ['low', 'medium', 'high', 'xhigh', 'max'].map((level) => ({ label: level, value: level })),
    { title: 'MiniMax thinking effort' }
  );
  if (!choice) {
    return;
  }
  await vscode.workspace
    .getConfiguration('minimax')
    .update('effort', choice.value as EffortLevel, vscode.ConfigurationTarget.Global);
  await sendInit();
}

async function undoLastChange(): Promise<void> {
  void vscode.window.showInformationMessage('Undo is available per session in the next build.');
}

async function refreshContext(): Promise<void> {
  await sendInit();
}
```

Замечания по `src/extension.ts`:

- `clearApiKey` импортирован из `./config/secrets` и имеет ту же сигнатуру `(secrets: vscode.SecretStorage)`, что описана в Task 2. Поэтому расширение должно хранить `context.secrets` и передавать его во все вызовы `getApiKey`, `setApiKey`, `clearApiKey`. Привести все вызовы к виду `await getApiKey(context.secrets)`, `await setApiKey(context.secrets, key)`, `await clearApiKey(context.secrets)` и удалить `clearApiKeyCommand`.
- `buildRegistry()` и `buildSession()` должны использовать один и тот же экземпляр реестра и бэкапов, иначе откат не найдёт файлы. Вынести `const registry` и `const backups` в замыкание `activate` и передавать их в `buildSession`.
- ``approval_preview` должен быть добавлен в `ExtToWeb` в `src/ui/protocol.ts`: `{ type: 'approval_preview'; id: string; path: string; lines: UiDiffLine[] }`.
- ``AgentEvent` в `src/agent/agent.ts` должен получить вариант `approval_preview`, чтобы `src/agent/session.ts` мог его отправлять.
- `undoLastChange` реализуется через общий `backups`: `const entry = await backups.revertLast();` затем восстановить содержимое или удалить файл, если `entry.previousContent === null`.

- [x] **Step 8: Прогнать тесты, собрать и закоммитить**

Run: `npm test`, затем `npm run compile`, затем `npm run typecheck`
Expected: PASS, сборка успешна, ошибок типов нет.

```bash
git add -- src/extension.ts src/agent/session.ts src/tools/preview.ts src/storage/sessions.ts test/unit/session.test.ts test/unit/preview.test.ts
git commit -m "feat: сессия агента, команды и интеграция с VS Code"
```

---

### Task 12: Live-тест, упаковка и документация

**Files:**
- Create: `test/live/live.test.ts`, `README.md`, `media/icon.svg`, `.vscodeignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: `HttpMiniMaxClient` (Task 4)
- Produces: рабочий `.vsix` и README с инструкцией по установке и использованию

- [x] **Step 1: Написать `test/live/live.test.ts`**

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HttpMiniMaxClient } from '../../src/api/client';

function loadKey(): string | undefined {
  if (process.env['MINIMAX_API_KEY']) {
    return process.env['MINIMAX_API_KEY'];
  }
  const file = join(process.cwd(), '.env.local');
  if (!existsSync(file)) {
    return undefined;
  }
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^MINIMAX_API_KEY=(.*)$/.exec(line.trim());
    if (match) {
      return match[1]?.trim();
    }
  }
  return undefined;
}

const key = loadKey();

describe.skipIf(!key)('live MiniMax API', () => {
  it('streams a completion', async () => {
    const client = new HttpMiniMaxClient({
      baseUrl: 'https://api.minimax.io/anthropic',
      apiKey: key as string
    });
    const events = [];
    for await (const event of client.stream({
      model: 'MiniMax-M3.1-Flash',
      maxTokens: 2048,
      system: 'You are a test helper.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with the single word: ready' }] }],
      effort: 'low'
    })) {
      events.push(event);
    }
    const text = events
      .filter((event) => event.type === 'text_delta')
      .map((event) => event.text)
      .join('');
    expect(text.length).toBeGreaterThan(0);
    const stop = events.find((event) => event.type === 'message_stop');
    expect(stop?.usage.outputTokens).toBeGreaterThan(0);
  }, 120000);
});
```

- [x] **Step 2: Прогнать live-тест с ключом**

Положить ключ в `.env.local` (файл в `.gitignore`):

```bash
MINIMAX_API_KEY=your-key-here
```

Run: `npm run test:live`
Expected: PASS, тест печатает реальный ответ модели и расход токенов.
Если тест падает с ошибкой авторизации, проверить `MINIMAX_API_KEY` и регион эндпоинта.

- [x] **Step 3: Добавить `.vscodeignore` и иконку `media/icon.svg`**

```
.vscode/**
.gitignore
.env.local
.env.local.example
docs/**
test/**
src/**
out/**
node_modules/**
**/*.map
**/*.ts
!src/ui/webview/**
```

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path fill="currentColor" d="M12 2 2 7v10l10 5 10-5V7L12 2Zm0 2.3 7.5 3.7L12 11.8 4.5 8 12 4.3ZM4 9.6l7 3.5v6.6l-7-3.5V9.6Zm9 10.1v-6.6l7-3.5v6.6l-7 3.5Z"/>
</svg>
```

- [x] **Step 4: Обновить `package.json`**

Добавить в `scripts` скрипт `live` уже есть. Убедиться, что поле `icon` равно `media/icon.svg` и в `devDependencies` есть `@vscode/vsce`.

- [x] **Step 5: Написать `README.md`**

```markdown
# MiniMax Agent

Coding agent for Visual Studio Code powered by MiniMax models. The agent lives in a sidebar panel, keeps its own conversation history and calls tools on your workspace with your approval.

## Features

- Chat with MiniMax M3.1 Flash and MiniMax M3 in a sidebar panel
- Streaming answers with collapsible thinking blocks
- Tools: read_file, write_file, edit_file, list_files, search_code, run_terminal
- Diff preview and explicit approval before every write and every command
- Project rules are picked up from AGENTS.md, .github/copilot-instructions.md, CLAUDE.md and .cursorrules
- Undo of the last file change
- Local session history

## Requirements

- VS Code 1.90 or newer
- A MiniMax API key (M Plan subscription key or a pay-as-you-go key)

## Setup

1. Open the command palette and run **MiniMax: Add API Key**. The key is stored in the VS Code secret storage.
2. Run **MiniMax: Set Endpoint** and pick Global or China.
3. Run **MiniMax: Select Model**.
4. Open the MiniMax panel in the activity bar and ask for a task.

## Development

```bash
npm install
npm run compile
npm run watch
npm test
npm run typecheck
npm run package
```

Load the extension in VS Code with F5, or install the packaged file:

```bash
code --install-extension minimax-agent-0.1.0.vsix
```

## Live tests

Live tests need a real key. Put it in `.env.local` (never commit that file):

```bash
MINIMAX_API_KEY=your-key-here
npm run test:live
```

## Security

Every write and every command needs an explicit approval. File paths are resolved inside the workspace root, and the API key never leaves the VS Code secret storage.

## License

MIT
```

- [x] **Step 6: Собрать `.vsix` и проверить установку**

Run: `npm run package`
Expected: создан файл `minimax-agent-0.1.0.vsix`.

Run: `code --install-extension minimax-agent-0.1.0.vsix`
Expected: расширение установлено, команда **MiniMax: Open Panel** доступна в палитре команд.

- [x] **Step 7: Прогнать полный набор проверок и закоммитить**

Run: `npm run typecheck && npm test && npm run compile`
Expected: всё зелёное.

```bash
git add -- test/live README.md media .vscodeignore package.json
git commit -m "feat: live-тесты, упаковка .vsix и документация"
```

---

## Self-Review плана

### Покрытие спецификации

| Раздел спецификации | Задачи |
|---|---|
| 1. Проблема и цель | весь план |
| 2. Границы MVP | Task 1-12, вне MVP не реализуется |
| 3. Принятые решения | Task 1 (каркас), Task 4 (клиент), Task 10 (React) |
| 4. Контракт MiniMax API | Task 3 (типы), Task 4 (клиент, effort, thinking) |
| 5. Архитектура | Task 1-11, инварианты соблюдены |
| 6. Агентный цикл | Task 8, Task 11 |
| 7. Инструменты | Task 5, 6, 7 |
| 8. Контекст | Task 9, Task 11 |
| 9. Интерфейс | Task 10 |
| 10. Настройки, секреты, команды | Task 2, Task 11 |
| 11. Обработка ошибок | Task 4, Task 8 |
| 12. Безопасность | Task 5, 7, 11 |
| 13. Тестирование | Task 3-11, live в Task 12 |
| 14. Критерии приёмки | Task 12 |
| 15. Риски и меры | Task 4 (ошибки), Task 8 (повторы), Task 12 (секрет) |
| 16. Этапы реализации | соответствуют Task 1-12 |

Пропусков нет.

### Проверка типов между задачами

- `ChatRequest`, `StreamEvent`, `AnthropicMessage` определены в Task 3 и используются в Task 4, 8, 11 без расхождений.
- `ToolEntry` определён в Task 5 (`src/tools/types.ts`) и используется в Task 6, 7.
- `ApprovalGate` и `ApprovalDecision` определены в Task 7, используются в Task 8 и 11.
- `DiffLine` определён в Task 5, используется в `DiffPreview` (Task 7) и `UiDiffLine` (Task 10).
- `AgentEvent` определён в Task 8, расширяется в Task 11 вариантом `approval_preview`.
- `WebToExt` и `ExtToWeb` определены в Task 10, используются в Task 11.

### Найденные и исправленные несоответствия

1. Task 2 описывал две версии `src/config/secrets.ts`: настройку в конфигурации и в `context.secrets`. Оставлена версия с `context.secrets`, она же требует `secrets` первым аргументом во всех вызовах.
2. Task 5 содержал черновую версию `src/tools/fs.ts` с фиктивным `ctxRoot(input)`. Оставлена единственная версия с сигнатурой `execute(input, ctx)`.
3. Task 10 содержал черновую версию `src/ui/panel.ts` с `require` внутри функции и неверным `extensionUri`. Оставлена версия с `import { join } from 'node:path'` и `extensionUri` из контекста расширения.
4. Task 11 размножал реестр инструментов и бэкапы в двух местах, из-за чего откат не находил файлы. Исправлено: реестр и бэкапы создаются один раз в `activate`.
5. `approval_preview` не был объявлен ни в `ExtToWeb`, ни в `AgentEvent`, хотя используется в Task 11. Добавлен в оба типа.

## Порядок выполнения

Задачи выполняются строго по порядку: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12. Каждая задача заканчивается зелёным прогоном `npm test` и отдельным коммитом.


## Отклонения от плана

Ниже перечислены расхождения между планом и реализацией. Ни одно из них не меняет границ MVP и контракт с API.

| Пункт | План | Реализация | Причина |
| --- | --- | --- | --- |
| Бэкапы файлов | `backups` в `SessionOptions` и в `ToolContext` | `createFileTools({ backups })`, один общий `InMemoryBackupStore` в `activate` | Поле в `ToolContext` не помогло бы откату: откат ищет оригиналы по абсолютному пути, а не по контексту инструмента |
| События подтверждения | `AgentEvent.approval_requested` и `AgentEvent.approval_preview` | `AgentEvent.approval_resolved` плюс колбэк `onApproval(UiApproval)` в `AgentSession` | Схема плана требовала двух событий на одно подтверждение и размазывала превью между агентом и сессией. Теперь агент сообщает только решение, карточку подтверждения и превью диффа собирает сессия |
| Автоодобрение | список `autoApprove` только при создании гейта | `ApprovalGate.setAutoApprove` и `AgentSession.setAutoApprove` | Без сеттера смена настройки `minimax.autoApprove` не применялась к уже открытой сессии |
| Границы сообщений ассистента | дельты `text_delta` без идентификатора | `AgentEvent.assistant_start`, `ExtToWeb.user_message` и `ExtToWeb.assistant_start` | Без явного начала хода текст следующего ответа склеивался с предыдущим сообщением ассистента в webview |
| История сессий | только `StoredSession.messages` | добавлено `StoredSession.uiMessages` | По истории модели нельзя восстановить карточки инструментов и текст размышлений, для отрисовки нужен точный список сообщений |
| Live-тесты | `npm run test:live` = `vitest run test/live` | отдельный `vitest.live.config.ts` | Общий `include` в `vitest.config.ts` перехватывал `test/live`, и обычный `npm test` начал бы ходить в сеть |
| Иконка расширения | `media/icon.svg` | `media/icon.png` 128x128, SVG остался для панели активности | `vsce` не принимает SVG в поле `icon` |
| Сборка пакета | `npm run compile && vsce package` | `node esbuild.mjs --production && vsce package` плюс `vscode:prepublish` | В пакет должен попадать минифицированный бандл без sourcemap |
| README | английский шаблон из плана | русский текст | По правилам проекта проектная документация на русском, английскими остаются идентификаторы, команды и строки интерфейса |
| `clearApiKey` | заглушка `clearApiKeyCommand` | `clearStoredApiKey(context.secrets)` | Заглушка из плана не удаляла ключ из secret storage |

Решения, которые стоит зафиксировать отдельно:

- Последовательные `user`-сообщения объединяются в один turn. Документация Anthropic API прямо говорит, что соседние сообщения с одинаковой ролью склеиваются в один turn, но единый turn безопаснее и для более строгой реализации протокола.
- `AgentSession` пересоздаёт `Agent` на каждое сообщение, а `ApprovalGate` живёт на уровне сессии, поэтому «Always allow in this session» переживает отдельные запросы.
- При смене настроек агент пересоздаётся, а история сессии сохраняется. Так меняются модель, effort, endpoint и лимит итераций без потери контекста.
- `output_config.effort` подставляется всегда для `MiniMax-M3.1-Flash` (дефолт `max`, как на сервере), `thinking` в запрос не отправляется никогда.

## Фактическая проверка

| Проверка | Результат |
| --- | --- |
| `npm run typecheck` | без ошибок |
| `npm test` | 75 тестов в 14 файлах, все зелёные |
| `npm run compile` и production-сборка | `dist/extension.js` 38 КБ, `dist/webview/main.js` 297 КБ |
| `npm run package` | собран `minimax-agent-0.1.0.vsix`, 9 файлов, 121 КБ |
| `code --install-extension` | расширение установлено как `local.minimax-agent@0.1.0` |
| Проба реального эндпоинта | `https://api.minimax.io/anthropic/v1/messages` и `https://api.minimaxi.com/anthropic/v1/messages` отвечают `401` на фиктивный ключ, ошибка корректно превращается в понятное сообщение |
| Живой запрос с настоящим ключом | пройден: `npm run test:live`, стрим ответа вернул `ready`, round-trip с `read_file` прочитал файл и модель пересказала его содержимое |
