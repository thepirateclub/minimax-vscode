import type { DiffLine } from '../tools/diff';
import type { ToolEntry } from '../tools/types';
import { alwaysConfirms, ruleAllows, ruleFor } from './approvalScope';

export interface DiffPreview {
  path: string;
  lines: DiffLine[];
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  preview?: DiffPreview;
}

export interface ApprovalDecision {
  approved: boolean;
  allowForSession: boolean;
}

export class ApprovalGate {
  // The permissions of the session, the rules of src/ui/approvalScope.ts.
  // The gate of the parent and the gate of a child share one list, a
  // permission that the reader gave to one of them works for the other too.
  private readonly sessionApproved: Set<string>;
  private autoApprove: string[];
  private counter = 0;
  private readonly request: (request: ApprovalRequest) => Promise<ApprovalDecision>;

  constructor(options: {
    autoApprove: string[];
    request: (request: ApprovalRequest) => Promise<ApprovalDecision>;
    // The list of the permissions of the session. The gate keeps a list of
    // its own when it is not given.
    sessionApproved?: Set<string>;
  }) {
    this.autoApprove = options.autoApprove;
    this.request = options.request;
    this.sessionApproved = options.sessionApproved ?? new Set<string>();
  }

  setAutoApprove(names: string[]): void {
    this.autoApprove = [...names];
  }

  async approve(entry: ToolEntry, input: Record<string, unknown>): Promise<ApprovalDecision> {
    if (entry.approval === 'never') {
      return { approved: true, allowForSession: false };
    }
    // A tool that always asks is never covered by a rule of the reader:
    // the deletion of a file is never silent.
    const rules = alwaysConfirms(entry.name, input)
      ? []
      : [...this.autoApprove, ...this.sessionApproved];
    if (rules.some((rule) => ruleAllows(rule, entry.name, input))) {
      return { approved: true, allowForSession: false };
    }
    this.counter += 1;
    const decision = await this.request({
      // Two calls of one tool in the same millisecond are two approvals,
      // the counter tells them apart.
      id: entry.name + '-' + Date.now().toString(36) + '-' + this.counter,
      toolName: entry.name,
      input
    });
    if (decision.approved && decision.allowForSession && !alwaysConfirms(entry.name, input)) {
      // The grant has the scope of this call: the prefix of the command,
      // the folder of the write, the tool for the rest. A tool that always
      // asks keeps no grant, the next call asks again.
      this.sessionApproved.add(ruleFor(entry.name, input));
    }
    return decision;
  }
}
