// The helpers of the field of the composer: the walk of the nodes, the
// chips of the files, the caret and the trigger of the suggestions.
export interface EditorContent {
  text: string;
  mentions: string[];
}

const BLOCK_TAGS = new Set(['DIV', 'P']);

interface WalkResult extends EditorContent {
  visible: string;
}

export function fileLabel(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function walk(parent: Node, result: WalkResult): void {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      result.visible += text;
      result.text += text;
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }
    const element = child as HTMLElement;
    // The chip of a skill stays `/name` in the text, the host finds the skill
    // by it; it is not a file of the request.
    if (element.classList.contains('mention-skill')) {
      const name = '/' + (element.dataset.skill ?? '');
      // The triggers read the visible text: a chip is one object there, not
      // `/name`, or the chip reads as a typed skill again and the field
      // turns it into a new chip without end.
      result.visible += SKILL_CHIP_MARK;
      result.text += name;
      continue;
    }
    if (element.classList.contains('mention')) {
      const path = element.dataset.path ?? '';
      const label = element.dataset.label ?? path;
      result.visible += label;
      result.text += '@' + path;
      result.mentions.push(path);
      continue;
    }
    if (element.tagName === 'BR') {
      result.visible += '\n';
      result.text += '\n';
      continue;
    }
    walk(element, result);
    if (BLOCK_TAGS.has(element.tagName)) {
      result.visible += '\n';
      result.text += '\n';
    }
  }
}

export function readContent(root: HTMLElement): EditorContent & { visible: string } {
  const result: WalkResult = { text: '', visible: '', mentions: [] };
  walk(root, result);
  return result;
}

// The visible text before the caret drives the "@" trigger, a chip counts as
// its own label so a path never looks like a fresh trigger.
// The place of a skill chip in the visible text: the object mark of Unicode.
export const SKILL_CHIP_MARK = '￼';

export function visibleBeforeCaret(root: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return '';
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) {
    return '';
  }
  const before = document.createRange();
  before.selectNodeContents(root);
  try {
    before.setEnd(range.startContainer, range.startOffset);
  } catch {
    return '';
  }
  const result: WalkResult = { text: '', visible: '', mentions: [] };
  walk(before.cloneContents(), result);
  return result.visible.replace(/\n+$/, '');
}

export function triggerPrefix(value: string): string | undefined {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(value);
  return match ? match[1] ?? '' : undefined;
}

export function createMentionChip(path: string): HTMLElement {
  const label = fileLabel(path);
  const chip = document.createElement('span');
  chip.className = 'mention';
  chip.contentEditable = 'false';
  chip.dataset.path = path;
  chip.dataset.label = label;
  chip.title = path;

  const labelElement = document.createElement('span');
  labelElement.className = 'mention-label';
  labelElement.textContent = label;
  chip.appendChild(labelElement);

  const remove = document.createElement('span');
  remove.className = 'mention-remove';
  remove.textContent = '×';
  chip.appendChild(remove);
  return chip;
}

export function insertMention(root: HTMLElement, path: string): void {
  insertChip(root, createMentionChip(path));
}

// The chip of a skill: the name of the skill with its slash, the cross
// removes it like the chip of a file.
export function createSkillChip(name: string): HTMLElement {
  const chip = createMentionChip(name);
  chip.className = 'mention mention-skill';
  delete chip.dataset.path;
  chip.dataset.skill = name;
  chip.title = 'Skill ' + name;
  const label = chip.querySelector('.mention-label');
  if (label) {
    label.textContent = '/' + name;
  }
  return chip;
}

export function insertSkillChip(root: HTMLElement, name: string): void {
  insertChip(root, createSkillChip(name));
}

function insertChip(root: HTMLElement, chip: HTMLElement): void {

  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && root.contains(selection.getRangeAt(0).startContainer)) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(chip);
    const spacer = document.createTextNode(' ');
    chip.after(spacer);
    range.setStartAfter(spacer);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  root.appendChild(chip);
  root.appendChild(document.createTextNode(' '));
}

// The typed `/name` of a skill is cut out like the trigger of a file; a
// name typed in full comes with the space that closed it.
export function removeSlashTrigger(): void {
  cutBeforeCaret(/(?:^|\s)(\/[\w.-]*\s?)$/);
}

function cutBeforeCaret(pattern: RegExp): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) {
    return;
  }
  const text = node.textContent ?? '';
  const offset = range.startOffset;
  const match = pattern.exec(text.slice(0, offset));
  if (!match) {
    return;
  }
  const start = offset - (match[1]?.length ?? 0);
  node.textContent = text.slice(0, start) + text.slice(offset);
  range.setStart(node, start);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

// The typed trigger is cut out of the text node that holds the caret.
export function removeTrigger(): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) {
    return;
  }
  const text = node.textContent ?? '';
  const offset = range.startOffset;
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, offset));
  if (!match) {
    return;
  }
  const start = offset - (match[1]?.length ?? 0) - 1;
  if (start < 0) {
    return;
  }
  node.textContent = text.slice(0, start) + text.slice(offset);
  range.setStart(node, start);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function insertLineBreak(): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const br = document.createTextNode('\n');
  range.insertNode(br);
  range.setStartAfter(br);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

// The caret goes to the end of the restored request, the user edits it there.
export function placeCaretAtEnd(root: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
