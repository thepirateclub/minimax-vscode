// A call of a tool that came as text. The model writes its calls in its own
// markup, the server turns them into tool_use blocks; sometimes the markup
// slips into the text, broken: `]<]minimax[>[invoke name="read_file">`, or
// whole: `<minimax:tool_call><invoke name="read_file">`. Such a call never
// runs, the model waits for a result that does not come, and the reader sees
// the litter of the markup in the answer.

const MARKERS = [/\]<\]minimax\[>\[/, /<\/?minimax:tool_call>/, /<invoke\s+name="[^"]*">/];
const INVOKE = /invoke\s+name="([^"]+)"/;

export interface LeakedCall {
  // The tool the model meant, when the markup names it.
  tool?: string;
  // Where the markup starts in the text.
  index: number;
}

export function findLeakedCall(text: string): LeakedCall | undefined {
  let index = -1;
  for (const marker of MARKERS) {
    const match = marker.exec(text);
    if (match && (index === -1 || match.index < index)) {
      index = match.index;
    }
  }
  if (index === -1) {
    return undefined;
  }
  const tool = INVOKE.exec(text.slice(index))?.[1];
  return tool ? { tool, index } : { index };
}

// The text without the markup: everything from the first marker on is the
// call and its broken tail, the words before it stay.
export function stripLeakedCalls(text: string): string {
  const leak = findLeakedCall(text);
  return leak ? text.slice(0, leak.index).trimEnd() : text;
}

// The message to the model after such an answer: the call did not run, it
// has to come as a call of the tool.
export function leakedCallNotice(leak: LeakedCall): string {
  return (
    '[Your call' + (leak.tool ? ' of ' + leak.tool : '') +
    ' came as plain text in the answer and did not run. Call the tool again through the tools API, not as text.]'
  );
}
