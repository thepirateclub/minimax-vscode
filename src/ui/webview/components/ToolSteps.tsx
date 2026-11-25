import { useState } from 'react';
import type { UiMessage } from '../../protocol';
import { Chevron, IconList } from '../icons';
import { STRINGS } from '../strings';
import { actionPreview } from './toolDescriptions';
import { SectionPreview } from './SectionPreview';
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
  // The last action of the group: the folded step says what it did last.
  const last = step.tools[step.tools.length - 1]?.tool;
  return (
    <div className={'tool-steps' + (failed ? ' tool-steps-failed' : '')}>
      <div className="section-head tool-steps-head">
        <button
          className="section-toggle tool-steps-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          title={STRINGS.toolStepsOpen}
        >
          <Chevron open={open} />
          <span className="section-icon tool-steps-icon">
            <IconList />
          </span>
          <span className="section-title tool-steps-title">{STRINGS.toolSteps}</span>
        </button>
        {open ? null : last ? (
          // The folded group shows its last action in the free middle of the
          // head: the reader sees what the agent did last without opening
          // the cards.
          <SectionPreview
            text={actionPreview(last)}
            onOpen={() => setOpen(true)}
          />
        ) : null}
        <span className="tool-steps-count">{step.tools.length}</span>
      </div>
      {open ? (
        <div className="tool-steps-body">
          {step.tools.map((message) =>
            message.tool ? (
              <ToolCard
                key={message.id}
                tool={message.tool}
                collapsed={collapsed}
                {...(message.at !== undefined ? { at: message.at } : {})}
              />
            ) : null
          )}
        </div>
      ) : null}
    </div>
  );
}
