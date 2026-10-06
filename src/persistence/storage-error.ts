import path from 'node:path';
import { supervisorError } from '../contracts.js';

const STORAGE_FAULT_CODES: ReadonlySet<string> = new Set(['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EIO', 'EDQUOT', 'EMFILE']);

export function storageFaultCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && STORAGE_FAULT_CODES.has(code) ? code : undefined;
}

export function asStorageError(error: unknown, fallbackDirectory: string): unknown {
  const code = storageFaultCode(error);
  if (!code) return error;
  const failedPath = (error as { path?: unknown }).path;
  const directory = typeof failedPath === 'string' && failedPath ? path.dirname(path.resolve(failedPath)) : path.resolve(fallbackDirectory);
  const message = `The supervisor could not write to its data directory (${code}).`;
  return Object.assign(new Error(message), supervisorError('VSUP_STORAGE_ERROR', message, { code, directory }));
}

export function storageErrorDetails(error: unknown): { code: string; directory: string } | undefined {
  if ((error as { code?: unknown } | null | undefined)?.code !== 'VSUP_STORAGE_ERROR') return undefined;
  const details = (error as { details?: { code?: unknown; directory?: unknown } }).details;
  return typeof details?.code === 'string' && typeof details.directory === 'string' ? { code: details.code, directory: details.directory } : undefined;
}
