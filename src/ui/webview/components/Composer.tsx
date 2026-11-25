import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { EffortLevel } from '../../../api/types';
import type { AgentMode, ModelInfo } from '../../../config/models';
import type {
  UiQueuedMessage,
  UiRetryStatus,
  UiSelection,
  UiSuggestion,
  VoiceState,
} from '../../protocol';
import type { QueuedMessage } from '../../protocol';
import { dictationPiece } from '../dictation';
import { splitRestore } from '../restoreInput';
import { ComposerInput } from './ComposerInput';
import { matchSkills, skillSuggestion, slashPrefix, typedSkill, type UiSkill } from '../../skillMentions';
import {
  createMentionChip,
  insertLineBreak,
  insertMention,
  insertSkillChip,
  removeSlashTrigger,
  placeCaretAtEnd,
  readContent,
  removeTrigger,
  triggerPrefix,
  visibleBeforeCaret,
  type EditorContent,
} from './composerField';

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
  skills = []
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
  // The skills the host found, the slash of the field suggests them.
  skills?: UiSkill[];
}) {

  const [active, setActive] = useState(0);
  // The skills after a slash: the panel finds them itself, the host sent
  // the list. They take the place of the files in the list.
  const [skillItems, setSkillItems] = useState<UiSuggestion[]>([]);
  const shown = skillItems.length > 0 ? skillItems : suggestions;
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
    const before = visibleBeforeCaret(root);
    // A name of a skill typed in full and closed with a space is a chip.
    const typed = typedSkill(before, skills);
    if (typed) {
      removeSlashTrigger();
      insertSkillChip(root, typed);
      setSkillItems([]);
      report();
      return;
    }
    const slash = slashPrefix(before);
    const matched = slash === undefined ? [] : matchSkills(skills, slash).map(skillSuggestion);
    setSkillItems(matched);
    if (matched.length > 0) {
      setActive(0);
      onSuggest(undefined);
      return;
    }
    onSuggest(triggerPrefix(before));
  };

  const pick = (item: UiSuggestion): void => {
    const root = editorRef.current;
    if (!root) {
      return;
    }
    if (item.source === 'skill') {
      removeSlashTrigger();
      insertSkillChip(root, item.path);
      setSkillItems([]);
    } else {
      removeTrigger();
      insertMention(root, item.path);
    }
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
    if (goalMode && shown.length === 0 && event.key === 'Escape') {
      event.preventDefault();
      onGoalMode?.(false);
      return;
    }
    if (shown.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((value) => (value + 1) % shown.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((value) => (value - 1 + shown.length) % shown.length);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onSuggest(undefined);
        setSkillItems([]);
        return;
      }
      // Tab takes the suggestion like Enter, as in the editor.
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        const item = shown[active];
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
    <ComposerInput
      suggestions={shown}
      active={active}
      onPick={pick}
      selections={selections}
      onRemoveSelection={onRemoveSelection}
      editorRef={editorRef}
      empty={empty}
      goalMode={goalMode}
      onInput={report}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onPickFiles={onPickFiles}
      model={model}
      models={models}
      mode={mode}
      effort={effort}
      thinking={thinking}
      voice={voice}
      busy={busy}
      queue={queue as unknown as QueuedMessage[]}
      retryStatus={retryStatus}
      onSendQueued={onSendQueued}
      onSendAllQueued={onSendAllQueued}
      onRemoveQueued={onRemoveQueued}
      onModel={onModel}
      onEffort={onEffort}
      onMode={onMode}
      onThinking={onThinking}
      onGoalMode={onGoalMode ?? (() => undefined)}
      onVoiceStart={onVoiceStart}
      onVoiceStop={onVoiceStop}
      onStop={onStop}
      onSubmit={submit}
    />
  );
}
