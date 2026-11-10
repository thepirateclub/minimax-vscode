import { useMemo, useState } from 'react';
import { STRINGS } from '../strings';
import { CopyButton } from './CopyButton';
import { parseTerminalOutput } from '../terminalOutput';

// The output of a command is shown as a terminal: the command stands on its
// own line, the failure of it is red, the rest of the output stays quiet.
export function TerminalView({
  command,
  content,
  running = false
}: {
  command: string;
  content: string;
  // A command without a result yet shows that it runs.
  running?: boolean;
}) {
  // A long command takes three lines, a click opens the rest of it.
  const [open, setOpen] = useState(false);
  const lines = useMemo(() => parseTerminalOutput(command, content), [command, content]);
  const body = lines.filter((line) => line.kind !== 'command');
  // The copy gives the transcript of the terminal, the command included.
  const transcript = [command, ...body.map((line) => line.text)].join('\n');
  return (
    <div className="term">
      <CopyButton text={transcript} />
      <button
        className={'term-command' + (open ? ' term-command-open' : '')}
        title={command}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="term-prompt" aria-hidden="true">
          $
        </span>
        <span className="term-cmd-text">{command}</span>
      </button>
      <div className="term-body">
        {running && body.length === 0 ? (
          <div className="term-line term-line-note">{STRINGS.toolRunning}</div>
        ) : null}
        {body.map((line, index) => (
          <div key={index} className={'term-line term-line-' + line.kind}>
            {line.stream === 'stderr' ? <span className="term-chip">stderr</span> : null}
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}
