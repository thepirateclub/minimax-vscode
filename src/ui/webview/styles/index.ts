// The style sheet is split into parts by the file size rule. The parts are
// joined in the order of the cascade: the panel gets the same text as the
// one sheet used to be, so no rule changes its place.
import part01 from './01-part.css';
import part02 from './02-part.css';
import part03 from './03-part.css';
import part04 from './04-part.css';
import part05 from './05-part.css';
import part06 from './06-part.css';
import part07 from './07-part.css';
import part08 from './08-part.css';

export const styles = [
  part01,
  part02,
  part03,
  part04,
  part05,
  part06,
  part07,
  part08
].join('\n');
