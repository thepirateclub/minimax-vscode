// The model kept its scratch in the project: a script in the REPL or the
// shell cut functions out of the files and wrote the pieces into temp/ to
// read them back, the folder grew ach.txt, final.txt, final2.txt. The tools
// do that work now (compare with symbol_a and symbol_b, grep with symbol and
// count_only, read_symbol), and the notes keep the findings. A write into a
// scratch folder of the project is refused with the name of the right tool.

const SCRATCH = '(?:temp|tmp|scratch)';

// A path of the workspace inside a scratch folder at its root.
export function isScratchPath(path: string): boolean {
  return new RegExp('^(?:\\./)?' + SCRATCH + '(?:/|$)', 'i').test(path.replace(/\\/g, '/').trim());
}

// A write into a scratch folder: a redirect of the shell, a write call of
// Node or Python, Out-File or Set-Content of PowerShell.
export function writesScratch(code: string): boolean {
  const target = '[\'"`]?(?:\\./)?' + SCRATCH + '[\\\\/]';
  return [
    new RegExp('>>?\\s*' + target, 'i'),
    new RegExp('(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\\s*\\(\\s*' + target, 'i'),
    new RegExp('open\\s*\\(\\s*' + target + '[^)]*,\\s*[\'"][wa]', 'i'),
    new RegExp('(?:Out-File|Set-Content|Add-Content|Tee-Object)\\b[^|;]*?' + target, 'i')
  ].some((pattern) => pattern.test(code));
}

export const SCRATCH_REFUSAL =
  'Refused: do not keep scratch files in temp/, tmp/ or scratch/ of the project. ' +
  'Print the result instead of writing it, keep a finding with note_write, ' +
  'compare two functions with compare (path_a, symbol_a, path_b, symbol_b), ' +
  'count or find lines inside a function with grep (path, symbol, count_only) ' +
  'and read a function with read_symbol.';
