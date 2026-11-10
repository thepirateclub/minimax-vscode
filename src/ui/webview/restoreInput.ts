export interface RestoreSegment {
  kind: 'text' | 'mention';
  value: string;
}

// The text of a request keeps the references to the files as "@path", the
// mentions carry the paths in the order they were added. The restore turns
// the text back into the chips of the input field.
export function splitRestore(text: string, mentions: string[]): RestoreSegment[] {
  const segments: RestoreSegment[] = [];
  const missing: string[] = [];
  let rest = text;
  for (const path of mentions) {
    if (!path) {
      continue;
    }
    const marker = '@' + path;
    const at = rest.indexOf(marker);
    if (at === -1) {
      // The path is not in the text, the file still belongs to the request.
      missing.push(path);
      continue;
    }
    if (at > 0) {
      segments.push({ kind: 'text', value: rest.slice(0, at) });
    }
    segments.push({ kind: 'mention', value: path });
    rest = rest.slice(at + marker.length);
  }
  if (rest.length > 0) {
    segments.push({ kind: 'text', value: rest });
  }
  for (const path of missing) {
    segments.push({ kind: 'mention', value: path });
  }
  return segments;
}
