import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EDIT_TOOLS, REVIEW_TOOLS, WRITE_TOOLS, inputFingerprint, isProfileTool, isWriteTool } from '../../src/backends/app-server/approvals.js';
import { BUNDLED_SKILL_NAMES, BUNDLED_SKILL_PROVENANCE } from '../../src/backends/app-server/bundled-skills.js';
import { ProtocolParseError, parseConfigReadResult, parseHistoryEntry, parseNotification } from '../../src/backends/app-server/protocol.js';
import { DISABLED_TOOLS, PROFILE_TOOLS, TOOL_PERMISSION, buildSessionConfig, settingEnvironmentName } from '../../src/backends/app-server/session-config.js';
import { SELECTABLE_VIBE_VERSIONS, SUPPORTED_VIBE } from '../../src/backends/app-server/supported-vibe.js';
import { PINNED_WIRE, VIBE_WIRE, profileApprovalNames, wireFacts, wireFactsFor } from '../../src/backends/app-server/vibe-wire.js';

const repo = path.resolve(import.meta.dirname, '..', '..');
const TABLE = 'src/backends/app-server/vibe-wire.ts';
const PIN = 'src/backends/app-server/supported-vibe.ts';
const UNPINNED_VERSION = '0.0.0';

interface StrayLiteral { name: string; pattern: RegExp; allowedFiles: readonly string[] }

const STRAY_LITERALS: readonly StrayLiteral[] = [
  { name: 'an approval-wire tool name', pattern: /file_system\.[a-z_]+/, allowedFiles: [TABLE] },
  { name: 'a bundled skill name', pattern: /['"`]vibe:[a-z-]+['"`]/, allowedFiles: [TABLE] },
  { name: 'the managed-config route', pattern: /\/api\/v1\/code\/managed-config/, allowedFiles: [TABLE] },
  { name: 'the managed-config environment variable', pattern: /VIBE_VIBE_BASE_URL/, allowedFiles: [TABLE] },
  { name: 'the pinned version as a literal', pattern: new RegExp(`['"\`]${SUPPORTED_VIBE.replace(/\./g, '\\.')}['"\`]`), allowedFiles: [TABLE, PIN] }
];

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  }));
  return files.flat();
}

describe('the per-version wire-fact table', () => {
  it('has exactly the selectable versions, all accepted', () => {
    expect(Object.keys(VIBE_WIRE).sort()).toEqual([...SELECTABLE_VIBE_VERSIONS].sort());
    expect(Object.keys(VIBE_WIRE)).toEqual([SUPPORTED_VIBE]);
    expect(wireFacts()).toBe(VIBE_WIRE[SUPPORTED_VIBE]);
    expect(PINNED_WIRE).toBe(VIBE_WIRE[SUPPORTED_VIBE]);
    expect(wireFactsFor(UNPINNED_VERSION)).toBeUndefined();
    expect(() => wireFacts(UNPINNED_VERSION)).toThrow(/accepts only/);
  });

  it('names every profile tool once with distinct config and approval names', () => {
    const configNames = PINNED_WIRE.tools.map((tool) => tool.configName);
    const approvalNames = PINNED_WIRE.tools.map((tool) => tool.approvalName);
    expect(new Set(configNames).size).toBe(configNames.length);
    expect(new Set(approvalNames).size).toBe(approvalNames.length);
    for (const mode of ['review', 'edit'] as const) {
      for (const name of PINNED_WIRE.profiles[mode]) expect(configNames).toContain(name);
    }
    expect(PINNED_WIRE.profiles.review.every((name) => PINNED_WIRE.tools.find((tool) => tool.configName === name)?.access === 'read')).toBe(true);
  });

  it('leaves no stray wire literal in src outside the table', async () => {
    const files = await sourceFiles(path.join(repo, 'src'));
    const strays: string[] = [];
    for (const file of files) {
      const relative = path.relative(repo, file).split(path.sep).join('/');
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        for (const literal of STRAY_LITERALS) {
          if (literal.pattern.test(line) && !literal.allowedFiles.includes(relative)) strays.push(`${relative}:${index + 1} carries ${literal.name}: ${line.trim()}`);
        }
      });
    }
    expect(strays).toEqual([]);
  });
});

