import { describe, it, expect } from 'vitest';
import { UsageAccounting } from '../../src/backends/app-server/usage.js';
import { validateConfig } from '../../src/config/validation.js';
import { configFingerprint } from '../../src/config/config.js';
import { bootBoundDrift } from '../../src/config/policy.js';
import { ProgrammaticBackend } from '../../src/backends/programmatic.js';

const baseline = { sessionPromptTokens: 0, sessionCompletionTokens: 0, sessionCachedTokens: 0, inputPricePerMillion: 2, outputPricePerMillion: 8, cachedInputPricePerMillion: 0.2 };
const sample = { ...baseline, sessionPromptTokens: 1_000_000, sessionCompletionTokens: 100_000, sessionCachedTokens: 500_000 };

describe('app-server usage and sampled ceilings', () => {
  it('uses the pinned cached-token pricing formula and non-authoritative USD', () => {
    const accounting = new UsageAccounting(baseline, {});
    expect(accounting.update(sample)).toEqual({ usage: { tokensUsed: 1_100_000, cost: { amount: 1.9, currency: 'USD', authoritative: false } } });
  });
  it('clamps overreported cached tokens and falls back to the input price', () => {
    const accounting = new UsageAccounting(baseline, {});
    expect(accounting.update({ ...sample, sessionCachedTokens: 2_000_000, cachedInputPricePerMillion: null }).usage.cost?.amount).toBe(2.8);
  });
  it('records a token stop at the threshold and preserves it on later updates', () => {
    const accounting = new UsageAccounting(baseline, { maxSessionTokens: 1_100_000, maxEstimatedCostUsd: 1 });
    expect(accounting.update(sample).stop).toBe('max_session_tokens');
    expect(accounting.update({ ...sample, sessionCompletionTokens: 200_000 }).stop).toBe('max_session_tokens');
  });
  it('records an estimated-price ceiling even when an update overshoots', () => {
    expect(new UsageAccounting(baseline, { maxEstimatedCostUsd: 0.5 }).update(sample).stop).toBe('max_estimated_cost_usd');
  });
  it('keeps cumulative usage through a zero-counter session handoff', () => {
    const accounting = new UsageAccounting(baseline, { maxSessionTokens: 2_000_000 });
    accounting.update(sample);
    expect(accounting.handoff(baseline).usage.tokensUsed).toBe(1_100_000);
    const next = accounting.update(sample);
    expect(next.usage.tokensUsed).toBe(2_200_000); expect(next.usage.cost?.amount).toBe(3.8);
    expect(next.stop).toBe('max_session_tokens');
  });
  it('does not invent prices for incomplete accounting', () => {
    const missing = { sessionPromptTokens: 0, sessionCompletionTokens: 0, sessionCachedTokens: 0 };
    expect(new UsageAccounting(missing, {}).update(missing)).toEqual({ usage: { tokensUsed: 0 } });
    expect(() => new UsageAccounting(missing, { maxEstimatedCostUsd: 1 })).toThrow();
    expect(() => new UsageAccounting({}, { maxSessionTokens: 1 })).toThrow();
  });
  it('rejects reused sessions, counter regressions and invalid numeric fields', () => {
    expect(() => new UsageAccounting(sample, {})).toThrow();
    const accounting = new UsageAccounting(baseline, {}); accounting.update(sample);
    expect(() => accounting.update(baseline)).toThrow();
    for (const bad of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new UsageAccounting({ ...baseline, sessionPromptTokens: bad }, {})).toThrow();
    }
  });
  it('includes both ceilings and executable identity in policy fingerprints and restart checks', () => {
    const before = validateConfig({ version: 1 });
    const after = validateConfig({ version: 1, limits: { max_session_tokens: 100, max_estimated_cost_usd: 0.1 }, paths: { vibe_app_server: '/opt/vibe-app-server' } });
    expect(configFingerprint(before)).not.toBe(configFingerprint(after));
    expect(bootBoundDrift(before, after)).toEqual(['paths.vibe_app_server', 'limits.max_session_tokens', 'limits.max_estimated_cost_usd']);
    expect(after.limits).toMatchObject({ maxSessionTokens: 100, maxEstimatedCostUsd: 0.1 });
  });
  it.each([0, -1, NaN, Infinity])('refuses unsafe ceilings %s', bad => {
    expect(() => validateConfig({ version: 1, limits: { max_session_tokens: bad } })).toThrow();
    expect(() => validateConfig({ version: 1, limits: { max_estimated_cost_usd: bad } })).toThrow();
  });
  it('never silently accepts spending ceilings on the temporary legacy engine', async () => {
    const backend = new ProgrammaticBackend(validateConfig({ version: 1 }));
    await expect(backend.start({
      runId: 'fixture', mode: 'review', task: 'fixture', cwd: '/missing', workerWorkspace: '/missing', runDirectory: '/missing',
      limits: { timeoutSeconds: 180, maxTurns: 12, maxEventBytes: 4096, maxTranscriptBytes: 4096, maxArtifactBytes: 4096, maxEstimatedCostUsd: 1 },
    }, { onEvent: () => undefined, onState: () => undefined })).rejects.toMatchObject({ code: 'VSUP_CONFIG_INVALID' });
  });
});
