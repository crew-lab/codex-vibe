import { mkdtemp, mkdir, realpath, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { describe, it, expect, afterEach } from 'vitest';
import { createAppServerProfile, DISABLED_FEATURES } from '../../src/backends/app-server/session-config.js';
import { validateEffectiveConfig, validateRuntime, validateSessionSnapshot } from '../../src/backends/app-server/readback.js';
import type { StartRunInput } from '../../src/contracts.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function fixture(mode: 'review' | 'edit' = 'review') {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'vsup-unified-profile-'))); directories.push(dir);
  const root = path.join(dir, 'workspace'); const run = path.join(dir, 'run');
  await Promise.all([mkdir(root), mkdir(run)]);
  const input: StartRunInput = { runId: '00000000-0000-4000-8000-000000000001', mode, task: 'fixture', cwd: root, workerWorkspace: root, runDirectory: run, limits: { maxTurns: 12, timeoutSeconds: 180, maxEventBytes: 4096, maxTranscriptBytes: 4096, maxArtifactBytes: 4096 } };
  const profile = await createAppServerProfile(input, Date.now() + 180_000);
  const runtime = { ready: true, sessionLog: { enabled: false, persisted: false }, runtime: {
    activeAgent: { name: profile.agent },
    tools: profile.tools.map(name => ({ name })), skills: [], issues: [], hooksCount: 0,
    bypassToolPermissions: false, connectors: { connected: 0 },
    config: { activeModel: { alias: 'mistral-medium-3.5', thinking: 'high' } },
    mcp: { sources: [{ name: 'supervisor_search', kind: 'server', transport: 'stdio', status: 'connected', error: null, pluginName: null, tools: [{ name: 'grep', enabled: true }, { name: 'list_files', enabled: true }] }], discoveryErrors: {}, connectorError: null },
  } };
  const agent = parse(await readFile(path.join(profile.vibeHome, 'agents', profile.agent + '.toml'), 'utf8'));
  const effective = { config: {
    ...Object.fromEntries(DISABLED_FEATURES.map(name => [name, false])),
    default_agent: profile.agent, max_turns: 12, enabled_tools: profile.tools,
    disabled_tools: profile.agentConfig.disabledTools,
    enabled_skills: [], disabled_skills: ['*'], session_logging: { enabled: false },
    tools: agent.tools, mcp_servers: [profile.mcpServer],
  } };
  const snapshot = { format: 'vibe.public-session-state/v1', eventId: 0, session: { id: 'session', harness: 'unified', cwd: root, workspaceRoots: [] }, activeCallbacks: [], backgroundProcesses: [], childSessions: [] };
  return { input, profile, agent, runtime, effective, snapshot };
}

describe('unified startup configuration and read-back', () => {
  it.each(['review', 'edit'] as const)('accepts the expected %s runtime only', async mode => {
    const f = await fixture(mode);
    expect(validateSessionSnapshot(f.snapshot, f.input)).toBe('session');
    validateRuntime(f.runtime, f.profile, true); validateEffectiveConfig(f.effective, f.profile);
    expect(f.profile.env.VIBE_SESSION_LOGGING__ENABLED).toBe('false');
    expect(f.profile.env.VIBE_DISABLED_SKILLS).toBe('["*"]');
    expect(f.profile.env.TMPDIR).toBe(path.join(f.input.runDirectory, 'tmp'));
    expect(f.profile.tools).toContain('supervisor_search_grep');
    expect(f.profile.tools.includes('write_file')).toBe(mode === 'edit');
    expect(JSON.stringify(f.profile.mcpServer)).not.toContain('MISTRAL_API_KEY');
  });
  it('requires invocation approval without native automatic path grants', async () => {
    const f = await fixture('edit');
    const definitions = f.agent.tools as Record<string, { permission: string; allowlist: unknown[] }>;
    for (const tool of ['read_file', 'write_file', 'edit']) {
      expect(definitions[tool]?.permission).toBe('ask'); expect(definitions[tool]?.allowlist).toEqual([]);
    }
    const unsafe = structuredClone(f.effective);
    (unsafe.config.tools as Record<string, { allowlist: unknown[] }>).read_file!.allowlist = [f.input.workerWorkspace];
    expect(() => validateEffectiveConfig(unsafe, f.profile)).toThrow();
  });
  it.each([...DISABLED_FEATURES])('refuses an enabled %s', async key => {
    const f = await fixture(); (f.effective.config as Record<string, unknown>)[key] = true;
    expect(() => validateEffectiveConfig(f.effective, f.profile)).toThrow();
  });
  it('refuses missing fields, a foreign tool and disabled accounting prerequisites', async () => {
    const f = await fixture();
    const missing = structuredClone(f.runtime); delete (missing.runtime as Record<string, unknown>).skills;
    expect(() => validateRuntime(missing, f.profile, true)).toThrow();
    f.runtime.runtime.tools.push({ name: 'bash' });
    expect(() => validateRuntime(f.runtime, f.profile, true)).toThrow();
    f.snapshot.session.harness = 'legacy';
    expect(() => validateSessionSnapshot(f.snapshot, f.input)).toThrow();
  });
  it('refuses reasoning downgrade and a foreign search executable', async () => {
    const f = await fixture(); f.runtime.runtime.config.activeModel.thinking = 'off';
    expect(() => validateRuntime(f.runtime, f.profile, true)).toThrow();
    const unsafe = structuredClone(f.effective);
    unsafe.config.mcp_servers[0]!.command = '/usr/bin/other';
    expect(() => validateEffectiveConfig(unsafe, f.profile)).toThrow();
  });
  it('accepts reordered environment keys and unknown metadata without weakening checks', async () => {
    const f = await fixture();
    const server = f.effective.config.mcp_servers[0]!;
    server.env = Object.fromEntries(Object.entries(server.env as Record<string, unknown>).reverse());
    validateEffectiveConfig(f.effective, f.profile);
    (f.runtime.runtime as Record<string, unknown>).futureMetadata = { value: 'ignored' };
    validateRuntime(f.runtime, f.profile, true);
  });
});
