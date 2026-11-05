import { readFile } from 'node:fs/promises';
import { usage } from './errors';
// Source execution and standalone builds share this exact allowlist. User input
// is never interpolated into a filesystem path.
export const skillCatalog = [
  {
    name: 'work-platform',
    description: 'Entry point: discover commands and select a Work skill',
    path: '../../../skills/work-platform/SKILL.md',
  },
  {
    name: 'work-shared',
    description: 'Human authorization, command discovery, output and safety',
    path: '../../../skills/work-shared/SKILL.md',
  },
  {
    name: 'work-tasks',
    description: 'Query and safely mutate tasks with versions and idempotency',
    path: '../../../skills/work-tasks/SKILL.md',
  },
  {
    name: 'work-workflow-triage',
    description: 'Read-only task triage and work summaries',
    path: '../../../skills/work-workflow-triage/SKILL.md',
  },
] as const;
declare const __WORK_SKILLS__: Record<string, string> | undefined;
export function listSkills() {
  return skillCatalog.map(({ name, description }) => ({ name, description }));
}
export async function readSkill(name: string) {
  const skill = skillCatalog.find((item) => item.name === name);
  if (!skill) return usage(`Unknown skill: ${name}. Run work skills list`);
  if (typeof __WORK_SKILLS__ !== 'undefined') {
    const markdown = __WORK_SKILLS__[skill.name];
    if (typeof markdown !== 'string') throw new Error('Missing bundled skill');
    return markdown;
  }
  return readFile(new URL(skill.path, import.meta.url), 'utf8');
}
