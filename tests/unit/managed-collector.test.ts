import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BoundedCollector, spawnManaged } from '../../src/process/managed.js';

const scratch: string[] = [];
afterEach(async () => { await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe('BoundedCollector', () => {
  it('keeps chunks up to the cap in order and marks the overflow', () => {
    const collector = new BoundedCollector(10);
    collector.push(Buffer.from('abcd'));
    collector.push(Buffer.from('efgh'));
    expect(collector.truncated).toBe(false);
    collector.push(Buffer.from('ijklmn'));
    expect(collector.truncated).toBe(true);
    expect(collector.toString()).toBe('abcdefghij');
    expect(collector.bytes).toBe(10);
    collector.push(Buffer.from('zzz'));
    expect(collector.toString()).toBe('abcdefghij');
  });

  it('copies what it keeps so later changes to a pushed chunk do not alter it', () => {
    const collector = new BoundedCollector(8);
    const chunk = Buffer.from('abcd');
    collector.push(chunk);
    chunk.fill(0x7a);
    expect(collector.toString()).toBe('abcd');
  });

  it('accumulates many small chunks without quadratic copying', () => {
    const collector = new BoundedCollector(16 * 1024 * 1024);
    const chunk = Buffer.alloc(64, 0x61);
    const begun = Date.now();
    for (let index = 0; index < 200_000; index += 1) collector.push(chunk);
    expect(collector.bytes).toBe(64 * 200_000);
    expect(collector.toBuffer().byteLength).toBe(64 * 200_000);
    expect(Date.now() - begun).toBeLessThan(5000);
  });

  it('can count and bound without retaining anything', () => {
    const collector = new BoundedCollector(6, false);
    collector.push(Buffer.from('abcd'));
    expect(collector.truncated).toBe(false);
    collector.push(Buffer.from('efgh'));
    expect(collector.truncated).toBe(true);
    expect(collector.bytes).toBe(6);
    expect(collector.toBuffer().byteLength).toBe(0);
  });
});

describe('spawnManaged stdout retention', () => {
  async function directory(): Promise<string> {
    const created = await mkdtemp(path.join(await realpath(tmpdir()), 'vsup-managed-'));
    scratch.push(created);
    return created;
  }

  it('streams stdout to the consumer without keeping a second copy when retention is off', async () => {
    const cwd = await directory();
    const seen: string[] = [];
    const proc = spawnManaged(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], { cwd, retainStdout: false, onStdout: (text) => { seen.push(text); } });
    await proc.done;

    expect(seen.join('').length).toBe(100000);
    expect(proc.stdout.toBuffer().byteLength).toBe(0);
    expect(proc.stdout.bytes).toBe(100000);
    expect(proc.stdout.truncated).toBe(false);
  });

  it('still enforces the stdout limit when retention is off', async () => {
    const cwd = await directory();
    let limited: string | undefined;
    const proc = spawnManaged(process.execPath, ['-e', 'process.stdout.write("x".repeat(1000000)); setInterval(() => {}, 1000)'], { cwd, maxStdoutBytes: 64, retainStdout: false, onLimit: (stream) => { limited = stream; } });
    await proc.done;

    expect(limited).toBe('stdout');
    expect(proc.stdout.truncated).toBe(true);
    expect(proc.stdout.toBuffer().byteLength).toBe(0);
  });

  it('retains stdout by default', async () => {
    const cwd = await directory();
    const proc = spawnManaged(process.execPath, ['-e', 'process.stdout.write("hello")'], { cwd });
    await proc.done;
    expect(proc.stdout.toString()).toBe('hello');
  });
});
