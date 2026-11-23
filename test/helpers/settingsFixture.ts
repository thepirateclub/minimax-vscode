import { MODELS } from '../../src/config/models';
import type { UiSettings } from '../../src/ui/protocol';

// The settings of the panel for the stand and for the tests: one object for
// both, so the eye and the test look at the same markup.
export const SETTINGS: UiSettings = {
  baseUrl: 'auto',
  customBaseUrl: '',
  model: MODELS[0]!.id,
  effort: 'max',
  mode: 'code',
  thinking: false,
  maxIterations: 25,
  maxRetries: 5,
  fontSize: 13,
  showToolSteps: true,
  historyMaxMessages: 200,
  contextThreshold: 50,
  semanticSearch: false,
  autoApprove: ['read_file'],
  rulesEnabled: true,
  enableWebSearch: false,
  collapseTools: false,
  collapseCode: false,
  speechLanguage: 'ru',
  microphone: '',
  hasApiKey: true,
  models: MODELS,
  tools: ['read_file', 'write_file', 'edit_file', 'list_files', 'search_code', 'run_terminal']
};

// The catalog of the models belongs to the extension, the fixture only points
// at it.
export { MODELS };
