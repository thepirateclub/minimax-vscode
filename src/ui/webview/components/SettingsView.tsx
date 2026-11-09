import { useEffect, useState } from 'react';
import type { UiSettings, UiSettingsValues } from '../../protocol';
import { STRINGS } from '../strings';

function toValues(settings: UiSettings): UiSettingsValues {
  return {
    baseUrl: settings.baseUrl,
    customBaseUrl: settings.customBaseUrl,
    model: settings.model,
    effort: settings.effort,
    mode: settings.mode,
    maxTokens: settings.maxTokens,
    maxIterations: settings.maxIterations,
    autoApprove: settings.autoApprove,
    rulesEnabled: settings.rulesEnabled,
    enableWebSearch: settings.enableWebSearch
  };
}

export function SettingsView({
  settings,
  onSave,
  onSetApiKey,
  onClearApiKey
}: {
  settings: UiSettings;
  onSave: (values: UiSettingsValues) => void;
  onSetApiKey: (key: string) => void;
  onClearApiKey: () => void;
}) {
  const [values, setValues] = useState<UiSettingsValues>(() => toValues(settings));
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValues(toValues(settings));
  }, [settings]);

  const patch = (part: Partial<UiSettingsValues>): void => {
    setValues((previous) => ({ ...previous, ...part }));
    setSaved(false);
  };

  const toggleTool = (name: string): void => {
    const next = values.autoApprove.includes(name)
      ? values.autoApprove.filter((item) => item !== name)
      : [...values.autoApprove, name];
    patch({ autoApprove: next });
  };

  return (
    <div className="settings">
      <section className="settings-section">
        <h3>{STRINGS.apiKey}</h3>
        <p className="hint">{STRINGS.apiKeyHint}</p>
        <div className="settings-row">
          <input
            type="password"
            value={apiKey}
            placeholder={settings.hasApiKey ? STRINGS.apiKeySaved : ''}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <button
            disabled={apiKey.trim().length === 0}
            onClick={() => {
              onSetApiKey(apiKey);
              setApiKey('');
            }}
          >
            {STRINGS.save}
          </button>
          {settings.hasApiKey ? (
            <button className="secondary" onClick={onClearApiKey}>
              {STRINGS.remove}
            </button>
          ) : null}
        </div>
      </section>

      <section className="settings-section">
        <h3>{STRINGS.endpoint}</h3>
        <select
          value={values.baseUrl}
          onChange={(event) =>
            patch({ baseUrl: event.target.value as UiSettingsValues['baseUrl'] })
          }
        >
          <option value="auto">{STRINGS.endpointAuto}</option>
          <option value="global">{STRINGS.endpointGlobal}</option>
          <option value="china">{STRINGS.endpointChina}</option>
        </select>
        <label className="field">
          <span>{STRINGS.customBaseUrl}</span>
          <input
            type="text"
            value={values.customBaseUrl}
            placeholder="https://api.minimax.io/anthropic"
            onChange={(event) => patch({ customBaseUrl: event.target.value })}
          />
          <span className="hint">{STRINGS.customBaseUrlHint}</span>
        </label>
      </section>

      <section className="settings-section">
        <h3>{STRINGS.model}</h3>
        <select value={values.model} onChange={(event) => patch({ model: event.target.value })}>
          {settings.models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <label className="field">
          <span>{STRINGS.effort}</span>
          <select
            value={values.effort}
            onChange={(event) =>
              patch({ effort: event.target.value as UiSettingsValues['effort'] })
            }
          >
            {(['low', 'medium', 'high', 'xhigh', 'max'] as const).map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{STRINGS.mode}</span>
          <select
            value={values.mode}
            onChange={(event) =>
              patch({ mode: event.target.value as UiSettingsValues['mode'] })
            }
          >
            {(['plan', 'code'] as const).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <span className="hint">
            {values.mode === 'plan' ? STRINGS.modePlanHint : STRINGS.modeCodeHint}
          </span>
        </label>
      </section>

      <section className="settings-section">
        <h3>{STRINGS.autoApprove}</h3>
        <p className="hint">{STRINGS.autoApproveHint}</p>
        {settings.tools.map((tool) => (
          <label key={tool} className="checkbox">
            <input
              type="checkbox"
              checked={values.autoApprove.includes(tool)}
              onChange={() => toggleTool(tool)}
            />
            <span>{tool}</span>
          </label>
        ))}
      </section>

      <section className="settings-section">
        <h3>Limits</h3>
        <label className="field">
          <span>{STRINGS.maxTokens}</span>
          <input
            type="number"
            min={4096}
            max={65536}
            step={1024}
            value={values.maxTokens}
            onChange={(event) => patch({ maxTokens: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>{STRINGS.maxIterations}</span>
          <input
            type="number"
            min={1}
            max={200}
            value={values.maxIterations}
            onChange={(event) => patch({ maxIterations: Number(event.target.value) })}
          />
        </label>
      </section>

      <section className="settings-section">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={values.rulesEnabled}
            onChange={(event) => patch({ rulesEnabled: event.target.checked })}
          />
          <span>{STRINGS.rules}</span>
        </label>
        <p className="hint">{STRINGS.rulesHint}</p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={values.enableWebSearch}
            onChange={(event) => patch({ enableWebSearch: event.target.checked })}
          />
          <span>{STRINGS.webSearch}</span>
        </label>
        <p className="hint">{STRINGS.webSearchHint}</p>
      </section>

      <div className="settings-actions">
        <button
          onClick={() => {
            onSave(values);
            setSaved(true);
          }}
        >
          {STRINGS.save}
        </button>
        {saved ? <span className="saved">{STRINGS.saved}</span> : null}
      </div>
    </div>
  );
}
