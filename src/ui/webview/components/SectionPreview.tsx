import { STRINGS } from '../strings';

// The preview of a folded section: one italic line that says what the
// section holds. A click on the line opens the section, the head of the
// section opens it too.
export function SectionPreview({
  text,
  onOpen
}: {
  text: string;
  onOpen: () => void;
}) {
  if (text.length === 0) {
    return null;
  }
  return (
    <button className="section-preview" onClick={onOpen} title={STRINGS.previewOpen}>
      <span className="section-preview-text">{text}</span>
    </button>
  );
}
