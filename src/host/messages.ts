import { handleExtrasMessage } from './extras';
import type { MiniMaxController } from '../extension';
import type { WebToExt } from '../ui/protocol';
import { sendQueued, sendAllQueued, removeQueued } from './queue';
import { dropApprovalCard, dropApprovalCards, agentsByPriority } from './approvals';
import { alwaysConfirms } from '../ui/approvalScope';
import { persist, loadOlder, selectSession, deleteSession, startNewSession } from './sessions';
import { handleSend, retryTurn, rewindTo } from './turn';
import { postSummary, openFile, sendSuggestions } from './workspace';
import { updateSetting, pickFiles, postSettings, saveSettings, storeApiKey, clearApiKey } from './settings';
import { undoLastChange } from './commands';

export async function handleWebviewMessage(host: MiniMaxController, message: WebToExt): Promise<void> {
  if (
    message.type === 'request_extras' ||
    message.type === 'open_skill' ||
    message.type === 'mcp_restart' ||
    message.type === 'mcp_open_settings' ||
    message.type === 'mcp_add' ||
    message.type === 'mcp_remove'
  ) {
    await handleExtrasMessage(host, message);
    return;
  }
  if (message.type === 'ready') {
    // The panel has just loaded, it holds nothing of the chat yet.
    await host.sendInit(true);
    return;
  }
  if (message.type === 'load_older') {
    loadOlder(host);
    return;
  }
  if (message.type === 'send') {
    await handleSend(host, message.text, message.mentions, message.selections);
    return;
  }
  if (message.type === 'send_queued') {
    sendQueued(host, message.id);
    return;
  }
  if (message.type === 'send_all_queued') {
    sendAllQueued(host);
    return;
  }
  if (message.type === 'remove_queued') {
    removeQueued(host, message.id);
    return;
  }
  if (message.type === 'open_file') {
    await openFile(host, message.path, message.line);
    return;
  }
  if (message.type === 'stop') {
    const runtime = host.activeSession();
    runtime?.agent?.stop();
    // The stop rejects every approval that waits, the cards of them leave
    // the chat with the answer.
    if (runtime) {
      dropApprovalCards(host, runtime, false);
    }
    return;
  }
  if (message.type === 'retry') {
    await retryTurn(host, message.id);
    return;
  }
  if (message.type === 'rewind') {
    await rewindTo(host, message.id);
    return;
  }
  if (message.type === 'approve') {
    const handled = agentsByPriority(host).some(
      (agent) => agent.approve(message.id, message.allowForSession)
    );
    if (!handled) {
      const pending = host.childApprovals.get(message.id);
      if (pending) {
        host.childApprovals.delete(message.id);
        if (message.allowForSession && !alwaysConfirms(pending.toolName)) {
          // The permission belongs to the chat of the child. The chat that
          // is active now has nothing to do with it, the reader answered
          // from another chat. A tool that always asks keeps no grant.
          host.sessions
            .get(pending.sessionId)
            ?.approvedTools.add(pending.toolName);
        }
        pending.resolve({ approved: true, allowForSession: message.allowForSession });
      }
    }
    if (!dropApprovalCard(host, message.id, true)) {
      // The card has no owner, the panel of the open chat still has to
      // let it go.
      host.panel.post({ type: 'approval_resolved', id: message.id, approved: true });
    }
    return;
  }
  if (message.type === 'reject') {
    const handled = agentsByPriority(host).some((agent) => agent.reject(message.id));
    if (!handled) {
      const pending = host.childApprovals.get(message.id);
      if (pending) {
        host.childApprovals.delete(message.id);
        pending.resolve({ approved: false, allowForSession: false });
      }
    }
    if (!dropApprovalCard(host, message.id, false)) {
      host.panel.post({ type: 'approval_resolved', id: message.id, approved: false });
    }
    return;
  }
  if (message.type === 'new_session') {
    startNewSession(host);
    return;
  }
  if (message.type === 'select_session') {
    selectSession(host, message.id);
    return;
  }
  if (message.type === 'delete_session') {
    deleteSession(host, message.id);
    return;
  }
  if (message.type === 'set_goal') {
    const runtime = host.activeSession();
    const objective = message.objective.trim();
    if (!runtime) {
      return;
    }
    if (objective.length === 0) {
      host.panel.post({
        type: 'notice',
        message: 'The goal is empty.',
        kind: 'error'
      });
      return;
    }
    // The limits are numbers the user typed. A limit that is not a
    // positive number would stop the agent before it starts, and a limit
    // that is not a number would take the limit away.
    const limits = [
      message.tokenBudget,
      message.requestLimit,
      message.secondsLimit
    ];
    if (
      limits.some(
        (limit) => limit !== undefined && (!Number.isFinite(limit) || limit <= 0)
      )
    ) {
      host.panel.post({
        type: 'notice',
        message: 'The limits of the goal must be positive numbers.',
        kind: 'error'
      });
      return;
    }
    // The same goal with new limits keeps the spend: the user raises the
    // limit of the goal that is already running and the work continues from
    // where it stopped. A new objective is a new goal and starts from zero.
    const previous = runtime.goal;
    const used =
      previous && previous.objective === objective
        ? { ...previous.used }
        : { tokens: 0, requests: 0, seconds: 0 };
    runtime.goal = {
      objective,
      tokenBudget: message.tokenBudget,
      requestLimit: message.requestLimit,
      secondsLimit: message.secondsLimit,
      status: 'active',
      used
    };
    host.panel.post({ type: 'goal', goal: runtime.goal });
    persist(host, runtime);
    return;
  }
  if (message.type === 'clear_todos') {
    const runtime = host.activeSession();
    if (!runtime) {
      return;
    }
    // The list lives in the host, the next turn shows the model an empty
    // section of the tasks and the reload does not bring them back.
    runtime.todos = [];
    host.panel.post({ type: 'todos', todos: [] });
    persist(host, runtime);
    // The tasks are cancelled, the reader sees what the work changed.
    void postSummary(host, runtime);
    return;
  }
  if (message.type === 'clear_goal') {
    const runtime = host.activeSession();
    if (!runtime) {
      return;
    }
    runtime.goal = undefined;
    host.panel.post({ type: 'goal', goal: undefined });
    persist(host, runtime);
    return;
  }
  if (message.type === 'set_model') {
    await updateSetting(host, 'model', message.model);
    return;
  }
  if (message.type === 'set_effort') {
    await updateSetting(host, 'effort', message.effort);
    return;
  }
  if (message.type === 'set_mode') {
    await updateSetting(host, 'mode', message.mode);
    return;
  }
  if (message.type === 'set_thinking') {
    await updateSetting(host, 'thinking', message.thinking);
    return;
  }
  if (message.type === 'pick_files') {
    await pickFiles(host, message.requestId);
    return;
  }
  if (message.type === 'undo_last_change') {
    await undoLastChange(host);
    return;
  }
  if (message.type === 'files_picked') {
    return;
  }
  if (message.type === 'request_suggestions') {
    await sendSuggestions(host, message.requestId, message.prefix);
    return;
  }
  if (message.type === 'request_settings') {
    await postSettings(host);
    return;
  }
  if (message.type === 'save_settings') {
    await saveSettings(host, message.values);
    return;
  }
  if (message.type === 'set_api_key') {
    await storeApiKey(host, message.key);
    return;
  }
  if (message.type === 'clear_api_key') {
    await clearApiKey(host);
    return;
  }
  if (message.type === 'voice_start') {
    await host.voice.start();
    return;
  }
  if (message.type === 'voice_stop') {
    await host.voice.stop();
    return;
  }
  if (message.type === 'voice_cancel') {
    host.voice.cancel();
    return;
  }
}

