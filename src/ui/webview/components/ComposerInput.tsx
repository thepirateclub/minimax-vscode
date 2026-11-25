import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { EffortLevel } from '../../../api/types';
import type { AgentMode, ModelInfo } from '../../../config/models';
import type { UiQueuedMessage, UiRetryStatus, UiSelection, UiSuggestion, VoiceState } from '../../protocol';
import { STRINGS } from '../strings';
import {
  IconAttach,
  IconClose,
  IconCode,
  IconGoal,
  IconMic,
  IconModel,
  IconPlan,
  IconRefresh,
  IconSend,
  IconStop,
  IconThinking
} from '../icons';
import { IconSelect, type IconSelectOption } from './IconSelect';
import { QueueBar } from './QueueBar';

// The options of the selectors of the field.
export const MODE_OPTIONS: IconSelectOption<AgentMode>[] = [
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

export const EFFORT_OPTIONS: IconSelectOption<EffortLevel>[] = (
  ['low', 'medium', 'high', 'xhigh', 'max'] as const
).map((level) => ({
  value: level,
  label: level,
  icon: <IconThinking />,
  hint: STRINGS.reasoningDepthHint
}));

// M3 has no levels of the reasoning, the model thinks or does not.
export const REASONING_VARIANT_OPTIONS: IconSelectOption<'off' | 'adaptive'>[] = [
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


// The block of the input: the suggestions, the chips of the code, the
// field, the row of the controls and the queue under it.
export function ComposerInput(props: {
  suggestions: UiSuggestion[];
  active: number;
  onPick: (item: UiSuggestion) => void;
  selections: UiSelection[];
  onRemoveSelection: (id: string) => void;
  editorRef: React.RefObject<HTMLDivElement>;
  empty: boolean;
  goalMode: boolean;
  onInput: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  onPickFiles: () => void;
  model: string;
  models: ModelInfo[];
  mode: AgentMode;
  effort: EffortLevel;
  thinking: boolean;
  voice: VoiceState;
  busy: boolean;
  queue: UiQueuedMessage[];
  retryStatus?: UiRetryStatus;
  onSendQueued?: (id: string) => void;
  onSendAllQueued?: () => void;
  onRemoveQueued?: (id: string) => void;
  onModel: (model: string) => void;
  onEffort: (effort: EffortLevel) => void;
  onMode: (mode: AgentMode) => void;
  onThinking: (thinking: boolean) => void;
  onGoalMode: (on: boolean) => void;
  onVoiceStart?: () => void;
  onVoiceStop?: () => void;
  onStop: () => void;
  onSubmit: () => void;
}): ReactNode {
  const {
    suggestions, active, onPick, selections, onRemoveSelection, editorRef,
    empty, goalMode, onInput, onKeyDown, onMouseDown, onPickFiles,
    model, models, mode, effort, thinking, voice, busy, queue, retryStatus,
    onSendQueued, onSendAllQueued, onRemoveQueued,
    onModel, onEffort, onMode, onThinking, onGoalMode,
    onVoiceStart, onVoiceStop, onStop, onSubmit
  } = props;
  const currentModel = models.find((item) => item.id === model);
  const modelOptions: IconSelectOption<string>[] = models.map((item) => ({
    value: item.id,
    label: item.shortLabel,
    icon: <IconModel />,
    hint: item.label
  }));
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
                  onPick(item);
                }}
              >
                <span className={'suggestion-dot source-' + item.source} />
                <span className="suggestion-path">{item.source === 'skill' ? '/' + item.path : item.path}</span>
                {item.detail ? <span className="suggestion-detail">{item.detail}</span> : null}
                <span className="suggestion-source">
                  {item.source === 'skill'
                    ? STRINGS.skillSource
                    : item.source === 'open'
                      ? STRINGS.openFiles
                      : STRINGS.workspaceFiles}
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
        <div className={'composer-input-wrap' + (goalMode ? ' goal-mode' : '')}>
          <div
            ref={editorRef}
            className={'composer-input' + (empty ? ' is-empty' : '')}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            data-placeholder={goalMode ? STRINGS.goalPlaceholder : STRINGS.placeholder}
            onInput={onInput}
            onKeyDown={onKeyDown}
            onMouseDown={onMouseDown}
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
                onClick={onSubmit}
              >
                <IconSend />
              </button>
            </div>
          </div>
        </div>
      </div>
  );
}
