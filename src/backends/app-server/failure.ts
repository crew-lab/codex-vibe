import { supervisorError } from '../../contracts.js';
import type { SupervisorError, SupervisorErrorCode } from '../../contracts.js';
import { describeMissing, interpreterMissingMessage } from './executable.js';
import { SUPPORTED_VIBE } from './supported-vibe.js';

export function versionUnsupported(detected: string): SupervisorError {
  return supervisorError('VSUP_VIBE_VERSION_UNSUPPORTED', `Found Vibe ${detected}; this release supports exactly Vibe ${SUPPORTED_VIBE}.`, { detected_version: detected });
}

export function versionMismatchOnStderr(stderr: string): SupervisorError | undefined {
  const detected = stderr.match(/supports exactly \S+; found (\S+)/)?.[1];
  return detected ? versionUnsupported(detected) : undefined;
}

const RATE_LIMIT_PATTERN = /\b(?:http|status(?: code)?|error|code)\W{0,3}429\b|\b429\W{1,3}(?:too many|rate)|\(429\)|\btoo many requests\b/i;
const AUTH_PATTERN = /missing api key|\bunauthori[sz]ed\b|\bforbidden\b|\b(?:http|status(?: code)?|error|code)\W{0,3}40[13]\b|\(40[13]\)|\b40[13]\W{1,3}(?:unauthori[sz]ed|forbidden)/i;
const TAIL_LINES = 5;

export function stderrTailText(text: string): string {
  return text.split('\n').filter((line) => line.trim()).slice(-TAIL_LINES).join('\n');
}

export function rateLimitFailure(text: string): SupervisorError | undefined {
  return RATE_LIMIT_PATTERN.test(text) ? supervisorError('VSUP_RATE_LIMITED', 'Vibe was rate limited by its provider (HTTP 429).', undefined, true) : undefined;
}

export function authFailureText(text: string): boolean {
  return AUTH_PATTERN.test(text);
}

export function classifyFailureText(text: string, fallback: SupervisorErrorCode, message = text): SupervisorError {
  if (authFailureText(text)) return supervisorError('VSUP_AUTH_REQUIRED', message);
  return rateLimitFailure(text) ?? supervisorError(fallback, message);
}

function isCodedError(error: unknown): error is SupervisorError {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string' && (error as { code: string }).code.startsWith('VSUP_');
}

export async function classifyStartFailure(executable: string, error: unknown, stderr = ''): Promise<unknown> {
  const mismatch = versionMismatchOnStderr(stderr);
  if (mismatch) return mismatch;
  if (isCodedError(error)) return error;
  const missing = await describeMissing(executable, error);
  if (missing.executable_missing === true) return supervisorError('VSUP_VIBE_NOT_FOUND', 'The vibe executable was not found.', missing);
  if (missing.interpreter_missing === true) return supervisorError('VSUP_VIBE_NOT_FOUND', interpreterMissingMessage(missing.interpreter), missing);
  const tail = stderrTailText(stderr);
  if (authFailureText(tail)) return supervisorError('VSUP_AUTH_REQUIRED', 'Vibe rejected the credentials (authentication failure).');
  return rateLimitFailure(tail) ?? error;
}
