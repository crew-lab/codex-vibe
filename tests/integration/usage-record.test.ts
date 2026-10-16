import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppServerBackend } from '../../src/backends/app-server.js';
import { ResolvedCredential, type CredentialResolution } from '../../src/backends/app-server/credentials.js';
import { PROFILE_TOOLS, TOOL_PERMISSION, workspaceDenylist } from '../../src/backends/app-server/session-config.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { SupervisorConfig } from '../../src/contracts.js';
import { RunManager } from '../../src/core/run-manager.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const fixture = path.join(repoRoot, 'tests', 'fixtures', 'fake-vibe-app-server.mjs');
const scenarioFile = path.join(repoRoot, 'tests', 'fixtures', 'app-server-scenarios', 'usage-tool-counts.json');
const TIMING = { interruptGraceMs: 300, stdinGraceMs: 300, terminateGraceMs: 300, interruptTimeoutMs: 500, statsThrottleMs: 0 };

const scratchDirectories: string[] = [];
const managers: RunManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown().catch(() => undefined)));
  for (const directory of scratchDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

interface RecordedUsage {
  tool_calls: unknown;
  cost: unknown;
}

interface Recorded {
  meta: { usage: RecordedUsage; limits: Record<string, unknown> };
  result: { usage: RecordedUsage };
  events: Array<{ type: string }>;
}

async function reviewWithScenario(limits: Partial<SupervisorConfig['limits']> = {}): Promise<Recorded> {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'vsup-usage-record-')));
  scratchDirectories.push(base);
  const source = path.join(base, 'workspace');
  mkdirSync(path.join(source, 'src'), { recursive: true });
  writeFileSync(path.join(source, 'src', 'index.ts'), 'export const a = 1;\n');
  const data = path.join(base, 'data');
  const document = JSON.parse(readFileSync(scenarioFile, 'utf8')) as Record<string, unknown>;
  const tools = Object.fromEntries(PROFILE_TOOLS.review.map((tool) => [tool, { permission: TOOL_PERMISSION, denylist: workspaceDenylist(source) }]));
  const scenarioCopy = path.join(base, 'scenario.json');
  writeFileSync(scenarioCopy, JSON.stringify({ ...document, effectiveConfig: { tools } }));
  const wrapper = path.join(base, 'vibe-app-server');
  writeFileSync(wrapper, `#!/bin/sh\nexec '${process.execPath}' '${fixture}' --scenario '${scenarioCopy}'\n`);
  chmodSync(wrapper, 0o755);
  const config: SupervisorConfig = {
    ...DEFAULT_CONFIG,
    paths: { vibePinManifest: '/unused/vibe-pin-manifest.json' },
    allowedWorkspaceRoots: [source],
    limits: { ...DEFAULT_CONFIG.limits, ...limits }
  };
  const backend = new AppServerBackend(config, {
    executable: wrapper,
    preparation: { check: async () => ({ status: 'passed' as const, candidate_sha256: null, version: 'fixture', reason: 'Fake ACP fixture evidence only' }) },
    pin: { verify: async () => undefined },
    resolveCredential: async (): Promise<CredentialResolution> => ({ status: 'environment', detail: '', credential: new ResolvedCredential('usage-record-credential-abcdefghijkl') }),
    reaper: { pollMs: 50, graceMs: 200 },
    timing: TIMING
  });
  const manager = new RunManager(config, data, [backend]);
  managers.push(manager);
  const finished = await manager.reviewStart({ task: 'Review.', cwd: source, wait_seconds: 30 });
  expect(finished.state).toBe('completed');
  const directory = path.join(data, 'runs', finished.run_id);
  return {
    meta: JSON.parse(readFileSync(path.join(directory, 'meta.json'), 'utf8')) as Recorded['meta'],
    result: JSON.parse(readFileSync(path.join(directory, 'result.json'), 'utf8')) as Recorded['result'],
    events: readFileSync(path.join(directory, 'events.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { type: string })
  };
}

describe('usage in the persisted run record', () => {
  it('saves tool-call counts and token totals equal to the statistics delta in meta.json and result.json', async () => {
    const recorded = await reviewWithScenario();
    const counts = { executed: 3, denied_by_handler: 1, denied_by_policy: 1 };
    for (const usage of [recorded.meta.usage, recorded.result.usage]) {
      expect(usage.tool_calls).toEqual(counts);
      expect(usage).toMatchObject({ prompt_tokens: 6000, completion_tokens: 1000, cached_tokens: 1000, model_calls: 5, tokens_used: 7000 });
      expect(usage.cost).toMatchObject({ currency: 'USD', authoritative: false });
    }
    expect(recorded.result.usage).toEqual(recorded.meta.usage);
    expect(recorded.events.filter((event) => event.type === 'tool_call')).toHaveLength(counts.executed);
    expect(recorded.events.filter((event) => event.type === 'tool_denied')).toHaveLength(counts.denied_by_handler + counts.denied_by_policy);
  }, 60_000);

  it('saves the configured token ceiling and the model-call backstop in the limits', async () => {
    const recorded = await reviewWithScenario({ maxTokens: 100_000 });
    expect(recorded.meta.limits).toMatchObject({ max_tokens: 100_000, max_model_calls: DEFAULT_CONFIG.limits.maxTurnsReview + 5 });
    expect(recorded.meta.limits.max_cost_usd).toBeUndefined();
  }, 60_000);
});
