import { describe, expect, it } from 'vitest';
import { StreamingRedactor, redactSecrets, redactedTail } from '../../src/security/redaction.js';

const BEGIN = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
const END = ['-----END', 'PRIVATE KEY-----'].join(' ');
const SMALL = { maxPendingChars: 1024, keepChars: 512 } as const;

function drain(redactor: StreamingRedactor, chunks: string[]): string {
  return chunks.map((chunk) => redactor.push(chunk)).join('') + redactor.flush();
}

function chunked(text: string, size: number): string[] {
  const out: string[] = [];
  for (let index = 0; index < text.length; index += size) out.push(text.slice(index, index + size));
  return out;
}

describe('StreamingRedactor long lines', () => {
  it('emits a 200 KB single line in full', () => {
    const line = 'abcdefghij'.repeat(20_000);
    const output = drain(new StreamingRedactor(), chunked(line, 10_000));
    expect(output.length).toBe(line.length);
    expect(output).toBe(line);
  });

  it('keeps content after an oversized line without a newline in between', () => {
    const output = drain(new StreamingRedactor([], SMALL), ['x'.repeat(5000), '\nafter\n']);
    expect(output).toBe(`${'x'.repeat(5000)}\nafter\n`);
  });

  it('redacts a secret placed exactly across the cut', () => {
    const secret = `sk-${'A1b2C3d4'.repeat(6)}`;
    for (const offset of [-10, -1, 0, 1, 10, 30]) {
      const prefixLength = 1024 - 512 + offset;
      const text = `${'p'.repeat(prefixLength)} ${secret} ${'s'.repeat(2000)}\n`;
      const output = drain(new StreamingRedactor([], SMALL), chunked(text, 700));
      expect(output).not.toContain('A1b2C3d4');
      expect(output).toContain('[REDACTED]');
      expect(output.length).toBe(text.length - secret.length + '[REDACTED]'.length);
    }
  });

  it('redacts a key=value secret that straddles the cut', () => {
    const text = `${'p'.repeat(520)} password=hunter2hunter2hunter2${'s'.repeat(2000)}\n`;
    const output = drain(new StreamingRedactor([], SMALL), chunked(text, 300));
    expect(output).not.toContain('hunter2');
  });

  it('redacts a sentinel that straddles the cut', () => {
    const sentinel = 'CUSTOM_SENTINEL_VALUE';
    const text = `${'p'.repeat(1024 - 512 + 5)} ${sentinel}${'s'.repeat(2000)}\n`;
    const output = drain(new StreamingRedactor([sentinel], SMALL), chunked(text, 333));
    expect(output).not.toContain('CUSTOM_SENTINEL');
    expect(output).not.toContain('SENTINEL_VALUE');
  });

  it('redacts a secret split across chunks', () => {
    const secret = `ghp_${'Z9y8X7w6V5'.repeat(3)}`;
    const text = `token ${secret} end\n`;
    const output = drain(new StreamingRedactor(), [text.slice(0, 9), text.slice(9, 20), text.slice(20)]);
    expect(output).not.toContain('Z9y8X7w6V5');
    expect(output).toContain('end');
  });

  it('keeps PEM handling unchanged for normal sizes', () => {
    const pem = `${BEGIN}\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nabcdef\n${END}\n`;
    const output = drain(new StreamingRedactor(), [`before\n${BEGIN.slice(0, 15)}`, `${BEGIN.slice(15)}\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nabc`, `def\n${END}\nafter\n`]);
    expect(output).toBe('before\n[REDACTED]\nafter\n');
    expect(drain(new StreamingRedactor(), [pem])).toBe('[REDACTED]\n');
  });

  it('redacts an oversized PEM block without leaking it or dropping what follows', () => {
    const body = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo'.repeat(200);
    const text = `before\n${BEGIN}\n${body}\n${END}\nafter\n`;
    const output = drain(new StreamingRedactor([], SMALL), chunked(text, 400));
    expect(output).not.toContain('QUJDREVGR0hJ');
    expect(output).not.toContain('BEGIN PRIVATE');
    expect(output.startsWith('before\n')).toBe(true);
    expect(output).toContain('[REDACTED]');
    expect(output.endsWith('after\n')).toBe(true);
  });
});

