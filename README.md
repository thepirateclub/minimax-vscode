# MiniMax Agent

Расширение для Visual Studio Code с полноценным агентом на моделях MiniMax. Агент живёт в боковой панели, ведёт собственную историю диалога и вызывает инструменты по вашему проекту. Каждая запись на диск и каждый запуск команды требуют явного подтверждения.

## Возможности

- Чат с MiniMax M3.1 Flash и MiniMax M3 в панели сайдбара
- Потоковые ответы со сворачиваемым блоком размышлений
- Инструменты: `read_file`, `write_file`, `edit_file`, `list_files`, `search_code`, `run_terminal`
- Превью диффа перед записью и карточка подтверждения перед каждой командой
- Правила проекта подхватываются из `AGENTS.md`, `.github/copilot-instructions.md`, `CLAUDE.md` и `.cursorrules`
- Отмена последнего изменения файла командой `MiniMax: Undo Last File Change`
- Локальная история сессий, она не покидает машину

## Требования

- VS Code 1.90 или новее
- API-ключ MiniMax: ключ подписки M Plan или pay-as-you-go

## Настройка

1. Откройте палитру команд и выполните **MiniMax: Add API Key**. Ключ сохраняется в secret storage VS Code и больше нигде не хранится.
2. Выполните **MiniMax: Set Endpoint** и выберите Global (`api.minimax.io`) или China (`api.minimaxi.com`).
3. При желании выполните **MiniMax: Select Model** и **MiniMax: Set Thinking Effort**.
4. Откройте панель MiniMax на левой панели действий и поставьте задачу.

Ключ можно положить и в файл `.env.local` в корне проекта, переменная `MINIMAX_API_KEY`. Файл уже в `.gitignore` и в репозиторий не попадает. Приоритет у secret storage, `.env.local` используется как запасной источник.

## Команды

| Команда | Что делает |
| --- | --- |
| `MiniMax: Open Panel` | открыть панель агента |
| `MiniMax: New Chat` | начать новую сессию |
| `MiniMax: Add API Key` | сохранить ключ в secret storage |
| `MiniMax: Clear API Key` | удалить ключ из secret storage |
| `MiniMax: Set Endpoint` | выбрать регион или свой base URL |
| `MiniMax: Select Model` | выбрать модель |
| `MiniMax: Set Thinking Effort` | выбрать уровень размышлений (`low` … `max`) |
| `MiniMax: Undo Last File Change` | откатить последнее изменение файла |
| `MiniMax: Refresh Workspace Context` | перечитать правила и структуру проекта |
| `MiniMax: Show Logs` | открыть канал вывода MiniMax |

## Инструменты

| Инструмент | Подтверждение | Что делает |
| --- | --- | --- |
| `read_file` | нет | читает текстовый файл с нумерацией строк, есть диапазон `start_line`/`end_line` |
| `write_file` | да | создаёт файл или заменяет его целиком, перед записью показывается дифф |
| `edit_file` | да | заменяет точную строку, `old_string` должен встречаться ровно один раз |
| `list_files` | нет | показывает структуру проекта, `node_modules` и `.git` игнорируются |
| `search_code` | нет | ищет литеральную подстроку по проекту |
| `run_terminal` | да, всегда | выполняет команду в корне workspace с таймаутом и обрезкой вывода |

## Разработка

```bash
npm install
npm run compile
npm run watch
npm test
npm run typecheck
npm run package
```

Открыть расширение в VS Code по F5 или поставить собранный файл:

```bash
code --install-extension minimax-agent-0.1.0.vsix
```

## Live-тесты

Live-тесты бьют по настоящему API и требуют ключ:

```bash
npm run test:live
```

Ключ берётся из `MINIMAX_API_KEY` в окружении или из `.env.local` в корне проекта. Обычный `npm test` live-тесты не запускает.

## Безопасность

- Любая запись на диск и любой запуск команды требуют подтверждения в панели, есть кнопка «Always allow in this session».
- Пути инструментов разрешаются только внутри корня workspace, выход за пределы запрещён.
- Перед записью сохраняется оригинал файла, его можно откатить.
- API-ключ живёт только в secret storage VS Code, в webview и в логи он не попадает.

## Лицензия

MIT
