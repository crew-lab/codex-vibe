import { describe, it, expect } from 'vitest';
import { eventFromWire, eventToWire, runFromWire, runToWire } from '../../src/core/serialization.js';
import type { RunRecord, SupervisorEvent } from '../../src/contracts.js';

function fixture(): RunRecord {
  return {
    schemaVersion: 1, supervisorVersion: '2.0.0-rc.1', runId: '00000000-0000-4000-8000-000000000001',
    backend: 'app-server', mode: 'review', state: 'completed', sourceWorkspace: '/private/workspace', workerWorkspace: '/private/workspace',
    createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:01Z', taskSha256: 'a'.repeat(64),
    limits: { timeoutSeconds: 180, maxTurns: 12, maxEventBytes: 4096, maxTranscriptBytes: 4096, maxArtifactBytes: 4096, maxSessionTokens: 1000, maxEstimatedCostUsd: 0.25 },
  };
}

describe('app-server persisted identities and accounting limits', () => {
  it('round-trips optional ceilings, including fractional USD', () => {
    const record = fixture(); expect(runFromWire(runToWire(record))).toEqual(record);
  });
  it('refuses corrupt persisted ceilings', () => {
    for (const bad of [0, -1, NaN, Infinity, '1']) {
      const wire = runToWire(fixture()); (wire.limits as Record<string, unknown>).max_estimated_cost_usd = bad;
      expect(() => runFromWire(wire)).toThrow();
    }
    const wire = runToWire(fixture()); (wire.limits as Record<string, unknown>).max_session_tokens = 1.5;
    expect(() => runFromWire(wire)).toThrow();
  });
  it('accepts the app-server discriminator and refuses unknown engines', () => {
    const event: SupervisorEvent = { schemaVersion: 1, seq: 1, timestamp: '2026-10-14T00:00:00Z', runId: fixture().runId, backend: 'app-server', source: 'vibe', type: 'tool', severity: 'info', data: { outcome: 'denied' } };
    expect(eventFromWire(eventToWire(event))).toEqual(event);
    expect(() => eventFromWire({ ...eventToWire(event), backend: 'unknown' })).toThrow();
    expect(() => runFromWire({ ...runToWire(fixture()), backend: 'unknown' })).toThrow();
  });
});
