import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const errorsDocPath = path.join(root, 'docs', 'errors.md');

export const MEANINGS = {
  VSUP_AUTHORIZATION_INVALID: 'No unexpired locally registered grant matches the exact dispatch inputs, or those inputs could not be bound safely.',
  VSUP_ATTEMPT_CONSUMED: 'This authorization-bound dispatch attempt was reserved previously and cannot be reused, including after a failure or restart.',
  VSUP_CONFIG_INVALID: 'The selected configuration file is missing, unsafe (symlinked, foreign-owned, group/world-writable or over 1 MiB), cannot be parsed, or has a missing or invalid field.',
  VSUP_VIBE_NOT_FOUND: 'The Vibe executable, the vibe-app-server executable or the interpreter named on the first line of its script is missing.',
  VSUP_VIBE_VERSION_UNSUPPORTED: 'The installed Vibe is not the pinned version, or its installed files do not match the pin manifest (details.reason names the failed check).',
  VSUP_ANTIGRAVITY_NOT_FOUND: 'The Antigravity CLI executable (agy) is missing or could not be found on PATH or at paths.antigravity.',
  VSUP_ANTIGRAVITY_EXEC_FAILED: 'The Antigravity session failed during execution.',
  VSUP_AUTH_REQUIRED: 'Vibe reported a missing or rejected credential (401, unauthorized, missing API key).',
  VSUP_WORKSPACE_INVALID: 'The workspace or a context file does not exist or lies outside every allowed root, contains project .vibe, a symlink or non-directory .agents, a symlinked .vibeignore or glob characters in its path, or an edit run did not start at the git repository root; details.unavailable_root names an allowed root whose directory no longer exists.',
  VSUP_WORKTREE_CREATE_FAILED: 'git worktree add failed for the edit run; details.stderr_tail and details.operation say why.',
  VSUP_GIT_REQUIRED: 'The git executable is missing, or the workspace is not a Git repository.',
  VSUP_BACKEND_CRASHED: 'The Vibe process exited before the turn finished.',
  VSUP_TIMEOUT: 'The run deadline elapsed, or a Git operation exceeded its limit: 30 s for queries, 5 min for worktree creation, patch export and cleanup (details.operation names it, details.kind is `timeout`).',
  VSUP_RATE_LIMITED: 'Vibe or its provider answered with HTTP 429.',
  VSUP_CANCELLED: 'No longer emitted. Kept so saved run records from older versions still read; this release records a stopped run as `cancelled` with no error.',
  VSUP_OUTPUT_LIMIT: 'The run exceeded an event, transcript or artifact byte limit, or a Git command produced more than 100 MiB of output.',
  VSUP_ARTIFACT_ERROR: 'A saved artifact or private directory failed ownership, privacy, link, size, identity or read checks (details.role/reason), or a run artifact could not be written/exported, including a Git snapshot failure (details.operation), a refused filter or a missing worktree (details.kind workspace_missing).',
  VSUP_INVALID_ARGUMENT: 'A tool argument or selected request/contract/patch/validation input is invalid. File input errors name details.role/reason; ordinary owned 0644 inputs are supported, while unsafe, changed or malformed inputs are refused.',
  VSUP_NOT_FOUND: 'No run with that ID exists.',
  VSUP_BACKEND_ERROR: 'The backend reported a failure that has no more specific code.',
  VSUP_LIMIT_EXCEEDED: 'The owning server/storage instance already has an active run.',
  VSUP_NO_PROGRESS: 'A running worker emitted no event for limits.worker_progress_timeout_seconds, so the supervisor ended the run.',
  VSUP_INVALID_STATE: 'The action is not valid in the run state, the supervisor is shutting down, or an isolated session path is unsafe.',
  VSUP_OWNER_LOCKED: 'Another live supervisor owns the data directory (or isolated session), or its owner lock is unsafe, malformed or being recovered; details.lock_path and details.owner_pid say which. Retryable when the lock is merely contended.',
  VSUP_PREPARATION_TIMEOUT: 'A readiness check or start exceeded its 30 s preparation deadline (configuration reread, workspace validation or base resolution); no run was created.',
  VSUP_STORAGE_ERROR: 'A filesystem fault (disk full, permissions, read-only, I/O) hit the data directory.',
  VSUP_INTERNAL: 'An unexpected supervisor failure; the detail is only on stderr.',
  VSUP_RESTART_REQUIRED: 'The selected configuration, reread before a readiness check or start, changes a boot-bound setting (a path, retention or a limit) that the running server cannot adopt.',
  VSUP_READINESS_RECEIPT_INVALID: 'A start carried a readiness_receipt that is malformed, altered, expired, from another server instance, or bound to a different policy revision, operation, workspace or base_ref, or whose edit base no longer resolves or resolves to another commit; details.reason names which.',
  VSUP_BUDGET_EXCEEDED: 'The daily budget limit for the workspace root has been reached.',
};

const RETRYABLE = new Set(['VSUP_RATE_LIMITED']);

const cell = (text) => text.replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();

export function renderErrorsDoc(remediation) {
  const codes = Object.keys(remediation);
  const rows = codes.map((code) => `| \`${code}\` | ${cell(MEANINGS[code] ?? '')} | ${cell(remediation[code])} | ${RETRYABLE.has(code) ? 'yes' : 'no'} |`);
  return [
    '# Error codes',
    '',
    'Generated by `npm run docs:errors` from `REMEDIATION` in `src/contracts.ts`; do not edit by hand.',
    '',
    'An error carries `code`, `message`, `remediation`, `retryable` and sometimes `details`. `retryable` is `true` only when the failure is transient; every other code reports `false` unless the backend marks it otherwise. Failures that are not supervisor errors reach the client as `VSUP_INTERNAL` without detail.',
    '',
    'When `retryable` is `false`, do not resend the same task with the same limits: the same input fails the same way. Change what the remedy names (the task, a limit, the configuration or the environment) and start one new run deliberately; the supervisor never retries or replays on its own.',
    '',
    '| Code | Meaning | Remedy | Retryable |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { REMEDIATION } = await import(pathToFileURL(path.join(root, 'dist', 'contracts.js')).href);
  const text = renderErrorsDoc(REMEDIATION);
  if (process.argv.includes('--check')) {
    const current = await readFile(errorsDocPath, 'utf8').catch(() => '');
    if (current !== text) { process.stderr.write('docs/errors.md is out of date; run npm run docs:errors.\n'); process.exitCode = 1; }
  } else await writeFile(errorsDocPath, text);
}