describe('redactSecrets credential phrases', () => {
  const value = 'k3Jf9Zq1Lm8Xv2Rt5Yp7';

  it.each([
    [`Invalid API key: ${value}`],
    [`invalid api key=${value}`],
    [`The API KEY is ${value} and was rejected`],
    [`x-api-key: ${value}`],
    [`X-API-KEY=${value}`],
    [`MISTRAL_API_KEY=${value}`],
    [`export MISTRAL_API_KEY="${value}"`],
  ])('redacts %s', (text) => {
    const output = redactSecrets(text);
    expect(output).not.toContain(value);
    expect(output).toContain('[REDACTED]');
  });

  it('keeps the descriptive prefix of the phrase', () => {
    expect(redactSecrets(`Invalid API key: ${value}`)).toBe('Invalid API key: [REDACTED]');
    expect(redactSecrets(`MISTRAL_API_KEY=${value}`)).toBe('MISTRAL_API_KEY=[REDACTED]');
  });

  it.each([
    ['API key is required'],
    ['missing API key'],
    ['Please set your API key: see the docs'],
    ['The api key is invalid or expired'],
    ['x-api-key header is not supported here'],
    ['MISTRAL_API_KEY is not set'],
  ])('leaves prose alone: %s', (text) => {
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('redactedTail', () => {
  const bare = 'q7Zk2mXp9WvLc4Nb8RtYs1DfGh3JaE6u';
  const bytes = (text: string) => Buffer.from(text, 'utf8');

  it('redacts a key whose Bearer prefix falls outside the 1 KiB cut', () => {
    const text = `${'p'.repeat(500)} Bearer ${bare}\n${'q'.repeat(1001)}`;
    expect(text.length - 1024).toBeGreaterThan(501 + 'Bearer '.length);
    expect(text.length - 1024).toBeLessThan(501 + 'Bearer '.length + bare.length);
    const output = redactedTail(bytes(text));
    expect(output).not.toContain(bare.slice(10));
    expect(output.length).toBeLessThanOrEqual(1024);
  });

  it('redacts a prefixed key cut in the middle by the window', () => {
    const key = `sk-${'A1b2C3d4'.repeat(4)}`;
    const text = `${'p'.repeat(2000)} ${key} ${'s'.repeat(1000)}`;
    const output = redactedTail(bytes(text));
    expect(output).not.toContain('C3d4');
    expect(output).toContain('[REDACTED]');
  });

  it('redacts a known secret that has no recognizable shape, wherever the cut falls', () => {
    for (const offset of [-20, -5, 0, 5, 20]) {
      const prefix = 1100 + offset;
      const text = `${'p'.repeat(prefix)} fatal ${bare} ${'s'.repeat(1024 - 8 - (offset + 20))}`;
      const output = redactedTail(bytes(text), 1024, [bare]);
      expect(output).not.toContain(bare.slice(8));
      expect(output).not.toContain(bare.slice(0, 20));
    }
  });

  it('keeps a short buffer whole and trims surrounding whitespace', () => {
    expect(redactedTail(bytes('  fatal: not a git repository\n'))).toBe('fatal: not a git repository');
  });

  it('never returns more than the window', () => {
    expect(redactedTail(bytes('x'.repeat(5000)), 200).length).toBe(200);
  });

  it('drops a trailing fragment when the collected buffer was cut at its end', () => {
    const output = redactedTail(bytes(`error: bad token ${bare.slice(0, 20)}`), 1024, [], 'tail');
    expect(output).toBe('error: bad token');
  });

  it('drops a leading fragment when the collected buffer was cut at its start', () => {
    const output = redactedTail(bytes(`${bare.slice(12)}\nfatal: next line`), 1024, [], 'head');
    expect(output).toBe('fatal: next line');
    expect(redactedTail(bytes(bare.slice(12)), 1024, [], 'head')).toBe('');
  });
});
