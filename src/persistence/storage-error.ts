import path from 'node:path';
import { supervisorError } from '../contracts.js';

const STORAGE_FAULT_CODES: ReadonlySet<string> = new Set(['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EIO', 'EDQUOT', 'EMFILE']);

const STRUCTURAL_FAULT_CODES: ReadonlySet<string> = new Set(['ENOENT', 'EISDIR', 'ELOOP', 'ENOTDIR', 'ENXIO', 'ENOTSUP']);

const STRUCTURAL_MESSAGES: Readonly<Record<string, string>> = {
  ENOENT: 'The run event log could not be written because its directory or file disappeared and could not be recreated (ENOENT).',
  EISDIR: 'The run event log could not be written because its path is now a directory instead of a regular file (EISDIR).',
  ELOOP: 'The run event log could not be written because its path is now a symbolic link, which the supervisor refuses to follow (ELOOP).',
  ENOTDIR: 'The run event log could not be written because a component of its path is not a directory (ENOTDIR).',
  ENXIO: 'The run event log could not be written because its path is not a regular file (ENXIO).',
  ENOTSUP: 'The run event log could not be written because its path is not a regular file (ENOTSUP).',
};
const STRUCTURAL_REMEDIATION = 'Do not move, replace or delete files inside a run directory while the supervisor runs. Close this run and start a new one; the run state is still saved in meta.json.';

const STORAGE_MESSAGES: Readonly<Record<string, string>> = {
  ENOSPC: 'The supervisor could not write to its data directory because the disk is full (ENOSPC).',
  EDQUOT: 'The supervisor could not write to its data directory because the disk quota is exceeded (EDQUOT).',
  EACCES: 'The supervisor is not permitted to write to its data directory (EACCES).',
  EPERM: 'The supervisor is not permitted to write to its data directory (EPERM).',
  EROFS: 'The supervisor cannot write to its data directory because it is on a read-only file system (EROFS).',
  EIO: 'The supervisor hit an I/O error while writing to its data directory (EIO).',
  EMFILE: 'The supervisor process ran out of file descriptors (EMFILE) while writing to its data directory.',
};
const EMFILE_REMEDIATION = 'Raise the open file limit for the supervisor process (for example with ulimit -n) or close other file-heavy work, then retry.';

export function storageFaultCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && STORAGE_FAULT_CODES.has(code) ? code : undefined;
}

export function asStorageError(error: unknown, fallbackDirectory: string, options: { eventLog?: boolean } = {}): unknown {
  const raw = (error as { code?: unknown } | null | undefined)?.code;
  const structural = options.eventLog === true && typeof raw === 'string' && STRUCTURAL_FAULT_CODES.has(raw) ? raw : undefined;
  const code = structural ?? storageFaultCode(error);
  if (!code) return error;
  const failedPath = (error as { path?: unknown }).path;
  const directory = typeof failedPath === 'string' && failedPath ? path.dirname(path.resolve(failedPath)) : path.resolve(fallbackDirectory);
  const message = structural ? STRUCTURAL_MESSAGES[code]! : STORAGE_MESSAGES[code] ?? `The supervisor could not write to its data directory (${code}).`;
  const mapped = supervisorError('VSUP_STORAGE_ERROR', message, { code, directory });
  return Object.assign(new Error(message), structural ? { ...mapped, remediation: STRUCTURAL_REMEDIATION } : code === 'EMFILE' ? { ...mapped, remediation: EMFILE_REMEDIATION } : mapped);
}

export function storageErrorDetails(error: unknown): { code: string; directory: string } | undefined {
  if ((error as { code?: unknown } | null | undefined)?.code !== 'VSUP_STORAGE_ERROR') return undefined;
  const details = (error as { details?: { code?: unknown; directory?: unknown } }).details;
  return typeof details?.code === 'string' && typeof details.directory === 'string' ? { code: details.code, directory: details.directory } : undefined;
}
