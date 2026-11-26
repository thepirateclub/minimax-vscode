// The keys of the approval card: Enter allows, A allows always, Esc rejects.
// The keys belong to the card only while the reader is not typing: Enter in
// a field with text sends the text, Esc there leaves the goal mode. An empty
// field gives the keys to the card, except for the tools that ask every time
// (a deletion, a destroying git command): those need the focus on the card,
// a stray Enter must not delete a file.
export type ApprovalKey = 'approve' | 'always' | 'reject';

export interface KeyFocus {
  // The focus stands in a text field or a contenteditable.
  editing: boolean;
  // That field holds no text.
  emptyField: boolean;
  // The focus stands inside the card itself.
  inCard: boolean;
}

export function approvalKey(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
  focus: KeyFocus,
  card: { strict: boolean; canAlways: boolean }
): ApprovalKey | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return undefined;
  }
  const free = focus.inCard || (!card.strict && (!focus.editing || focus.emptyField));
  if (!free) {
    return undefined;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    return 'approve';
  }
  if (event.key === 'Escape') {
    return 'reject';
  }
  if ((event.key === 'a' || event.key === 'A') && card.canAlways && !focus.editing) {
    return 'always';
  }
  return undefined;
}

// The focus of the page in the words of the rule above.
export function focusOf(active: Element | null, card: Element | null): KeyFocus {
  const element = active as HTMLElement | null;
  const editing =
    element !== null &&
    (element.isContentEditable === true || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA');
  const text = editing
    ? element!.isContentEditable
      ? (element!.textContent ?? '')
      : ((element as HTMLInputElement).value ?? '')
    : '';
  return {
    editing,
    emptyField: text.trim().length === 0,
    inCard: card !== null && element !== null && card.contains(element)
  };
}
