import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = path.resolve(import.meta.dirname, '..', '..');
const skillDirectory = path.join(repo, '.agents', 'skills', 'vibe-supervisor');
const skill = readFileSync(path.join(skillDirectory, 'SKILL.md'), 'utf8');
const agentFile = readFileSync(path.join(repo, '.codex', 'agents', 'vibe-reviewer.toml'), 'utf8');
const developerInstructions = /developer_instructions = """([\s\S]*?)"""/.exec(agentFile)?.[1] ?? '';

const SKILL_CHARACTER_CAP = 30_600;
const AGENT_INSTRUCTIONS_CHARACTER_CAP = 1_500;
const REPOSITORY_URL = 'https://github.com/crew-lab/codex-vibe/blob/main/';

const HARD_PROHIBITIONS: [string, RegExp][] = [
  ['never apply, commit, merge or push the output', /never apply, commit, merge or push the worker's output/],
  ['the correction base is the only exception', /unreferenced commit a correction starts from is the one exception/],
  ['no credentials in task text', /never put credentials in task text/],
  ['no raised limits', /never raise limits/],
  ['no replay', /never replay/],
  ['no substitute implementer', /never substitute another implementer/],
  ['the skill is loaded', /vibe-supervisor skill/]
];

function linksOf(text: string): string[] {
  const withoutFences = text.replace(/```[\s\S]*?```/g, '');
  return [...withoutFences.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? '');
}

function leavesSkillFolder(link: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('#')) return false;
  const target = path.resolve(skillDirectory, link.split('#')[0] ?? '');
  return !target.startsWith(skillDirectory + path.sep);
}

describe('coordinator agent setup', () => {
  it('keeps the skill and the agent instructions under their caps', () => {
    expect(skill.length, 'SKILL.md grew; remove restatement before raising the cap').toBeLessThanOrEqual(SKILL_CHARACTER_CAP);
    expect(developerInstructions.length, 'the agent file grew; rules belong in the skill').toBeLessThanOrEqual(AGENT_INSTRUCTIONS_CHARACTER_CAP);
    expect(developerInstructions.length).toBeGreaterThan(0);
  });

  it('links from the skill resolve when the skill folder is copied elsewhere', () => {
    expect(linksOf(skill).filter(leavesSkillFolder), `link to repository documents as ${REPOSITORY_URL}<path>`).toEqual([]);
  });

  it('flags only links that leave the skill folder', () => {
    expect(['../../../docs/x.md', '#a', `${REPOSITORY_URL}docs/x.md`, 'notes.md'].filter(leavesSkillFolder)).toEqual(['../../../docs/x.md']);
  });

  it('links to this repository name files that exist', () => {
    const missing = linksOf(skill)
      .filter((link) => link.startsWith(REPOSITORY_URL))
      .map((link) => link.slice(REPOSITORY_URL.length).split('#')[0] ?? '')
      .filter((file) => !existsSync(path.join(repo, file)));
    expect(missing).toEqual([]);
  });

  it('puts the hard prohibitions in front of the agent before the skill loads', () => {
    const missing = HARD_PROHIBITIONS.filter(([, rule]) => !rule.test(developerInstructions)).map(([name]) => name);
    expect(missing).toEqual([]);
  });
});
