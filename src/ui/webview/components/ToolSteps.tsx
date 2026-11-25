import { useState } from 'react';
import type { UiMessage } from '../../protocol';
import { Chevron, IconList } from '../icons';
import { STRINGS } from '../strings';
import { actionPreview } from './toolDescriptions';
import { SectionPreview } from './SectionPreview';
import { ToolCard } from './ToolCard';
import { formatSpan, stepSpan, timelineState } from '../timeline';
import { fullStamp } from '../../format';
import { CARDS_PAGE, formatStepSummary, SUMMARY_FROM, summarizeStep } from '../stepSummary';

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
  // When the work of the group started and ended, the head names it.
  const span = stepSpan(step.tools);
  // A long group reads by what it did, and draws its last cards only: a turn
  // of a thousand actions froze the panel and told nothing.
  const [shown, setShown] = useState(CARDS_PAGE);
  const long = step.tools.length >= SUMMARY_FROM;
  const visible = step.tools.slice(-shown);
  const hidden = step.tools.length - visible.length;
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
        <span className="tool-steps-tail">
          {span ? (
            <span
              className="tool-steps-span"
              title={fullStamp(span.start) + (span.end !== undefined ? ' – ' + fullStamp(span.end) : '')}
            >
              {formatSpan(span)}
            </span>
          ) : null}
          <span className="tool-steps-count">{step.tools.length}</span>
        </span>
      </div>
      {open ? (
        <div className="tool-steps-body">
          {long ? <div className="tool-steps-summary">{formatStepSummary(summarizeStep(step.tools))}</div> : null}
          {hidden > 0 ? (
            <button className="secondary tool-steps-more" onClick={() => setShown(shown + CARDS_PAGE * 4)}>
              {STRINGS.showEarlierActions.replace('{count}', String(hidden))}
            </button>
          ) : null}
          {visible.map((message) =>
            message.tool ? (
              // A point of the timeline: the node on the guide line carries
              // the state of the action, the card its words and its moment.
              <div key={message.id} className={'timeline-item timeline-' + timelineState(message)}>
                <span className="timeline-node" aria-hidden="true" />
                <ToolCard
                  tool={message.tool}
                  collapsed={collapsed}
                  {...(message.at !== undefined ? { at: message.at } : {})}
                />
              </div>
            ) : null
          )}
        </div>
      ) : null}
    </div>
  );
}
