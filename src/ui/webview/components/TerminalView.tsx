import { useMemo } from 'react';
import { IconCopy } from '../icons';
import { STRINGS } from '../strings';
import { parseTerminalOutput } from '../terminalOutput';

// The output of a command is shown as a terminal: the command stands on its
// own line, the failure of it is red, the rest of the output stays quiet.
export function TerminalView({ command, content }: { command: string; content: string }) {
  const lines = useMemo(() => parseTerminalOutput(command, content), [command, content]);
  const body = lines.filter((line) => line.kind !== 'command');
  // The copy gives the transcript of the terminal, the command included.
  const transcript = [command, ...body.map((line) => line.text)].join('\n');
  return (
    <div className="term">
      <button
        className="tool-copy"
        title={STRINGS.copy}
        aria-label={STRINGS.copy}
        onClick={() => {
          void navigator.clipboard?.writeText(transcript);
        }}
      >
        <IconCopy />
      </button>
      <div className="term-command">
        <span className="term-prompt" aria-hidden="true">
          $
        </span>
        <span className="term-cmd-text">{command}</span>
      </div>
      <div className="term-body">
        {body.map((line, index) => (
          <div key={index} className={'term-line term-line-' + line.kind}>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}
