import type { AgentState, UiSessionSummary, UiUsageTurn } from '../../protocol';
import { UsageGraph } from './UsageGraph';
import { SessionMenu } from './SessionMenu';
import { STRINGS } from '../strings';

export type PanelTab = 'chat' | 'settings';

export function Header({
  tab,
  onTab,
  state,
  tokens,
  usage,
  hasApiKey,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onNewChat
}: {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  state: AgentState;
  tokens: number;
  usage: UiUsageTurn[];
  hasApiKey: boolean;
  sessions: UiSessionSummary[];
  activeSessionId: string | undefined;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
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
        <SessionMenu
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={onSelectSession}
          onDelete={onDeleteSession}
          onNewChat={onNewChat}
        />
        <button className="icon-button" title={STRINGS.newChat} onClick={onNewChat}>
          +
        </button>
      </div>
      {tab === 'chat' ? (
        <div className="header-row">
          <UsageGraph turns={usage} />
          <span className="tokens">
            {tokens} {STRINGS.tokens}
          </span>
        </div>
      ) : null}
      {!hasApiKey ? <div className="warning">{STRINGS.noApiKey}</div> : null}
    </div>
  );
}
