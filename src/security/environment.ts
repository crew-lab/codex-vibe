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

export function assertNotSupervisorChild(env: NodeJS.ProcessEnv = process.env): void {
  if (isSupervisorChild(env)) {
    const error = new Error('Supervisor cannot start recursively from a supervised child');
    Object.assign(error, { code: 'VSUP_RECURSION_BLOCKED' });
    throw error;
  }
}
