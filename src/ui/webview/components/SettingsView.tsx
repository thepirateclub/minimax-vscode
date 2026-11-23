import { useEffect, useState } from 'react';
import type { UiSettings, UiSettingsValues } from '../../protocol';
import { STRINGS } from '../strings';
import { Field } from './settings/Field';
import { LimitsSection } from './settings/LimitsSection';
import { ModelSection } from './settings/ModelSection';

function toValues(settings: UiSettings): UiSettingsValues {
  return {
    baseUrl: settings.baseUrl,
    customBaseUrl: settings.customBaseUrl,
    model: settings.model,
    effort: settings.effort,
    mode: settings.mode,
    thinking: settings.thinking,
    maxIterations: settings.maxIterations,
    maxRetries: settings.maxRetries,
    fontSize: settings.fontSize,
    historyMaxMessages: settings.historyMaxMessages,
    contextThreshold: settings.contextThreshold,
    semanticSearch: settings.semanticSearch,
    autoApprove: settings.autoApprove,
    rulesEnabled: settings.rulesEnabled,
    enableWebSearch: settings.enableWebSearch,
    collapseTools: settings.collapseTools,
    collapseCode: settings.collapseCode,
    showToolSteps: settings.showToolSteps,
    speechLanguage: settings.speechLanguage,
    microphone: settings.microphone
  };
}

// The languages of the recognition of MiniMax, an empty code lets the model
// pick the dominant language of the audio.
const SPEECH_LANGUAGES: Array<[string, string]> = [
  ['', 'Auto'],
  ['ru', 'Russian'],
  ['en', 'English'],
  ['uk', 'Ukrainian'],
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['pl', 'Polish'],
  ['tr', 'Turkish'],
  ['ar', 'Arabic'],
  ['zh', 'Chinese'],
  ['yue', 'Cantonese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['th', 'Thai'],
  ['vi', 'Vietnamese'],
  ['id', 'Indonesian'],
  ['ms', 'Malay'],
  ['fil', 'Filipino']
];

// The limit of the answer belongs to the model, the panel only shows it.
function modelMaxTokens(settings: UiSettings, model: string): string {
  const found = settings.models.find((item) => item.id === model);
  return found ? String(found.maxTokens) : '-';
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
        <Field label={STRINGS.customBaseUrl} hint={STRINGS.customBaseUrlHint}>
          <input
            type="text"
            value={values.customBaseUrl}
            placeholder="https://api.minimax.io/anthropic"
            onChange={(event) => patch({ customBaseUrl: event.target.value })}
          />
        </Field>
      </section>

      <ModelSection models={settings.models} values={values} patch={patch} />

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

      <LimitsSection
        values={values}
        maxTokens={modelMaxTokens(settings, values.model)}
        patch={patch}
      />

      <section className="settings-section">
        <h3>{STRINGS.appearance}</h3>
        <Field label={STRINGS.fontSize} hint={STRINGS.fontSizeHint}>
          <input
            type="number"
            min={10}
            max={22}
            step={1}
            value={values.fontSize}
            onChange={(event) => patch({ fontSize: Number(event.target.value) })}
          />
        </Field>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={values.collapseTools}
            onChange={(event) => patch({ collapseTools: event.target.checked })}
          />
          <span>{STRINGS.collapseTools}</span>
        </label>
        <p className="hint">{STRINGS.collapseToolsHint}</p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={values.collapseCode}
            onChange={(event) => patch({ collapseCode: event.target.checked })}
          />
          <span>{STRINGS.collapseCode}</span>
        </label>
        <p className="hint">{STRINGS.collapseCodeHint}</p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={values.showToolSteps}
            onChange={(event) => patch({ showToolSteps: event.target.checked })}
          />
          <span>{STRINGS.showToolSteps}</span>
        </label>
        <p className="hint">{STRINGS.showToolStepsHint}</p>
      </section>

      <section className="settings-section">
        <h3>{STRINGS.voice}</h3>
        <p className="hint">{STRINGS.voiceHint}</p>
        <Field label={STRINGS.speechLanguage}>
          <select
            value={values.speechLanguage}
            onChange={(event) => patch({ speechLanguage: event.target.value })}
          >
            {SPEECH_LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={STRINGS.microphone} hint={STRINGS.microphoneHint}>
          <input
            type="text"
            value={values.microphone}
            placeholder={STRINGS.microphoneAuto}
            onChange={(event) => patch({ microphone: event.target.value })}
          />
        </Field>
      </section>

      <section className="settings-section">
        <h3>{STRINGS.search}</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={values.semanticSearch}
            onChange={(event) => patch({ semanticSearch: event.target.checked })}
          />
          <span>{STRINGS.semanticSearch}</span>
        </label>
        <p className="hint">{STRINGS.semanticSearchHint}</p>
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
