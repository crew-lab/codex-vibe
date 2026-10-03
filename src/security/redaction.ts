const REDACTED = '[REDACTED]';

const patterns: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]\s*["']?[^\s,;"']{6,}["']?/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  /\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]*/gi,
];

export function redactSecrets(input: string, sentinels: readonly string[] = []): string {
  let result = input;
  for (const sentinel of sentinels) if (sentinel.length >= 4) result = result.split(sentinel).join(REDACTED);
  for (const pattern of patterns) result = result.replace(pattern, (match) => {
    const separator = match.match(/^([^:=]+[:=]\s*)/);
    return separator ? `${separator[1]}${REDACTED}` : REDACTED;
  });
  return result;
}

/** Streaming redactor retains a bounded suffix so tokens split across chunks are joined before emission. */
export class StreamingRedactor {
  private pending = '';
  private discardingLongLine = false;
  private readonly maxPending: number;

  constructor(private readonly sentinels: readonly string[] = [], options: { keepChars?: number; maxPendingChars?: number } = {}) {
    const keep = options.keepChars ?? 4096;
    this.maxPending = options.maxPendingChars ?? 65536;
    if (keep < 512 || this.maxPending < keep) throw new RangeError('Invalid streaming redactor bounds');
  }

  push(chunk: string): string {
    if (this.discardingLongLine) {
      const newline = chunk.indexOf('\n');
      if (newline < 0) return '';
      this.discardingLongLine = false;
      chunk = chunk.slice(newline + 1);
    }
    this.pending += chunk;
    if (this.pending.length > this.maxPending) {
      // Never cut through a potentially unfinished token or PEM block.
      this.discardingLongLine = !this.pending.endsWith('\n');
      this.pending = '';
      return `${REDACTED}\n`;
    }
    // Redact complete records only, so secrets spanning arbitrary transport chunks stay intact.
    // Keep a PEM block open across newline boundaries until its end marker arrives.
    let boundary = this.pending.lastIndexOf('\n') + 1;
    const keyStart = this.pending.search(/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/);
    if (keyStart >= 0) {
      const keyEnd = this.pending.search(/-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/);
      if (keyEnd < keyStart) boundary = Math.min(boundary, keyStart);
    }
    if (!boundary) return '';
    const output = redactSecrets(this.pending.slice(0, boundary), this.sentinels);
    this.pending = this.pending.slice(boundary);
    return output;
  }

  flush(): string {
    const output = redactSecrets(this.pending, this.sentinels);
    this.pending = '';
    return output;
  }
}
