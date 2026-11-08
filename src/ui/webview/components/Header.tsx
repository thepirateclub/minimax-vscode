import type { EffortLevel } from '../../../api/types';
import type { ModelInfo } from '../../../config/models';
import { STRINGS } from '../strings';

export function Header({
  models,
  model,
  effort,
  state,
  tokens,
  hasApiKey,
  onModel,
  onEffort,
  onNewChat
}: {
  models: ModelInfo[];
  model: string;
  effort: EffortLevel;
  state: string;
  tokens: number;
  hasApiKey: boolean;
  onModel: (model: string) => void;
  onEffort: (effort: EffortLevel) => void;
  onNewChat: () => void;
}) {
  return (
    <div className="header">
      <div className="header-row">
        <span className="title">{STRINGS.appName}</span>
        <button className="secondary" onClick={onNewChat}>
          {STRINGS.newChat}
        </button>
      </div>
      <div className="header-row">
        <select value={model} onChange={(event) => onModel(event.target.value)}>
          {models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          value={effort}
          onChange={(event) => onEffort(event.target.value as EffortLevel)}
        >
          {(['low', 'medium', 'high', 'xhigh', 'max'] as const).map((level) => (
            <option key={level} value={level}>
              {STRINGS.effort}: {level}
            </option>
          ))}
        </select>
      </div>
      <div className="header-row muted">
        <span>{state}</span>
        <span>
          {tokens} {STRINGS.tokens}
        </span>
      </div>
      {!hasApiKey ? <div className="warning">{STRINGS.noApiKey}</div> : null}
    </div>
  );
}
