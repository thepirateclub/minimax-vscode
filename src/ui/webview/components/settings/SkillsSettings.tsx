import type { UiSkill } from '../../../extrasProtocol';
import { STRINGS } from '../../strings';
import { IconRefresh } from '../../icons';

const SOURCES: Array<[UiSkill['source'], string]> = [
  ['project', STRINGS.skillsProject],
  ['user', STRINGS.skillsUser],
  ['plugin', STRINGS.skillsPlugin]
];

// The tab Skills: the skills the agent sees, grouped by where they live. A
// click opens the SKILL.md of the skill; `/name` in the field calls it.
export function SkillsSettings({
  skills,
  onOpen,
  onRefresh
}: {
  skills: UiSkill[];
  onOpen: (name: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="settings-extras">
      <div className="extras-head">
        <p className="settings-hint">{STRINGS.skillsHint}</p>
        <button className="secondary" onClick={onRefresh} title={STRINGS.refresh}>
          <IconRefresh /> {STRINGS.refresh}
        </button>
      </div>
      {skills.length === 0 ? <p className="extras-empty">{STRINGS.skillsEmpty}</p> : null}
      {SOURCES.map(([source, title]) => {
        const group = skills.filter((skill) => skill.source === source);
        return group.length === 0 ? null : (
          <section key={source} className="extras-group">
            <h3 className="extras-title">{title}</h3>
            <ul className="extras-list">
              {group.map((skill) => (
                <li key={skill.name}>
                  <button className="extras-item" onClick={() => onOpen(skill.name)} title={skill.file}>
                    <span className="extras-name">/{skill.name}</span>
                    <span className="extras-detail">{skill.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
