import type { UiSuggestion } from './protocol';

// The skills in the field of the request. `/name` calls a skill: the panel
// suggests the names after the slash and turns a picked or a fully typed
// name into a chip; the logical text keeps `/name`, the host finds the names
// in it and puts the skill into the request. The module runs in the panel
// and in the host, without node and without the DOM.

export interface UiSkill {
  name: string;
  description: string;
  // Where the skill comes from, the settings tab groups by it.
  source: 'project' | 'user' | 'plugin';
  // The SKILL.md of the skill, the settings tab opens it.
  file: string;
}

const MAX_SUGGESTIONS = 8;

// The word after a slash right before the caret: at the start of the field
// or after a space, so a path like src/ui does not open the list.
export function slashPrefix(before: string): string | undefined {
  const match = /(?:^|\s)\/([\w.-]*)$/.exec(before);
  return match ? match[1] ?? '' : undefined;
}

// The skills for the typed prefix: the names that start with it first, then
// the names and the descriptions that hold it.
export function matchSkills(skills: readonly UiSkill[], prefix: string): UiSkill[] {
  const wanted = prefix.toLowerCase();
  const starts = skills.filter((skill) => skill.name.toLowerCase().startsWith(wanted));
  const holds = skills.filter(
    (skill) =>
      !starts.includes(skill) &&
      wanted.length > 0 &&
      (skill.name.toLowerCase().includes(wanted) || skill.description.toLowerCase().includes(wanted))
  );
  return [...starts, ...holds].slice(0, MAX_SUGGESTIONS);
}

// A name typed in full and closed with a space becomes a chip without a
// pick: `/pdf ` before the caret gives `pdf`.
export function typedSkill(before: string, skills: readonly UiSkill[]): string | undefined {
  const match = /(?:^|\s)\/([\w.-]+) $/.exec(before);
  const name = match?.[1];
  return name !== undefined && skills.some((skill) => skill.name === name) ? name : undefined;
}

// The skills a request calls: the words `/name` of the known skills.
export function mentionedSkills(text: string, names: readonly string[]): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:^|\s)\/([\w.-]+)(?=$|[\s,.;:!?])/g)) {
    // A dot at the end closes the sentence, it is not a part of the name.
    const name = (match[1] ?? '').replace(/\.+$/, '');
    if (names.includes(name) && !found.includes(name)) {
      found.push(name);
    }
  }
  return found;
}

// A skill as an item of the list of the field, next to the files.
export function skillSuggestion(skill: UiSkill): UiSuggestion {
  return { id: 'skill:' + skill.name, path: skill.name, label: skill.name, source: 'skill', detail: skill.description };
}
