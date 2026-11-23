import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsView } from '../../src/ui/webview/components/SettingsView';
import { SETTINGS } from '../helpers/settingsFixture';

function markup(): string {
  return renderToStaticMarkup(
    createElement(SettingsView, {
      settings: SETTINGS,
      onSave: () => undefined,
      onSetApiKey: () => undefined,
      onClearApiKey: () => undefined
    })
  );
}

describe('the settings of the panel', () => {
  it('names every section of the settings', () => {
    const html = markup();
    for (const className of [
      'settings-section',
      'settings-row',
      'field',
      'hint'
    ]) {
      expect(html).toContain(className);
    }
  });

  it('shows the model and the endpoint of the panel', () => {
    const html = markup();
    expect(html).toContain('MiniMax');
    expect(html).toContain('api.minimax.io');
  });
});
