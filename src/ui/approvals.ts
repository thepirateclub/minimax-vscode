import type { DiffLine } from '../tools/diff';
import type { ToolEntry } from '../tools/types';

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
  private readonly sessionApproved = new Set<string>();
  private readonly autoApprove: string[];
  private readonly request: (request: ApprovalRequest) => Promise<ApprovalDecision>;

  constructor(options: {
    autoApprove: string[];
    request: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  }) {
    this.autoApprove = options.autoApprove;
    this.request = options.request;
  }

  async approve(entry: ToolEntry, input: Record<string, unknown>): Promise<ApprovalDecision> {
    if (entry.approval === 'never') {
      return { approved: true, allowForSession: false };
    }
    if (this.autoApprove.includes(entry.name) || this.sessionApproved.has(entry.name)) {
      return { approved: true, allowForSession: false };
    }
    const decision = await this.request({
      id: entry.name + '-' + Date.now().toString(36),
      toolName: entry.name,
      input
    });
    if (decision.approved && decision.allowForSession) {
      this.sessionApproved.add(entry.name);
    }
    return decision;
  }
}
