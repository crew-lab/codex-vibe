import { redactSecrets } from '../security/redaction.js';

const MAX_DIAGNOSTIC_CHARS = 500;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;

export function describeFailure(error: unknown): string {
  const record = error && typeof error === 'object' ? error as { code?: unknown; name?: unknown; message?: unknown } : undefined;
  const label = typeof record?.code === 'string' ? record.code : typeof record?.name === 'string' ? record.name : 'Error';
  const message = typeof record?.message === 'string' ? record.message : String(error);
  return redactSecrets(`${label}: ${message}`).replace(/\s+/g, ' ').slice(0, MAX_DIAGNOSTIC_CHARS);
}

export function writeDiagnostic(line: string, write: (text: string) => unknown = (text) => process.stderr.write(text)): void {
  try { write(`vibe-supervisor: ${redactSecrets(line).replace(/\s+/g, ' ').slice(0, MAX_DIAGNOSTIC_CHARS)}\n`); } catch {}
}

export function reportBackgroundFailure(context: string, error: unknown): void {
  writeDiagnostic(`background failure in ${context}: ${describeFailure(error)}`);
}

export interface ProcessGuardOptions {
  shutdown(): Promise<void>;
  exit?(code: number): void;
  target?: Pick<NodeJS.Process, 'on' | 'off'>;
  write?(text: string): unknown;
  shutdownTimeoutMs?: number;
}

export function installProcessGuards(options: ProcessGuardOptions): () => void {
  const target = options.target ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const write = options.write ?? ((text: string) => process.stderr.write(text));
  const timeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  let crashing = false;
  const onRejection = (reason: unknown): void => { writeDiagnostic(`unhandled rejection: ${describeFailure(reason)}`, write); };
  const onException = (error: unknown): void => {
    writeDiagnostic(`uncaught exception: ${describeFailure(error)}`, write);
    if (crashing) { exit(1); return; }
    crashing = true;
    let timer: NodeJS.Timeout | undefined;
    const bound = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
    void Promise.race([Promise.resolve().then(options.shutdown).catch(() => undefined), bound]).then(() => { if (timer) clearTimeout(timer); exit(1); });
  };
  target.on('unhandledRejection', onRejection);
  target.on('uncaughtException', onException);
  return () => { target.off('unhandledRejection', onRejection); target.off('uncaughtException', onException); };
}
