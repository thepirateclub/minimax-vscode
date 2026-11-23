import type { ReactNode } from 'react';
import type { EffortLevel } from '../../../../api/types';
import type { ModelInfo } from '../../../../config/models';
import type { UiSettingsValues } from '../../../protocol';
import { currentReasoning, reasoningControl, reasoningOptions } from '../../reasoning';
import { STRINGS } from '../../strings';
import { Field } from './Field';

interface ModelSectionProps {
  models: ModelInfo[];
  values: UiSettingsValues;
  patch: (part: Partial<UiSettingsValues>) => void;
}

// The model of the panel with the reasoning and the mode: the three controls
// belong to one section, the view keeps the values and the change of them.
export function ModelSection({ models, values, patch }: ModelSectionProps): ReactNode {
  return (
    <section className="settings-section">
      <h3>{STRINGS.model}</h3>
      <select value={values.model} onChange={(event) => patch({ model: event.target.value })}>
        {models.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      <Field
        label={STRINGS.reasoning}
        hint={
          reasoningControl(values.model) === 'variants'
            ? STRINGS.reasoningVariantsHint
            : STRINGS.reasoningDepthHint
        }
      >
        <select
          value={currentReasoning(values.model, values.effort, values.thinking)}
          onChange={(event) => {
            const next = event.target.value;
            if (next === 'off' || next === 'adaptive') {
              patch({ thinking: next === 'adaptive' });
              return;
            }
            patch({ effort: next as EffortLevel });
          }}
        >
          {reasoningOptions(values.model).map((option) => (
            <option key={option} value={option}>
              {option === 'off'
                ? STRINGS.reasoningOff
                : option === 'adaptive'
                  ? STRINGS.reasoningAdaptive
                  : option}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label={STRINGS.mode}
        hint={values.mode === 'plan' ? STRINGS.modePlanHint : STRINGS.modeCodeHint}
      >
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
      </Field>
    </section>
  );
}
