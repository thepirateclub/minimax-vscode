// The output of a command for the model. The model wrapped every command in
// `cd app; npm run check 2>&1 | Select-Object -Last 20; "EXIT=$LASTEXITCODE"`:
// the tool did not say the exit code of a good run, cut a long output at the
// end where the errors of a build are, and passed the colors of the terminal
// through. Now the tool does it all: cwd, tail_lines, the exit code always.

// The colors and the cursor moves of the terminal.
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g, '');
}

// The last lines of the output, with the number of the lines left out.
export function tailLines(text: string, count: number): string {
  const lines = text.split('\n');
  if (count <= 0 || lines.length <= count) {
    return text;
  }
  return '[' + (lines.length - count) + ' earlier lines are cut]\n' + lines.slice(-count).join('\n');
}

// A long output keeps its head and its tail: the errors of a build and the
// summary of the tests stand at the end.
export function cutMiddle(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const head = Math.floor(limit * 0.2);
  const tail = limit - head;
  return text.slice(0, head) + '\n[... ' + (text.length - limit) + ' characters of the output are cut ...]\n' + text.slice(-tail);
}

// `cd app; npm test` or `cd app && npm test`: the folder goes to cwd, the
// rest is the command. A cd alone or a cd with more after the folder name
// stays as it is.
export function splitLeadingCd(command: string): { cwd: string; command: string } | undefined {
  const match = /^\s*(?:cd|Set-Location|pushd)\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:;|&&)\s*([\s\S]+)$/i.exec(command);
  if (!match) {
    return undefined;
  }
  return { cwd: (match[1] ?? '').replace(/^["']|["']$/g, ''), command: (match[2] ?? '').trim() };
}

// The script of PowerShell around the command: the exit code of the run is
// the code of the last native command, or 1 when a cmdlet failed. Without it
// a pipe into Select-Object or a string at the end made every run exit 0,
// so the model echoed $LASTEXITCODE by hand.
export function powershellScript(command: string): string {
  return [
    '$global:LASTEXITCODE = 0',
    command,
    '$mmOk = $?',
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    'if (-not $mmOk) { exit 1 }',
    'exit 0'
  ].join('\n');
}

// The same on Linux and macOS: a pipe gives the code of its last command,
// `make | tail` exits 0 when make fails. pipefail fixes it where the shell
// has it; dash has not, and `set` of an unknown option would end the shell,
// so the option is tried in a subshell first.
export function posixScript(command: string): string {
  return '(set -o pipefail) 2>/dev/null && set -o pipefail\n' + command;
}

// The tail of the exit code the model added by hand: `; "EXIT=$LASTEXITCODE"`,
// `; echo $?`. The tool reports the code itself.
export function dropExitEcho(command: string): string {
  return command.replace(/\s*;\s*(?:echo\s+)?["']?[\w ]*=?\$(?:LASTEXITCODE|\?)["']?\s*$/i, '');
}
