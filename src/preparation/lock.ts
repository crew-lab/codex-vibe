import path from 'node:path';
import type { SupervisorConfig } from '../contracts.js';
import { acquireOwnerLock, inspectOwnerLock, type OwnerLock, type OwnerLockDeps, type OwnerLockStatus } from '../core/owner-lock.js';
import { createPrivateDir } from '../security/paths.js';
import { receiptPath } from './evidence.js';

export const PREPARATION_LOCK_FILE = 'preparation.lock';

export function preparationLockDirectory(config: SupervisorConfig, dataDir?: string): string {
  return path.dirname(receiptPath(config, dataDir));
}

export async function acquirePreparationLock(config: SupervisorConfig, dataDir?: string, overrides: Partial<OwnerLockDeps> = {}): Promise<OwnerLock> {
  const directory = preparationLockDirectory(config, dataDir);
  await createPrivateDir(directory);
  return acquireOwnerLock(directory, overrides, PREPARATION_LOCK_FILE);
}

export function inspectPreparationLock(config: SupervisorConfig, dataDir?: string, overrides: Partial<OwnerLockDeps> = {}): Promise<OwnerLockStatus> {
  return inspectOwnerLock(preparationLockDirectory(config, dataDir), overrides, PREPARATION_LOCK_FILE);
}

export function preparationRunningMessage(error: unknown): string {
  const ownerPid = (error as { details?: { owner_pid?: unknown } } | null)?.details?.owner_pid;
  const owner = typeof ownerPid === 'number' ? ` (pid ${ownerPid})` : '';
  return `A preparation is already running${owner}; wait for it to finish, then run prepare check again.`;
}
