import type { ReactNode } from 'react';
import type { UiSettingsValues } from '../../../protocol';
import { STRINGS } from '../../strings';
import { Field } from './Field';

interface LimitsSectionProps {
  values: UiSettingsValues;
  // The limit of the answer belongs to the model, the panel only shows it.
  maxTokens: string;
  patch: (part: Partial<UiSettingsValues>) => void;
}

// The limits of one turn: the tokens of the model and the counters of the
// agent. The view keeps the values and the change of them.
export function LimitsSection({ values, maxTokens, patch }: LimitsSectionProps): ReactNode {
  return (
    <section className="settings-section">
      <h3>Limits</h3>
      <Field label={STRINGS.maxTokens} hint={STRINGS.maxTokensHint}>
        <span className="value">{maxTokens}</span>
      </Field>
      <Field label={STRINGS.maxIterations}>
        <input
          type="number"
          min={1}
          max={200}
          value={values.maxIterations}
          onChange={(event) => patch({ maxIterations: Number(event.target.value) })}
        />
      </Field>
      <Field label={STRINGS.maxRetries} hint={STRINGS.maxRetriesHint}>
        <input
          type="number"
          min={0}
          max={20}
          step={1}
          value={values.maxRetries}
          onChange={(event) => patch({ maxRetries: Number(event.target.value) })}
        />
      </Field>
      <Field label={STRINGS.historyMaxMessages} hint={STRINGS.historyMaxMessagesHint}>
        <input
          type="number"
          min={10}
          max={1000}
          step={10}
          value={values.historyMaxMessages}
          onChange={(event) => patch({ historyMaxMessages: Number(event.target.value) })}
        />
      </Field>
      <Field label={STRINGS.contextThreshold} hint={STRINGS.contextThresholdHint}>
        <input
          type="number"
          min={5}
          max={95}
          step={5}
          value={values.contextThreshold}
          onChange={(event) => patch({ contextThreshold: Number(event.target.value) })}
        />
      </Field>
    </section>
  );
}
