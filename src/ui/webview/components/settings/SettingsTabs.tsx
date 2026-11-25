import { useState, type ReactNode } from 'react';
import type { UiMcpServer, UiSkill } from '../../../extrasProtocol';
import { STRINGS } from '../../strings';
import { McpSettings, type McpServerInput } from './McpSettings';
import { SkillsSettings } from './SkillsSettings';

type SettingsTab = 'general' | 'mcp' | 'skills';

// The settings in three tabs: the general form, the MCP servers and the
// skills. All three stay mounted, so a draft of a form survives the switch.
export function SettingsTabs({
  general,
  skills,
  servers,
  onOpenSkill,
  onRefresh,
  onAddServer,
  onRemoveServer,
  onRestartMcp,
  onOpenSettings
}: {
  general: ReactNode;
  skills: UiSkill[];
  servers: UiMcpServer[];
  onOpenSkill: (name: string) => void;
  onRefresh: () => void;
  onAddServer: (server: McpServerInput) => void;
  onRemoveServer: (name: string) => void;
  onRestartMcp: () => void;
  onOpenSettings: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>('general');
  const tabs: Array<[SettingsTab, string]> = [
    ['general', STRINGS.settingsGeneral],
    ['mcp', STRINGS.settingsMcp],
    ['skills', STRINGS.settingsSkills]
  ];
  const hidden = (name: SettingsTab) => (tab === name ? '' : ' view-hidden');
  return (
    <div className="settings-tabs-wrap">
      <div className="settings-tabs" role="tablist">
        {tabs.map(([name, label]) => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            className={'settings-tab' + (tab === name ? ' active' : '')}
            onClick={() => setTab(name)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={'settings-pane' + hidden('general')}>{general}</div>
      <div className={'settings-pane' + hidden('mcp')}>
        <McpSettings
          servers={servers}
          onAdd={onAddServer}
          onRemove={onRemoveServer}
          onRestart={onRestartMcp}
          onOpenSettings={onOpenSettings}
        />
      </div>
      <div className={'settings-pane' + hidden('skills')}>
        <SkillsSettings skills={skills} onOpen={onOpenSkill} onRefresh={onRefresh} />
      </div>
    </div>
  );
}
