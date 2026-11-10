import type { AgentState, UiSessionSummary, UiUsageTurn } from '../../protocol';
import { formatCount } from '../../format';
import { UsageGraph } from './UsageGraph';
import { SessionMenu } from './SessionMenu';
import { IconPlus } from '../icons';
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
  onNewChat,
  version
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
  version: string;
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
        <span
          className={'state-dot state-' + state}
          title={state}
          aria-label={state}
        />
        <SessionMenu
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={onSelectSession}
          onDelete={onDeleteSession}
          onNewChat={onNewChat}
        />
        <button
          className="icon-button"
          title={STRINGS.newChat}
          aria-label={STRINGS.newChat}
          onClick={onNewChat}
        >
          <IconPlus />
        </button>
        {version ? (
          <span className="version" title={STRINGS.versionLabel}>
            v{version}
          </span>
        ) : null}
      </div>
      {/* The row stays on both tabs, the header keeps its height and the
          panel does not jump when the tab changes. */}
      <div className="header-row">
        <UsageGraph turns={usage} />
        <span className="tokens">
          {formatCount(tokens)} {STRINGS.tokens}
        </span>
      </div>
      {!hasApiKey ? (
        <div className="warning">
          <span className="warning-text">{STRINGS.noApiKey}</span>
          {tab !== 'settings' ? (
            // The notice leads to the place of the fix, the reader does not
            // have to look for the tab.
            <button className="secondary warning-action" onClick={() => onTab('settings')}>
              {STRINGS.openSettings}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
