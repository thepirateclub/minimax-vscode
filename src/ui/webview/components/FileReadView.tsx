import { useMemo } from 'react';
import { languageOf } from '../codeBlock';
import { parseReadOutput } from '../fileRead';
import { highlight } from '../highlight';
import { CopyButton } from './CopyButton';

// The read of a file is shown as the file: the numbers stand in a gutter and
// the text keeps the colors of the language of the file.
export function FileReadView({ content, path }: { content: string; path: string }) {
  // The answer grows while the agent works, the colors of a long file are not
  // counted again on every message.
  const blocks = useMemo(() => {
    return parseReadOutput(content, path).map((block) => {
      const language = languageOf(block.path);
      return {
        path: block.path,
        lines: block.lines.map((line) => ({
          number: line.number,
          html: highlight(line.text, language)
        }))
      };
    });
  }, [content, path]);

  return (
    <div className="file-read">
      <CopyButton text={content} />
      {blocks.map((block, index) => (
        <div className="file-read-block" key={index}>
          {blocks.length > 1 ? <div className="file-read-path">{block.path}</div> : null}
          <div className="file-read-lines">
            {block.lines.map((line, lineIndex) => (
              <div className="file-read-line" key={lineIndex}>
                <span className="file-read-num">{line.number > 0 ? line.number : ''}</span>
                <span
                  className="file-read-text"
                  dangerouslySetInnerHTML={{ __html: line.html }}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
