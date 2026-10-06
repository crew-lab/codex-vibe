import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeFailure, installProcessGuards } from '../../src/diagnostics/background.js';

afterEach(() => { vi.useRealTimers(); });

function harness(shutdown: () => Promise<void>, shutdownTimeoutMs = 5000) {
  const target = new EventEmitter() as EventEmitter & Pick<NodeJS.Process, 'on' | 'off'>;
  const lines: string[] = []; const exits: number[] = [];
  const uninstall = installProcessGuards({ shutdown, target, write: (text) => lines.push(text), exit: (code) => { exits.push(code); }, shutdownTimeoutMs });
  return { target, lines, exits, uninstall };
}

describe('process guards', () => {
  it('logs one redacted line for an unhandled rejection and keeps running', () => {
    const shutdown = vi.fn(async () => undefined);
    const { target, lines, exits } = harness(shutdown);
    target.emit('unhandledRejection', Object.assign(new Error('failed with api_key=sk-abcdef1234567890xyz\nsecond line'), { code: 'ENOSPC' }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^vibe-supervisor: unhandled rejection: ENOSPC: failed with api_key=\[REDACTED\] second line\n$/);
    expect(lines[0]).not.toContain('sk-abcdef');
    expect(shutdown).not.toHaveBeenCalled();
    expect(exits).toEqual([]);
  });

  it('logs an uncaught exception, shuts down once and exits 1', async () => {
    const shutdown = vi.fn(async () => undefined);
    const { target, lines, exits } = harness(shutdown);
    target.emit('uncaughtException', new Error('boom'));
    target.emit('uncaughtException', new Error('again'));
    await vi.waitFor(() => expect(exits.length).toBeGreaterThan(0));
    expect(lines.filter((line) => line.includes('uncaught exception'))).toHaveLength(2);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exits[0]).toBe(1);
  });

  it('exits 1 after the bounded timeout even when shutdown never finishes', async () => {
    vi.useFakeTimers();
    const { target, exits } = harness(() => new Promise<void>(() => undefined), 5000);
    target.emit('uncaughtException', new Error('boom'));
    await vi.advanceTimersByTimeAsync(4999);
    expect(exits).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(exits).toEqual([1]);
  });

  it('still exits 1 when shutdown rejects, and removes its listeners on uninstall', async () => {
    const { target, exits, uninstall } = harness(async () => { throw new Error('shutdown failed'); });
    target.emit('uncaughtException', new Error('boom'));
    await vi.waitFor(() => expect(exits).toEqual([1]));
    uninstall();
    expect(target.listenerCount('unhandledRejection')).toBe(0);
    expect(target.listenerCount('uncaughtException')).toBe(0);
  });

  it('describes non-error values on one bounded redacted line', () => {
    expect(describeFailure('plain string')).toBe('Error: plain string');
    expect(describeFailure({ code: 'EIO', message: 'x'.repeat(2000) }).length).toBeLessThanOrEqual(500);
  });
});
