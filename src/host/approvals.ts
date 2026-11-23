import type { MiniMaxController } from '../extension';
import { ApprovalGate, type ApprovalDecision, type ApprovalRequest } from '../ui/approvals';
import { buildPreview } from '../tools/preview';
import { getSettings } from '../config/settings';
import type { AgentSession } from '../agent/session';
import type { UiApproval } from '../ui/protocol';
import type { RuntimeSession } from './runtime';
import { postFor } from './channel';

export function childApproval(host: MiniMaxController, runtime: RuntimeSession,
  signal: AbortSignal): ApprovalGate {
  return new ApprovalGate({
    autoApprove: [...getSettings().autoApprove],
    request: async (request) =>
      await requestChildApproval(host, runtime, request, signal),
    // The gate of the child is the gate of the session: a permission that
    // the reader gave to the parent works for the child too.
    sessionApproved: runtime.approvedTools
  });
}


export async function requestChildApproval(host: MiniMaxController, runtime: RuntimeSession,
  request: ApprovalRequest,
  signal: AbortSignal): Promise<ApprovalDecision> {
  const id = 'child-' + request.id;
  const approval: UiApproval = { id, name: request.toolName, input: request.input };
  // The reader sees the change before he answers. A path outside of the
  // workspace breaks the preview, the approval goes on without it.
  try {
    const preview = await buildPreview(
      request.toolName,
      request.input,
      host.workspaceRoot()
    );
    if (preview) {
      approval.preview = { path: preview.path, lines: preview.lines };
    }
  } catch {
    // The preview is optional, a failure of it must not break the
    // approval.
  }
  if (signal.aborted) {
    // The turn was stopped while the preview was built, nobody answers.
    return { approved: false, allowForSession: false };
  }
  return await new Promise<ApprovalDecision>((resolve) => {
    host.childApprovals.set(id, {
      toolName: request.toolName,
      sessionId: runtime.id,
      resolve
    });
    runtime.uiMessages.push({
      id: 'approval-' + id,
      role: 'assistant',
      approval
    });
    host.approvalOwner.set(id, runtime.id);
    postFor(host, runtime, { type: 'approval_request', approval });
  });
}


export function dropApprovalCard(host: MiniMaxController, approvalId: string, approved: boolean): boolean {
  const owner = host.approvalOwner.get(approvalId);
  if (owner === undefined) {
    return false;
  }
  host.approvalOwner.delete(approvalId);
  const runtime = host.sessions.get(owner);
  if (!runtime) {
    return true;
  }
  runtime.uiMessages = runtime.uiMessages.filter(
    (message) => message.approval?.id !== approvalId
  );
  postFor(host, runtime, { type: 'approval_resolved', id: approvalId, approved });
  return true;
}


export function dropApprovalCards(host: MiniMaxController, runtime: RuntimeSession, approved: boolean): void {
  const cards = runtime.uiMessages.filter((message) => message.approval);
  for (const card of cards) {
    dropApprovalCard(host, card.approval!.id, approved);
  }
}


export function releaseChildApprovals(host: MiniMaxController): void {
  for (const [id, pending] of host.childApprovals) {
    host.childApprovals.delete(id);
    // The card of the child leaves the chat with its answer, the same way
    // the cards of the parent do.
    dropApprovalCard(host, id, false);
    pending.resolve({ approved: false, allowForSession: false });
  }
}


export function agentsByPriority(host: MiniMaxController): AgentSession[] {
  const active = host.activeSession();
  const agents: AgentSession[] = [];
  if (active?.agent) {
    agents.push(active.agent);
  }
  for (const runtime of host.sessions.values()) {
    if (runtime !== active && runtime.agent) {
      agents.push(runtime.agent);
    }
  }
  return agents;
}

