const REDACTED = '[REDACTED]';

const patterns: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]\s*["']?[^\s,;"']{6,}["']?/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  /\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]*/gi,
  /\b(?:[a-z0-9]+_)*api_key\s*[:=]\s*["']?[^\s,;"']{6,}["']?/gi,
  /\bx-api-key\s*[:=]\s*["']?[^\s,;"']{6,}["']?/gi,
  /\b(?<keep>api\s+key\s*(?:[:=]|\bis\b)\s*)["']?[A-Za-z0-9_-]{16,}["']?/gi,
];

const PEM_BEGIN = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/;
const PEM_END = /-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/;

export function redactSecrets(input: string, sentinels: readonly string[] = []): string {
  let result = input;
  for (const sentinel of sentinels) if (sentinel.length >= 4) result = result.split(sentinel).join(REDACTED);
  for (const pattern of patterns) result = result.replace(pattern, (match, ...args: unknown[]) => {
    const last = args[args.length - 1];
    const keep = last && typeof last === 'object' ? (last as { keep?: string }).keep : undefined;
    if (keep) return `${keep}${REDACTED}`;
    const separator = match.match(/^([^:=]+[:=]\s*)/);
    return separator ? `${separator[1]}${REDACTED}` : REDACTED;
  });
  return result;
}

function secretSpans(text: string, sentinels: readonly string[]): [number, number][] {
  const spans: [number, number][] = [];
  for (const pattern of patterns) for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) spans.push([match.index, match.index + match[0].length]);
  for (const sentinel of sentinels) {
    if (sentinel.length < 4) continue;
    for (let at = text.indexOf(sentinel); at >= 0; at = text.indexOf(sentinel, at + 1)) spans.push([at, at + sentinel.length]);
  }
  return spans;
}

function safeCut(text: string, sentinels: readonly string[], wanted: number): number {
  const spans = secretSpans(text, sentinels);
  let cut = wanted;
  for (let moved = true; moved && cut > 0;) {
    moved = false;
    for (const [start, end] of spans) if (start < cut && end > cut) { cut = start; moved = true; }
  }
  return cut;
}

/** Streaming redactor retains a bounded suffix so tokens split across chunks are joined before emission. */
export class StreamingRedactor {
  private pending = '';
  private discardingPem = false;
  private skipTokenContinuation = false;
  private readonly maxPending: number;
  private readonly keepChars: number;

  constructor(private readonly sentinels: readonly string[] = [], options: { keepChars?: number; maxPendingChars?: number } = {}) {
    this.keepChars = options.keepChars ?? 4096;
    this.maxPending = options.maxPendingChars ?? 65536;
    if (this.keepChars < 512 || this.maxPending < this.keepChars) throw new RangeError('Invalid streaming redactor bounds');
  }

  push(chunk: string): string {
    if (this.discardingPem) {
      const end = PEM_END.exec(chunk);
      if (!end) { this.pending = (this.pending + chunk).slice(-64); return ''; }
      this.discardingPem = false;
      chunk = chunk.slice(end.index + end[0].length);
      this.pending = '';
    }
    if (this.skipTokenContinuation) {
      const boundary = chunk.search(/\s/);
      if (boundary < 0) return '';
      this.skipTokenContinuation = false;
      chunk = chunk.slice(boundary);
    }
    this.pending += chunk;
    // Redact complete records only, so secrets spanning arbitrary transport chunks stay intact.
    // Keep a PEM block open across newline boundaries until its end marker arrives.
    let boundary = this.pending.lastIndexOf('\n') + 1;
    const keyStart = this.openPemStart();
    if (keyStart >= 0) boundary = Math.min(boundary, keyStart);
    let output = '';
    if (boundary) {
      output = redactSecrets(this.pending.slice(0, boundary), this.sentinels);
      this.pending = this.pending.slice(boundary);
    }
    if (this.pending.length > this.maxPending) output += this.emitOversized();
    return output;
  }

  flush(): string {
    const output = this.discardingPem ? REDACTED : redactSecrets(this.pending, this.sentinels);
    this.pending = ''; this.discardingPem = false; this.skipTokenContinuation = false;
    return output;
  }

  private openPemStart(): number {
    const start = this.pending.search(PEM_BEGIN);
    if (start < 0) return -1;
    return this.pending.slice(start).search(PEM_END) < 0 ? start : -1;
  }

  private emitOversized(): string {
    const keyStart = this.openPemStart();
    if (keyStart >= 0) {
      const prefix = redactSecrets(this.pending.slice(0, keyStart), this.sentinels);
      if (this.pending.length - keyStart <= this.maxPending) { this.pending = this.pending.slice(keyStart); return prefix; }
      this.pending = ''; this.discardingPem = true;
      return `${prefix}${REDACTED}`;
    }
    const cut = safeCut(this.pending, this.sentinels, this.pending.length - this.keepChars);
    if (cut <= 0) {
      const output = redactSecrets(this.pending, this.sentinels);
      this.pending = ''; this.skipTokenContinuation = true;
      return output;
    }
    const output = redactSecrets(this.pending.slice(0, cut), this.sentinels);
    this.pending = this.pending.slice(cut);
    return output;
  }
}
