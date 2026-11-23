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
  const chip = createMentionChip(path);

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
