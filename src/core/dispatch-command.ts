import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { RunMode } from '../contracts.js';
import { packageRoot } from '../preparation/evidence.js';

export const REQUEST_FILE_PLACEHOLDER = '<private-request-file>';
export const OWNER_REFERENCE_PLACEHOLDER = '<owner-reference>';
export const GRANT_EXPIRY_MS = 30 * 60 * 1000;
export const candidateEntrypoint = path.join(packageRoot, 'dist', 'cli.js');

export interface TaskAuthorizeCommand {
  argv: string[];
  command: string;
  expires_at: string;
  request_template: { operation: RunMode; request: Record<string, unknown> };
}

export interface TaskAuthorizeCommandInput {
  configPath: string;
  operation: RunMode;
  workspace: string;
  baseRef?: string | undefined;
  now?: number | undefined;
}

const PLACEHOLDERS: ReadonlySet<string> = new Set([REQUEST_FILE_PLACEHOLDER, OWNER_REFERENCE_PLACEHOLDER]);
const PLAIN_SHELL_WORD = /^[A-Za-z0-9_.,:=+@%/-]+$/;

function shellWord(value: string): string {
  if (PLACEHOLDERS.has(value) || PLAIN_SHELL_WORD.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function taskAuthorizeCommand(input: TaskAuthorizeCommandInput): Promise<TaskAuthorizeCommand> {
  const expiresAt = new Date((input.now ?? Date.now()) + GRANT_EXPIRY_MS).toISOString();
  const argv = [
    await realpath(process.execPath), candidateEntrypoint, 'task', 'authorize',
    '--request', REQUEST_FILE_PLACEHOLDER,
    '--owner-reference', OWNER_REFERENCE_PLACEHOLDER,
    '--expires-at', expiresAt,
    '--config', input.configPath
  ];
  const request: Record<string, unknown> = input.operation === 'edit'
    ? { cwd: input.workspace, base_ref: input.baseRef ?? 'HEAD' }
    : { cwd: input.workspace, context_files: [] };
  return { argv, command: argv.map(shellWord).join(' '), expires_at: expiresAt, request_template: { operation: input.operation, request } };
}
