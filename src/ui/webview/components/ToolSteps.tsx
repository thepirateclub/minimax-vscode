import { useState } from 'react';
import type { UiMessage } from '../../protocol';
import { Chevron, IconList } from '../icons';
import { STRINGS } from '../strings';
import { ToolCard } from './ToolCard';

// The actions of one step of the agent. The step is folded by default, the
// header of it stays visible: the reader sees that the agent worked and
// opens the cards when he needs them.
export function ToolSteps({
  step,
  collapsed
}: {
  step: { id: string; tools: UiMessage[] };
  // The cards of the step fold to their title.
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const failed = step.tools.some((item) => item.tool?.isError === true);
  return (
    <div className={'tool-steps' + (failed ? ' tool-steps-failed' : '')}>
      <button
        className="tool-steps-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={STRINGS.toolStepsOpen}
      >
        <Chevron open={open} />
        <span className="tool-steps-icon">
          <IconList />
        </span>
        <span className="tool-steps-title">{STRINGS.toolSteps}</span>
        <span className="tool-steps-count">{step.tools.length}</span>
      </button>
      {open ? (
        <div className="tool-steps-body">
          {step.tools.map((message) =>
            message.tool ? (
              <ToolCard
                key={message.id}
                tool={message.tool}
                collapsed={collapsed}
              />
            ) : null
          )}
        </div>
      ) : null}
    </div>
  );
}
