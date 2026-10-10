import { describe, expect, it } from 'vitest';
import { runFromWire, runToWire } from '../../src/core/serialization.js';
import type { RunRecord } from '../../src/contracts.js';
const record: RunRecord = {
  schemaVersion: 1, runId: '00000000-0000-4000-8000-000000000001', backend: 'programmatic', mode: 'review', state: 'closed',
  sourceWorkspace: '/fixture', workerWorkspace: '/fixture', createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z', taskSha256: 'a'.repeat(64),
  limits: { timeoutSeconds: 240, maxTurns: 12, maxEventBytes: 1024, maxTranscriptBytes: 1024, maxArtifactBytes: 1024 }
};
describe('persisted creator version', () => {
  it('roundtrips a recorded version and preserves legacy absence', () => {
    expect(runFromWire(runToWire({ ...record, supervisorVersion: '0.9.0-rc.4' })).supervisorVersion).toBe('0.9.0-rc.4');
    expect(runFromWire(runToWire(record)).supervisorVersion).toBeUndefined();
  });
  it.each([null, 12, '', 'unknown', '0.9.0\n', '0.9.0-' + 'a'.repeat(129)])('rejects invalid persisted version %s', value => {
    expect(() => runFromWire({ ...runToWire(record), supervisor_version: value })).toThrow('Invalid persisted supervisor version');
  });
  it('serializes only the programmatic backend and refuses legacy ACP records', () => {
    const wire = runToWire(record);
    expect(wire.backend).toBe('programmatic');
    expect(() => runFromWire({ ...wire, backend: 'acp' })).toThrow('Invalid persisted run record');
  });
});
