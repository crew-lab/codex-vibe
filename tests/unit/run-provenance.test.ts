import { describe, expect, it } from 'vitest';
import { runFromWire, runToWire } from '../../src/core/serialization.js';
import type { RunRecord } from '../../src/contracts.js';
const record: RunRecord = {
  schemaVersion: 1, runId: '00000000-0000-4000-8000-000000000001', backend: 'app-server', mode: 'review', state: 'closed',
  sourceWorkspace: '/fixture', workerWorkspace: '/fixture', createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z', taskSha256: 'a'.repeat(64),
  limits: { timeoutSeconds: 240, maxTurns: 12, maxEventBytes: 1024, maxTranscriptBytes: 1024, maxArtifactBytes: 1024 }
};
describe('persisted creator version', () => {
  it('roundtrips a recorded version and preserves an absent version', () => {
    expect(runFromWire(runToWire({ ...record, supervisorVersion: '3.1.4-beta.2' })).supervisorVersion).toBe('3.1.4-beta.2');
    expect(runFromWire(runToWire(record)).supervisorVersion).toBeUndefined();
  });
  it.each([null, 12, '', 'unknown', '0.9.0\n', '0.9.0-' + 'a'.repeat(129)])('rejects invalid persisted version %s', value => {
    expect(() => runFromWire({ ...runToWire(record), supervisor_version: value })).toThrow('Invalid persisted supervisor version');
  });
  it('serializes only the app-server backend and refuses records of any other backend', () => {
    const wire = runToWire(record);
    expect(wire.backend).toBe('app-server');
    expect(() => runFromWire({ ...wire, backend: 'acp' })).toThrow('Invalid persisted run record');
  });
});

describe('persisted execution outcome', () => {
  it.each(['completed', 'failed', 'cancelled'] as const)('roundtrips %s and leaves records written without an outcome unknown', (executionState) => {
    const wire = runToWire({ ...record, executionState });
    expect(wire.execution_state).toBe(executionState);
    expect(runFromWire(wire).executionState).toBe(executionState);
    expect(runFromWire(runToWire(record)).executionState).toBeUndefined();
  });

  it('rejects invalid persisted execution outcomes', () => {
    expect(() => runFromWire({ ...runToWire(record), execution_state: 'closed' })).toThrow('Invalid persisted execution state');
  });
});
