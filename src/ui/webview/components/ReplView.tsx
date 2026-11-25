import { useMemo } from 'react';
import { STRINGS } from '../strings';
import { CopyButton } from './CopyButton';
import { highlight } from '../highlight';
import { parseReplOutput, replLanguage } from '../replOutput';

// A block of the REPL is shown as a cell of a notebook: the code with the
// colors of its language on top, the output under it like a terminal. The
// arguments of the tool stood as json before, the code read as one line
// of escaped breaks.
export function ReplView({
  toolName,
  code,
  content,
  running = false
}: {
  toolName: string;
  code: string;
  content: string;
  running?: boolean;
}) {
  const language = replLanguage(toolName);
  const lines = useMemo(
    () => code.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n').map((line) => highlight(line, language)),
    [code, language]
  );
  const output = useMemo(() => parseReplOutput(content), [content]);
  return (
    <div className="term repl">
      <div className="term-head">
        <CopyButton text={code + (content ? '\n\n' + content : '')} />
        <pre className="repl-code">
          {lines.map((html, index) => (
            <span key={index} className="repl-code-line" dangerouslySetInnerHTML={{ __html: html || ' ' }} />
          ))}
        </pre>
      </div>
      <div className="term-body">
        {running && output.length === 0 ? (
          <div className="term-line term-line-note">{STRINGS.toolRunning}</div>
        ) : null}
        {output.map((line, index) => (
          <div key={index} className={'term-line term-line-' + line.kind}>
            {line.stream === 'stderr' ? <span className="term-chip">stderr</span> : null}
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}
