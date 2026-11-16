import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { EffortLevel } from '../../../api/types';
import type { AgentMode, ModelInfo } from '../../../config/models';
import type {
  UiQueuedMessage,
  UiRetryStatus,
  UiSelection,
  UiSuggestion,
  VoiceState
} from '../../protocol';
import { dictationPiece } from '../dictation';
import {
  IconAttach,
  IconClose,
  IconCode,
  IconMic,
  IconModel,
  IconPlan,
  IconGoal,
  IconRefresh,
  IconSend,
  IconStop,
  IconThinking
} from '../icons';
import { splitRestore } from '../restoreInput';
import { STRINGS } from '../strings';
import { IconSelect, type IconSelectOption } from './IconSelect';
import { ActivityBar } from './ActivityBar';
import { QueueBar } from './QueueBar';
import type { ActiveAction } from '../activityStatus';

export interface InsertRequest {
  paths: string[];
  token: number;
}

// The text the microphone has heard, it goes after the draft of the field.
export interface DictationRequest {
  text: string;
  // A live text is replaced by the next one, a final text stays in the field.
  final: boolean;
  token: number;
}

// The request that the rollback of the chat puts back into the input.
export interface RestoreRequest {
  text: string;
  mentions: string[];
  token: number;
}

export interface EditorContent {
  text: string;
  mentions: string[];
}

const BLOCK_TAGS = new Set(['DIV', 'P']);

// The rows of the composer are compact, the labels are shorter than the ids.
const MODE_OPTIONS: IconSelectOption<AgentMode>[] = [
  {
    value: 'plan',
    label: STRINGS.modePlan,
    icon: <IconPlan />,
    hint: STRINGS.modePlanHint
  },
  {
    value: 'code',
    label: STRINGS.modeCode,
    icon: <IconCode />,
    hint: STRINGS.modeCodeHint
  }
];

const EFFORT_OPTIONS: IconSelectOption<EffortLevel>[] = (
  ['low', 'medium', 'high', 'xhigh', 'max'] as const
).map((level) => ({
  value: level,
  label: level,
  icon: <IconThinking />,
  hint: STRINGS.reasoningDepthHint
}));

// M3 has no levels of the reasoning, the model thinks or does not.
const REASONING_VARIANT_OPTIONS: IconSelectOption<'off' | 'adaptive'>[] = [
  {
    value: 'off',
    label: STRINGS.reasoningOff,
    icon: <IconThinking />,
    hint: STRINGS.reasoningOffHint
  },
  {
    value: 'adaptive',
    label: STRINGS.reasoningAdaptive,
    icon: <IconThinking />,
    hint: STRINGS.reasoningAdaptiveHint
  }
];

interface WalkResult extends EditorContent {
  visible: string;
}

