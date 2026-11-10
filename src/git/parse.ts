export interface GitFileState {
  path: string;
  // The state in the index and the state in the working tree.
  staged: string;
  unstaged: string;
  oldPath?: string;
}

export interface GitStatus {
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  detached: boolean;
  files: GitFileState[];
}

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  upstream: string;
  track: string;
}

export interface GitBlameLine {
  commit: string;
  author: string;
  line: number;
  text: string;
}

// The output of "git status --porcelain=v1 -b".
export function parseStatus(output: string): GitStatus {
  const status: GitStatus = {
    branch: '',
    upstream: '',
    ahead: 0,
    behind: 0,
    detached: false,
    files: []
  };
  for (const raw of output.split(/\r?\n/)) {
    if (raw.length === 0) {
      continue;
    }
    if (raw.startsWith('## ')) {
      readBranchHeader(raw.slice(3), status);
      continue;
    }
    // The ignored files are not a part of the work.
    if (raw.startsWith('!!')) {
      continue;
    }
    if (raw.length < 4) {
      continue;
    }
    const staged = raw.charAt(0);
    const unstaged = raw.charAt(1);
    if (staged === ' ' && unstaged === ' ') {
      continue;
    }
    const rest = raw.slice(3);
    const arrow = rest.indexOf(' -> ');
    if (arrow >= 0) {
      status.files.push({
        path: rest.slice(arrow + 4),
        oldPath: rest.slice(0, arrow),
        staged,
        unstaged
      });
      continue;
    }
    status.files.push({ path: rest, staged, unstaged });
  }
  return status;
}

// The header of the status: "main...origin/main [ahead 1, behind 2]".
function readBranchHeader(header: string, status: GitStatus): void {
  const bracket = header.indexOf('[');
  const names = (bracket >= 0 ? header.slice(0, bracket) : header).trim();
  const track = bracket >= 0 ? header.slice(bracket + 1).replace(/\]$/, '') : '';
  const dots = names.indexOf('...');
  if (dots >= 0) {
    status.branch = names.slice(0, dots).trim();
    status.upstream = names.slice(dots + 3).trim();
  } else {
    status.branch = names;
  }
  if (status.branch.startsWith('HEAD')) {
    status.detached = true;
    status.branch = 'HEAD';
  }
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  status.ahead = ahead ? Number(ahead[1]) : 0;
  status.behind = behind ? Number(behind[1]) : 0;
}

// The output of "git log --pretty=format:%h%x09%an%x09%ad%x09%s".
export function parseLog(output: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    const parts = line.split('\t');
    if (parts.length < 4) {
      continue;
    }
    commits.push({
      hash: (parts[0] ?? '').trim(),
      author: (parts[1] ?? '').trim(),
      date: (parts[2] ?? '').trim(),
      subject: parts.slice(3).join('\t').trim()
    });
  }
  return commits;
}

// The output of "git branch --format=%(refname:short)%09%(HEAD)%09...".
export function parseBranches(output: string): GitBranchInfo[] {
  const branches: GitBranchInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    const parts = line.split('\t');
    const name = (parts[0] ?? '').trim();
    if (name.length === 0) {
      continue;
    }
    branches.push({
      name,
      current: (parts[1] ?? '').trim() === '*',
      upstream: (parts[2] ?? '').trim(),
      track: (parts[3] ?? '').trim()
    });
  }
  return branches;
}

// The output of "git blame --porcelain".
export function parseBlame(output: string): GitBlameLine[] {
  const lines: GitBlameLine[] = [];
  let commit = '';
  let author = '';
  let number = 0;
  for (const raw of output.split(/\r?\n/)) {
    if (raw.startsWith('\t')) {
      lines.push({ commit, author, line: number, text: raw.slice(1) });
      continue;
    }
    // The header of a block: the hash and the numbers of the lines.
    const header = /^([0-9a-f]{40})\s+\d+\s+(\d+)/.exec(raw);
    if (header) {
      commit = (header[1] ?? '').slice(0, 7);
      number = Number(header[2]);
      author = '';
      continue;
    }
    if (raw.startsWith('author ')) {
      author = raw.slice(7).trim();
    }
  }
  return lines;
}

export interface GitWorktree {
  path: string;
  head: string;
  branch: string;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

// The output of "git worktree list --porcelain".
export function parseWorktrees(output: string): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  let current: GitWorktree | undefined;
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }
    if (line.startsWith('worktree ')) {
      current = {
        path: line.slice('worktree '.length).trim(),
        head: '',
        branch: '',
        detached: false,
        locked: false,
        prunable: false
      };
      worktrees.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim();
      continue;
    }
    if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length).trim();
      current.branch = ref.startsWith('refs/heads/')
        ? ref.slice('refs/heads/'.length)
        : ref;
      continue;
    }
    if (line === 'detached') {
      current.detached = true;
      continue;
    }
    if (line.startsWith('locked')) {
      current.locked = true;
      continue;
    }
    if (line.startsWith('prunable')) {
      current.prunable = true;
    }
  }
  return worktrees;
}