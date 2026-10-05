import { describe, expect, it } from 'vitest';
import { StreamingRedactor, redactSecrets } from '../../src/security/redaction.js';

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
