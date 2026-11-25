// The style sheet is split into the components of the panel, in the order
// of the cascade. The parts are joined back into one text and the panel
// inlines it into one <style>: the number of files costs nothing at run
// time, and the sheet stays readable.
import part01 from './01-tokens.css';
import part02 from './02-header.css';
import part03 from './03-tasks.css';
import part04 from './04-goal.css';
import part05 from './05-messages.css';
import part06 from './06-tool-card.css';
import part07 from './07-diff-terminal.css';
import part08 from './08-queue.css';
import part09 from './09-composer.css';
import part10 from './10-controls.css';
import part11 from './11-suggestions-settings.css';
import part12 from './12-sessions.css';
import part13 from './13-markdown.css';
import part14 from './14-steps-summary.css';
import part15 from './15-extras.css';

export const styles = [
  part01,
  part02,
  part03,
  part04,
  part05,
  part06,
  part07,
  part08,
  part09,
  part10,
  part11,
  part12,
  part13,
  part14,
  part15
].join('\n');
