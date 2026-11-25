import { useState } from 'react';
import type { UiMcpServer } from '../../../extrasProtocol';
import { STRINGS } from '../../strings';
import { IconClose, IconRefresh } from '../../icons';
import { parseServerForm } from '../../mcpForm';

export interface McpServerInput {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
}

// The tab MCP: the servers of the agent with their state and tools, a form
// to add a server to the setting minimax.mcpServers, the restart of all of
// them and the settings.json for the rest (the env, the headers).
export function McpSettings({
  servers,
  onAdd,
  onRemove,
  onRestart,
  onOpenSettings
}: {
  servers: UiMcpServer[];
  onAdd: (server: McpServerInput) => void;
  onRemove: (name: string) => void;
  onRestart: () => void;
  onOpenSettings: () => void;
}) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const form = parseServerForm(name, target);
  const add = () => {
    if (form.ok) {
      onAdd(form.server);
      setName('');
      setTarget('');
    }
  };
  return (
    <div className="settings-extras">
      <div className="extras-head">
        <p className="settings-hint">{STRINGS.mcpHint}</p>
        <button className="secondary" onClick={onRestart} title={STRINGS.mcpRestart}>
          <IconRefresh /> {STRINGS.mcpRestart}
        </button>
      </div>
      {servers.length === 0 ? <p className="extras-empty">{STRINGS.mcpEmpty}</p> : null}
      <ul className="extras-list">
        {servers.map((server) => (
          <li key={server.name} className="extras-server">
            <div className="extras-row">
              <span className={'mcp-dot mcp-' + server.status} title={server.status} aria-label={server.status} />
              <span className="extras-name">{server.name}</span>
              <span className="extras-detail">{server.target}</span>
              {server.removable ? (
                <button
                  className="icon-button"
                  title={STRINGS.mcpRemove}
                  aria-label={STRINGS.mcpRemove}
                  onClick={() => onRemove(server.name)}
                >
                  <IconClose />
                </button>
              ) : null}
            </div>
            <div className="extras-meta">
              {server.status === 'failed'
                ? server.error ?? STRINGS.mcpFailed
                : server.tools.length + ' ' + STRINGS.mcpTools + (server.tools.length > 0 ? ': ' + server.tools.join(', ') : '')}
              {' · ' + server.source}
            </div>
          </li>
        ))}
      </ul>
      <div className="extras-form">
        <h3 className="extras-title">{STRINGS.mcpAdd}</h3>
        <input value={name} placeholder={STRINGS.mcpNamePlaceholder} onChange={(event) => setName(event.target.value)} />
        <input
          value={target}
          placeholder={STRINGS.mcpTargetPlaceholder}
          onChange={(event) => setTarget(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              add();
            }
          }}
        />
        {!form.ok && form.error ? <p className="extras-error">{form.error}</p> : null}
        <div className="extras-actions">
          <button disabled={!form.ok} onClick={add}>
            {STRINGS.mcpAddButton}
          </button>
          <button className="secondary" onClick={onOpenSettings}>
            {STRINGS.mcpOpenSettings}
          </button>
        </div>
      </div>
    </div>
  );
}
