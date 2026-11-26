// The answers of the host to the hints of `@` come back in any order: the
// answer to `@s` could land after the answer to `@src/ui` and show the old
// list, or bring a list back after the hints were closed. Every request has
// its own id, only the answer to the latest one counts.
let latest = 0;

export function nextSuggestionId(): string {
  latest += 1;
  return 'suggestions-' + latest;
}

// The hints are closed: an answer that is still on its way is stale.
export function dropSuggestions(): void {
  latest += 1;
}

export function isLatestSuggestion(requestId: string): boolean {
  return requestId === 'suggestions-' + latest;
}