function fileLabel(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function walk(parent: Node, result: WalkResult): void {
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

function readContent(root: HTMLElement): EditorContent & { visible: string } {
  const result: WalkResult = { text: '', visible: '', mentions: [] };
  walk(root, result);
  return result;
}

// The visible text before the caret drives the "@" trigger, a chip counts as
// its own label so a path never looks like a fresh trigger.
function visibleBeforeCaret(root: HTMLElement): string {
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

function triggerPrefix(value: string): string | undefined {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(value);
  return match ? match[1] ?? '' : undefined;
}

function createMentionChip(path: string): HTMLElement {
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

function insertMention(root: HTMLElement, path: string): void {
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
function removeTrigger(): void {
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

function insertLineBreak(): void {
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
function placeCaretAtEnd(root: HTMLElement): void {
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

export function Composer({
  busy,
  selections,
  focusToken,
  suggestions,
  insert,
  restore,
  onInsertHandled,
  resetToken,
  models,
  model,
  effort,
  mode,
  thinking,
  onModel,
  onEffort,
  onMode,
  onThinking,
  onSend,
  onStop,
  onPickFiles,
  onRemoveSelection,
  onSuggest,
  onContentChange,
  voice = 'idle',
  dictation,
  onVoiceStart,
  onVoiceStop,
  goalMode = false,
  onGoalMode,
  retryStatus,
  queue = [],
  onSendQueued,
  onSendAllQueued,
  onRemoveQueued,
  action,
  actionStartedAt
}: {
  busy: boolean;
  selections: UiSelection[];
  focusToken: number;
  suggestions: UiSuggestion[];
  insert: InsertRequest | undefined;
  restore: RestoreRequest | undefined;
  onInsertHandled: () => void;
  resetToken: number;
  models: ModelInfo[];
  model: string;
  effort: EffortLevel;
  mode: AgentMode;
  thinking: boolean;
  onModel: (model: string) => void;
  onEffort: (effort: EffortLevel) => void;
  onMode: (mode: AgentMode) => void;
  onThinking: (thinking: boolean) => void;
  onSend: (text: string, mentions: string[], selections: UiSelection[]) => void;
  onStop: () => void;
  onPickFiles: () => void;
  onRemoveSelection: (id: string) => void;
  onSuggest: (prefix: string | undefined) => void;
  onContentChange?: (content: EditorContent) => void;
  voice?: VoiceState;
  dictation?: DictationRequest;
  onVoiceStart?: () => void;
  onVoiceStop?: () => void;
  // The field takes the goal of the session instead of a request.
  goalMode?: boolean;
  onGoalMode?: (on: boolean) => void;
  // The connection to MiniMax is lost, the request is repeated.
  retryStatus?: UiRetryStatus;
  // The queue of the messages of the chat.
  queue?: UiQueuedMessage[];
  onSendQueued?: (id: string) => void;
  onSendAllQueued?: () => void;
  onRemoveQueued?: (id: string) => void;
  // The action of the agent that runs now. The row of it stands above the
  // field of the request.
  action?: ActiveAction;
  actionStartedAt?: number;
}) {
  const currentModel = models.find((item) => item.id === model);
  const modelOptions: IconSelectOption<string>[] = models.map((item) => ({
    value: item.id,
    label: item.shortLabel,
    icon: <IconModel />,
    hint: item.label
  }));

  const [active, setActive] = useState(0);
  const [empty, setEmpty] = useState(true);
  const editorRef = useRef<HTMLDivElement>(null);
  const lastReset = useRef(resetToken);

  useEffect(() => {
    editorRef.current?.focus();
  }, [focusToken]);

  useEffect(() => {
    setActive(0);
  }, [suggestions]);

  useEffect(() => {
    if (resetToken === lastReset.current) {
      return;
    }
    lastReset.current = resetToken;
    const root = editorRef.current;
    if (root) {
      root.textContent = '';
      setEmpty(true);
      onContentChange?.({ text: '', mentions: [] });
    }
  }, [resetToken]);

  useEffect(() => {
    if (!insert) {
      return;
    }
    const root = editorRef.current;
    if (!root) {
      return;
    }
    for (const path of insert.paths) {
      insertMention(root, path);
    }
    onInsertHandled();
    root.focus();
    report();
  }, [insert?.token]);

  // The rollback of the chat puts the request back into the input field.
  // A draft that is already there stays, the request comes after it.
  useEffect(() => {
    if (!restore) {
      return;
    }
    const root = editorRef.current;
    if (!root) {
      return;
    }
    for (const segment of splitRestore(restore.text, restore.mentions)) {
      if (segment.kind === 'mention') {
        root.appendChild(createMentionChip(segment.value));
        root.appendChild(document.createTextNode(' '));
        continue;
      }
      root.appendChild(document.createTextNode(segment.value));
    }
    root.focus();
    placeCaretAtEnd(root);
    report();
  }, [restore?.token]);

  // The text the microphone hears lives in one span after the draft: every
  // live update replaces it, the final text turns it into plain text and the
  // caret follows it. The span cannot be edited, the typing of the reader
  // goes around it and is not lost on the next update.
  useEffect(() => {
    if (!dictation) {
      return;
    }
    const root = editorRef.current;
    if (!root) {
      return;
    }
    let live = root.querySelector<HTMLElement>('.dictation-live');
    if (!live) {
      live = document.createElement('span');
      live.className = 'dictation-live';
      live.contentEditable = 'false';
      // The space before the speech is chosen once, against the draft.
      live.dataset['spacer'] = dictationPiece(readContent(root).text, 'x').startsWith(' ')
        ? ' '
        : '';
      root.appendChild(live);
    }
    const spoken = dictation.text.trim();
    const shown = spoken.length > 0 ? (live.dataset['spacer'] ?? '') + spoken : '';
    if (!dictation.final) {
      live.textContent = shown;
      report();
      return;
    }
    if (shown.length > 0) {
      live.replaceWith(document.createTextNode(shown));
    } else {
      live.remove();
    }
    root.focus();
    placeCaretAtEnd(root);
    report();
  }, [dictation?.token]);

  const report = (): void => {
    const root = editorRef.current;
    if (!root) {
      return;
    }
    const content = readContent(root);
    setEmpty(content.text.trim().length === 0);
    onContentChange?.({ text: content.text, mentions: content.mentions });
    const prefix = triggerPrefix(visibleBeforeCaret(root));
    onSuggest(prefix);
  };

  const pick = (item: UiSuggestion): void => {
    const root = editorRef.current;
    if (!root) {
      return;
    }
    removeTrigger();
    insertMention(root, item.path);
    onSuggest(undefined);
    setActive(0);
    report();
  };

  const submit = (): void => {
    const root = editorRef.current;
    if (!root) {
      return;
    }
    const content = readContent(root);
    if (content.text.trim().length === 0) {
      return;
    }
    // A running turn does not hold the requests: the message waits in the
    // queue of the chat and goes out when the turn is over. A command of the
    // panel does not reach the model and goes through right away.
    onSend(content.text.trim(), content.mentions, selections);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Escape leaves the field of the goal, the draft stays.
    if (goalMode && suggestions.length === 0 && event.key === 'Escape') {
      event.preventDefault();
      onGoalMode?.(false);
      return;
    }
    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((value) => (value + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((value) => (value - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onSuggest(undefined);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const item = suggestions[active];
        if (item) {
          pick(item);
        }
        return;
      }
    }
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      insertLineBreak();
      report();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('mention-remove')) {
      return;
    }
    event.preventDefault();
    const chip = target.closest('.mention');
    if (chip) {
      chip.remove();
      report();
    }
  };

  return (
    <div className="composer">
      {suggestions.length > 0 ? (
        <div className="suggestions">
          {suggestions.map((item, index) => (
            <button
              key={item.id}
              className={'suggestion' + (index === active ? ' active' : '')}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(item);
              }}
            >
              <span className={'suggestion-dot source-' + item.source} />
              <span className="suggestion-path">{item.path}</span>
              <span className="suggestion-source">
                {item.source === 'open' ? STRINGS.openFiles : STRINGS.workspaceFiles}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {selections.length > 0 ? (
        <div className="selections">
          {selections.map((selection) => (
            <span key={selection.id} className="selection">
              <span className="selection-kind">{STRINGS.selection}</span>
              <span className="selection-label" title={selection.path}>
                {selection.label}
              </span>
              {selection.detail ? (
                <span className="selection-detail">{selection.detail}</span>
              ) : null}
              <button
                className="selection-remove"
                title={STRINGS.remove}
                aria-label={STRINGS.remove}
                onClick={() => onRemoveSelection(selection.id)}
              >
                <IconClose />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <QueueBar
        items={queue}
        onSend={(id) => onSendQueued?.(id)}
        onSendAll={() => onSendAllQueued?.()}
        onRemove={(id) => onRemoveQueued?.(id)}
      />
      {retryStatus ? (
        <div className="composer-status" role="status" aria-live="polite">
          <IconRefresh />
          <span className="composer-status-text">
            {STRINGS.retryConnecting} {STRINGS.retryAttempt} {retryStatus.attempt}{' '}
            {STRINGS.retryOf} {retryStatus.total}
          </span>
        </div>
      ) : null}
      <ActivityBar action={action} startedAt={actionStartedAt} />
      <div className={'composer-input-wrap' + (goalMode ? ' goal-mode' : '')}>
        <div
          ref={editorRef}
          className={'composer-input' + (empty ? ' is-empty' : '')}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-placeholder={goalMode ? STRINGS.goalPlaceholder : STRINGS.placeholder}
          onInput={report}
          onKeyDown={handleKeyDown}
          onMouseDown={handleMouseDown}
        />
        <button
          className="composer-attach"
          title={STRINGS.attach}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onPickFiles}
        >
          <IconAttach />
        </button>
        {/* The controls live in the last row of the field: the mode and the
            model on the left, the reasoning next to the send button. */}
        <div className="composer-toolbar">
          <div className="composer-toolbar-start">
            <IconSelect
              value={mode}
              options={MODE_OPTIONS}
              icon={mode === 'plan' ? <IconPlan /> : <IconCode />}
              title={mode === 'plan' ? STRINGS.modePlanHint : STRINGS.modeCodeHint}
              onChange={onMode}
            />
            <IconSelect
              value={model}
              options={modelOptions}
              icon={<IconModel />}
              title={STRINGS.model}
              className="composer-model"
              onChange={onModel}
            />
            {/* The goal is set in the same field: the button switches the
                field from a request to the goal of the session. */}
            <button
              className={'composer-goal' + (goalMode ? ' active' : '')}
              title={goalMode ? STRINGS.goalModeOff : STRINGS.goalModeOn}
              aria-label={STRINGS.goalModeOn}
              aria-pressed={goalMode}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onGoalMode?.(!goalMode);
                editorRef.current?.focus();
              }}
            >
              <IconGoal />
            </button>
          </div>
          <div className="composer-toolbar-end">
            {currentModel?.reasoning === 'variants' ? (
              <IconSelect
                value={thinking ? 'adaptive' : 'off'}
                options={REASONING_VARIANT_OPTIONS}
                icon={<IconThinking />}
                title={STRINGS.reasoningVariantsHint}
                className="composer-reasoning"
                align="end"
                onChange={(value) => onThinking(value === 'adaptive')}
              />
            ) : (
              <IconSelect
                value={effort}
                options={EFFORT_OPTIONS}
                icon={<IconThinking />}
                title={STRINGS.reasoningDepthHint}
                className="composer-reasoning"
                align="end"
                onChange={onEffort}
              />
            )}
            {/* The microphone records in the extension host, MiniMax turns
                the speech into text, the text lands in the field. */}
            <button
              className={'composer-mic' + (voice === 'idle' ? '' : ' ' + voice)}
              title={
                voice === 'recording'
                  ? STRINGS.voiceStop
                  : voice === 'transcribing'
                    ? STRINGS.voiceTranscribing
                    : STRINGS.voiceStart
              }
              aria-label={
                voice === 'recording'
                  ? STRINGS.voiceStop
                  : voice === 'transcribing'
                    ? STRINGS.voiceTranscribing
                    : STRINGS.voiceStart
              }
              aria-pressed={voice === 'recording'}
              disabled={voice === 'transcribing'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => (voice === 'recording' ? onVoiceStop?.() : onVoiceStart?.())}
            >
              <IconMic />
            </button>
            {busy ? (
              // The agent works: the turn can be stopped and the next
              // request can be written, it waits in the queue.
              <button
                className="composer-send stop"
                title={STRINGS.stop}
                aria-label={STRINGS.stop}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onStop}
              >
                <IconStop />
              </button>
            ) : null}
            <button
              className="composer-send"
              title={STRINGS.send}
              aria-label={STRINGS.send}
              onMouseDown={(event) => event.preventDefault()}
              onClick={submit}
            >
              <IconSend />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
