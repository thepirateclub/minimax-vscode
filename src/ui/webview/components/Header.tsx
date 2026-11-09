import type { EffortLevel } from '../../../api/types';
import type { ModelInfo } from '../../../config/models';
import type { AgentState } from '../../protocol';
import { STRINGS } from '../strings';

export type PanelTab = 'chat' | 'settings';

export function Header({
  tab,
  onTab,
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
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  models: ModelInfo[];
  model: string;
  effort: EffortLevel;
  state: AgentState;
  tokens: number;
  hasApiKey: boolean;
  onModel: (model: string) => void;
  onEffort: (effort: EffortLevel) => void;
  onNewChat: () => void;
}) {
  return (
    <div className="header">
      <div className="tabs">
        <button
          className={'tab' + (tab === 'chat' ? ' active' : '')}
          onClick={() => onTab('chat')}
        >
          {STRINGS.chatTab}
        </button>
        <button
          className={'tab' + (tab === 'settings' ? ' active' : '')}
          onClick={() => onTab('settings')}
        >
          {STRINGS.settingsTab}
        </button>
        <span className={'state-chip state-' + state}>{state}</span>
        <button className="icon-button" title={STRINGS.newChat} onClick={onNewChat}>
          +
        </button>
      </div>
      {tab === 'chat' ? (
        <div className="header-row selects">
          <select value={model} onChange={(event) => onModel(event.target.value)}>
            {models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
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
          <span className="tokens">
            {tokens} {STRINGS.tokens}
          </span>
        </div>
      ) : null}
      {!hasApiKey ? <div className="warning">{STRINGS.noApiKey}</div> : null}
    </div>
  );
}
