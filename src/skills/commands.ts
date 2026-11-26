import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseSkillFile, type Skill } from './skills';

// The commands of the reader: a markdown file in .minimax/commands (or the
// .claude/commands of the same format) is a prompt template called as
// `/name` from the field of the request. A review, a test plan or a commit
// ritual becomes one word, without a change of the extension. The command
// of the project wins over the command of the user with the same name.
export function commandRoots(workspaceRoot: string, home: string = homedir()): string[] {
  const roots: string[] = [];
  if (workspaceRoot) {
    roots.push(join(workspaceRoot, '.minimax', 'commands'), join(workspaceRoot, '.claude', 'commands'));
  }
  roots.push(join(home, '.minimax', 'commands'), join(home, '.claude', 'commands'));
  return roots;
}

const MAX_DESCRIPTION = 200;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export async function discoverCommands(workspaceRoot: string, home: string = homedir()): Promise<Skill[]> {
  const found = new Map<string, Skill>();
  for (const root of commandRoots(workspaceRoot, home)) {
    let names: string[];
    try {
      names = await readdir(root);
    } catch {
      continue;
    }
    for (const file of names.filter((item) => item.toLowerCase().endsWith('.md')).sort()) {
      const name = file.slice(0, -3);
      if (!NAME.test(name) || found.has(name)) {
        continue;
      }
      try {
        const parsed = parseSkillFile(await readFile(join(root, file), 'utf8'));
        const firstLine = parsed.body.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? name;
        const description = (parsed.description ?? firstLine.replace(/^#+\s*/, '')).slice(0, MAX_DESCRIPTION);
        found.set(name, { name, description, dir: root, command: join(root, file) });
      } catch {
        // An unreadable file is no command.
      }
    }
  }
  return [...found.values()];
}

// The text of the command for the request: `$ARGUMENTS` takes the rest of
// the words of the reader, a template without it gets them at the end.
export function expandCommand(body: string, args: string): string {
  const text = body.trim();
  if (text.includes('$ARGUMENTS')) {
    return text.split('$ARGUMENTS').join(args.trim());
  }
  return args.trim().length > 0 ? text + '\n\nArguments: ' + args.trim() : text;
}

// The words of the request without the calls of the commands.
export function argumentsOf(request: string, names: readonly string[]): string {
  let text = request;
  for (const name of names) {
    text = text.split('/' + name).join(' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}

export async function readCommandText(command: Skill, request: string, names: readonly string[]): Promise<string> {
  const parsed = parseSkillFile(await readFile(command.command!, 'utf8'));
  return expandCommand(parsed.body, argumentsOf(request, names));
}
