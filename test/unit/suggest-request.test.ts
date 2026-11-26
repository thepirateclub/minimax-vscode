import { describe, expect, it } from 'vitest';
import { dropSuggestions, isLatestSuggestion, nextSuggestionId } from '../../src/ui/webview/suggestRequest';

describe('the hints of @', () => {
  it('take only the answer to the latest request', () => {
    const first = nextSuggestionId();
    const second = nextSuggestionId();
    expect(isLatestSuggestion(first)).toBe(false);
    expect(isLatestSuggestion(second)).toBe(true);
    dropSuggestions();
    expect(isLatestSuggestion(second)).toBe(false);
  });
});
