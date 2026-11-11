// The commands of the input field. A command is handled by the panel and
// never goes to the model as a request.

export type SlashCommand = { kind: 'goal'; objective: string };

// "/goal text" sets the goal with the defaults, "/goal" alone opens the
// wizard. Only the start of the request counts, and only the whole word:
// "/goals" and "what is /goal" are ordinary requests.
export function parseSlashCommand(text: string): SlashCommand | undefined {
  const match = /^\s*\/goal(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) {
    return undefined;
  }
  const objective = (match[1] ?? '').replace(/\s+/g, ' ').trim();
  return { kind: 'goal', objective };
}
