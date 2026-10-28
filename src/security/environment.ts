import { mkdir, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';

export const CHILD_MARKER = 'VIBE_SUPERVISOR_CHILD';

const DEFAULT_FORWARD = new Set(['HOME', 'PATH', 'LANG', 'TMPDIR', 'MISTRAL_API_KEY']);

export function isSupervisorChild(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CHILD_MARKER] === '1';
}

/** Build a small child environment. Only named values and LC_* are copied. */
export function buildChildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  extraAllowlist: readonly string[] = [],
): NodeJS.ProcessEnv {
  const allowed = new Set([...DEFAULT_FORWARD, ...extraAllowlist]);
  const child: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && (allowed.has(key) || key.startsWith('LC_'))) child[key] = value;
  }
  child[CHILD_MARKER] = '1';
  return child;
}

export function exactChildEnvironment(values: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) child[key] = value;
  }
  child[CHILD_MARKER] = '1';
  return child;
}

export function assertNotSupervisorChild(env: NodeJS.ProcessEnv = process.env): void {
  if (isSupervisorChild(env)) {
    const error = new Error('Supervisor cannot start recursively from a supervised child');
    Object.assign(error, { code: 'VSUP_RECURSION_BLOCKED' });
    throw error;
  }
}

export async function setupHeadlessBrowserNeutralizer(binDir: string): Promise<string> {
  await mkdir(binDir, { recursive: true, mode: 0o700 });
  const script = '#!/bin/sh\necho "[vibe-supervisor] Blocked unauthorized headless browser launch attempt: $(basename "$0")" >&2\nexit 1\n';
  for (const name of ['open', 'xdg-open']) {
    const target = path.join(binDir, name);
    await writeFile(target, script, { mode: 0o700 });
    await chmod(target, 0o700);
  }
  return binDir;
}
