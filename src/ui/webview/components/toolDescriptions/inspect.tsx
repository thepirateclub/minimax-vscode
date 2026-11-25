import { STRINGS } from '../../strings';
import { IconRead, IconSearch } from '../../icons';
import { textOrEmpty } from '../../value';
import { text } from '../toolCardHelpers';
import type { Describer } from './table';

// The tools that look at the project without changing it: grep, the diffs,
// the check of the paths and the images. They live apart from the table so
// the table stays under the limit of the size of a file.
export const INSPECT_DESCRIBERS: Record<string, Describer> = {
  grep: ({ input }) => ({
    icon: <IconSearch />,
    title: STRINGS.toolGrep + ' /' + text(input['pattern']) + '/' + (textOrEmpty(input['path']) ? ' ' + textOrEmpty(input['path']) : '') +
      (textOrEmpty(input['glob']) ? ' ' + textOrEmpty(input['glob']) : ''),
    summary: ''
  }),
  read_image: ({ input }) => {
    const crop = input['crop'] as Record<string, unknown> | undefined;
    return {
      icon: <IconRead />,
      title:
        STRINGS.toolReadImage + ' ' + text(input['path']) +
        (crop ? ' ' + [crop['x'], crop['y'], crop['width'], crop['height']].map(String).join(',') : ''),
      summary: ''
    };
  },
  path_exists: ({ input }) => ({
    icon: <IconSearch />,
    title: STRINGS.toolPathExists + ' ' + (Array.isArray(input['paths']) ? input['paths'].map(String).join(', ') : text(input['paths'])),
    summary: ''
  }),
  diff_files: ({ input }) => ({
    icon: <IconRead />,
    title: STRINGS.toolDiffFiles + ' ' + text(input['path_a']) + ' ↔ ' + text(input['path_b']),
    summary: ''
  }),
  compare: ({ input }) => ({
    icon: <IconRead />,
    title: STRINGS.toolCompare + ' ' + (textOrEmpty(input['path_a']) || 'text') + ' ↔ ' + (textOrEmpty(input['path_b']) || 'text'),
    summary: ''
  }),
};
