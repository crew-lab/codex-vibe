import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EventLog } from '../../src/persistence/event-log.js';
import { readNdjsonRecovering } from '../../src/persistence/ndjson.js';

const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(canonicalTmp, 'vsup-eventlog-')); roots.push(root);
  const directory = path.join(root, 'run'); await mkdir(directory, { mode: 0o700 });
  return { directory, file: path.join(directory, 'events.ndjson') };
}

class FailingLog extends EventLog {
  failures = 0;
  protected override async write(payload: string): Promise<void> {
    if (this.failures > 0) { this.failures -= 1; throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); }
    return super.write(payload);
  }
}

describe('EventLog', () => {
  it('writes buffered records in order with one append on flush', async () => {
    const { file } = await fixture();
    const log = new EventLog(file, { maxBytes: 1_000_000, windowMs: 60_000 });
    for (let seq = 1; seq <= 50; seq += 1) log.append({ seq });
    expect(await readNdjsonRecovering(file)).toEqual([]);
    await log.flush();
    expect((await readNdjsonRecovering<{ seq: number }>(file)).map((record) => record.seq)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    log.dispose();
  });

  it('flushes on its own after the window', async () => {
    const { file } = await fixture();
    const log = new EventLog(file, { maxBytes: 1_000_000, windowMs: 30 });
    log.append({ seq: 1 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await readNdjsonRecovering(file)).toEqual([{ seq: 1 }]);
    log.dispose();
  });

  it('leaves a valid prefix when the process stops between flushes', async () => {
    const { file } = await fixture();
    const log = new EventLog(file, { maxBytes: 1_000_000, windowMs: 60_000 });
    for (let seq = 1; seq <= 10; seq += 1) log.append({ seq });
    await log.flush();
    for (let seq = 11; seq <= 15; seq += 1) log.append({ seq });
    log.dispose();
    await writeFile(file, `${await readFile(file, 'utf8')}{"seq":11,"da`);
    const recovered = await readNdjsonRecovering<{ seq: number }>(file, { truncatePartial: true });
    expect(recovered.map((record) => record.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('enforces the byte cap across persisted and buffered bytes', async () => {
    const { file } = await fixture();
    const log = new EventLog(file, { maxBytes: 100, windowMs: 60_000 });
    log.append({ text: 'a'.repeat(40) });
    expect(() => log.append({ text: 'b'.repeat(80) })).toThrow(RangeError);
    await log.flush();
    expect(() => log.append({ text: 'c'.repeat(60) })).toThrow(RangeError);
    log.dispose();
  });

  it('keeps the buffer and reports the failure when a flush fails, then recovers', async () => {
    const { file } = await fixture();
    const failures: unknown[] = [];
    const log = new FailingLog(file, { maxBytes: 1_000_000, windowMs: 60_000, onFailure: (error) => failures.push(error) });
    log.failures = 1;
    log.append({ seq: 1 }); log.append({ seq: 2 });
    await expect(log.flush()).rejects.toMatchObject({ code: 'ENOSPC' });
    log.append({ seq: 3 });
    await log.flush();
    expect((await readNdjsonRecovering<{ seq: number }>(file)).map((record) => record.seq)).toEqual([1, 2, 3]);
    log.dispose();
  });

  it('refuses a symlinked or non-regular events file', async () => {
    const { directory, file } = await fixture();
    await writeFile(path.join(directory, 'elsewhere'), '');
    await symlink(path.join(directory, 'elsewhere'), file);
    const log = new EventLog(file, { maxBytes: 1_000_000, windowMs: 60_000 });
    log.append({ seq: 1 });
    await expect(log.flush()).rejects.toThrow();
    expect(await readFile(path.join(directory, 'elsewhere'), 'utf8')).toBe('');
    log.dispose();
    const second = await fixture();
    await mkdir(second.file);
    const other = new EventLog(second.file, { maxBytes: 1_000_000, windowMs: 60_000 });
    other.append({ seq: 1 });
    await expect(other.flush()).rejects.toThrow();
    other.dispose();
  });

  it('creates the file privately', async () => {
    const { file } = await fixture();
    const log = new EventLog(file, { maxBytes: 1_000_000, windowMs: 60_000 });
    log.append({ seq: 1 }); await log.flush(); log.dispose();
    const { stat } = await import('node:fs/promises');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});