describe('modules read the pinned facts from the table', () => {
  it('derives the approval tool sets from the table', () => {
    expect(REVIEW_TOOLS).toEqual(profileApprovalNames('review'));
    expect(EDIT_TOOLS).toEqual(profileApprovalNames('edit'));
    expect(WRITE_TOOLS).toEqual(PINNED_WIRE.tools.filter((tool) => tool.access === 'edit').map((tool) => tool.approvalName));
    for (const tool of PINNED_WIRE.tools) {
      expect(isProfileTool('edit', tool.approvalName)).toBe(PINNED_WIRE.profiles.edit.includes(tool.configName));
      expect(isProfileTool('review', tool.approvalName)).toBe(PINNED_WIRE.profiles.review.includes(tool.configName));
      expect(isWriteTool(tool.approvalName)).toBe(tool.access === 'edit');
    }
  });

  it('fingerprints each table tool by its declared material', () => {
    const input = { filePath: '/w/a.ts', content: 'x', changes: [{ oldString: 'a', newString: 'b' }], extra: 'ignored' };
    for (const tool of PINNED_WIRE.tools) {
      const narrowed = { ...input, extra: 'changed' };
      expect(inputFingerprint(tool.approvalName, input)).toBe(inputFingerprint(tool.approvalName, narrowed));
    }
    expect(inputFingerprint('file_system.other', input)).not.toBe(inputFingerprint('file_system.other', { ...input, extra: 'changed' }));
  });

  it('derives the session configuration from the table', () => {
    expect(PROFILE_TOOLS).toBe(PINNED_WIRE.profiles);
    expect(DISABLED_TOOLS).toBe(PINNED_WIRE.disabledTools);
    expect(TOOL_PERMISSION).toBe(PINNED_WIRE.toolPermission);
    const plan = buildSessionConfig({ mode: 'edit', workspace: '/workspace', runDirectory: '/run', maxTurns: 3 });
    expect(plan.expectation.harness).toBe(PINNED_WIRE.harness);
    for (const setting of PINNED_WIRE.runtimeSettings) {
      expect(plan.environment).toHaveProperty(settingEnvironmentName(setting.key));
      expect(plan.expectation.settings).toContainEqual({ path: setting.key.split('.'), value: setting.value, match: setting.match ?? 'equal' });
    }
    expect(plan.environment[settingEnvironmentName(PINNED_WIRE.agentSettingKeys.defaultAgent)]).toBe(plan.agent);
  });

  it('derives the bundled skill expectation from the table', () => {
    expect(BUNDLED_SKILL_NAMES).toBe(PINNED_WIRE.bundledSkills.names);
    expect(BUNDLED_SKILL_PROVENANCE).toBe(PINNED_WIRE.bundledSkills.provenance);
  });

  it('treats the config/read harness field as the table says for the pin and requires it otherwise', () => {
    expect(parseConfigReadResult({ hooksCount: 0, skillsCount: 0 }).harnessSelectionSource).toBeNull();
    expect(parseConfigReadResult({ hooksCount: 0, skillsCount: 0 }, { vibeVersion: SUPPORTED_VIBE }).harnessSelectionSource).toBeNull();
    expect(() => parseConfigReadResult({ hooksCount: 0, skillsCount: 0 }, { vibeVersion: UNPINNED_VERSION })).toThrow(ProtocolParseError);
  });

  it('recognizes exactly the history entry kinds the table lists', () => {
    for (const type of PINNED_WIRE.historyEntryKinds) {
      try {
        expect(parseHistoryEntry({ type, id: 'e1' }).kind).not.toBe('unknown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProtocolParseError);
      }
    }
    expect(parseHistoryEntry({ type: 'artifact', id: 'e2' }).kind).toBe('unknown');
  });

  it('recognizes exactly the notification methods the table lists', () => {
    for (const method of PINNED_WIRE.notificationMethods) {
      try {
        expect(parseNotification(method, { eventId: 1, sessionId: 's1' }).kind).not.toBe('unknown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProtocolParseError);
      }
    }
    expect(parseNotification('artifacts/created', { eventId: 1, sessionId: 's1' }).kind).toBe('unknown');
  });
});
