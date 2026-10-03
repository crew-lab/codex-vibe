import { open, lstat, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createPrivateDir } from '../security/paths.js';
import { redactSecrets } from '../security/redaction.js';

function stripReasoning(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripReasoning);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:reasoning|thoughts?|chain[_-]?of[_-]?thought|private[_-]?reasoning)/i.test(key)) continue;
      const isCredentialKey = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization|cookie)/i.test(key);
      out[key] = isCredentialKey ? '[REDACTED]' : stripReasoning(child);
    }
    return out;
  }
  return value;
}

export async function atomicWriteJson(file: string, value: unknown, options: { sentinels?: readonly string[] } = {}): Promise<void> {
  const absolute = path.resolve(file);
  const directory = path.dirname(absolute);
  await createPrivateDir(directory);
  try { const info = await lstat(absolute); if (info.isSymbolicLink() || !info.isFile()) throw new Error('Refusing unsafe persistence target'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const safeValue = sanitizeForPersistence(value, options.sentinels ?? []);
  const serialized = JSON.stringify(safeValue, null, 2) + '\n';
  const temp = path.join(directory, `.${path.basename(absolute)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close(); handle = undefined;
    await rename(temp, absolute);
    const dirHandle = await open(directory, 'r');
    try { await dirHandle.sync(); } finally { await dirHandle.close(); }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export function sanitizeForPersistence(value: unknown, sentinels: readonly string[] = []): unknown {
  value = stripReasoning(value);
  return redactJsonStrings(value, sentinels);
}

function redactJsonStrings(value: unknown, sentinels: readonly string[]): unknown {
  if (typeof value === 'string') return redactSecrets(value, sentinels);
  if (Array.isArray(value)) return value.map((child) => redactJsonStrings(child, sentinels));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactJsonStrings(child, sentinels)]));
  return value;
}

export function withoutPrivateReasoning<T>(value: T): T {
  return stripReasoning(value) as T;
}
