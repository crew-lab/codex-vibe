import { describe, expect, it } from 'vitest';
import { patchContainsCredential } from '../../src/security/redaction.js';

function patchWith(lines: string[]): string {
  return ['diff --git a/f.ts b/f.ts', '--- a/f.ts', '+++ b/f.ts', '@@ -1,3 +1,4 @@', ...lines, ''].join('\n');
}

describe('patchContainsCredential', () => {
  it.each([
    ['context line', ['   password: string;', '+const a = 1;']],
    ['changed type line', ['+  password: string;']],
    ['env lookup', ['+const secret = process.env.SECRET;']],
    ['type reference', ['+  secret: SecretString,']],
    ['removed credential', ['-const token = "sk' + '-abcdefghijklmnopqrstuvwx";', '+const token = load();']],
    ['context credential', [' const key = "AK' + 'IAABCDEFGHIJKLMNOP";', '+const x = 1;']],
    ['placeholder', ['+password = "changeme-please"', '+api_key: "${API_KEY}"', '+secret = "$SECRET_VALUE"', '+secret = "{{ secret }}"', '+secret = "<token-here>"']],
    ['identifier-like literal', ['+  secret: "secret_required_message",']],
    ['bearer prose', ['+// Bearer authentication is required']],
    ['unquoted types and lookups', ['+  password: string', '+  secret: SecretString,', '+  secret: Option<String>,', '+const secret = process.env.SECRET;', '+password = config.password']],
    ['code header values', ['+headers: { Authorization: authHeader }', '+const h = `Bearer ${token}`;', '+Authorization: Bearer ${token}', '+Cookie: ${cookie}', '+x-api-key: apiKeyVariable', '+Authorization: req.headers.auth']],
  ])('accepts %s', (_name, lines) => {
    expect(patchContainsCredential(patchWith(lines))).toBe(false);
  });

  it.each([
    ['sk key in assignment', ['+api_key = "sk' + '-abcdefghijklmnopqrstuvwx"']],
    ['pem block', ['+-----BEGIN RSA ' + 'PRIVATE KEY-----', '+MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu', '+-----END RSA PRIVATE KEY-----']],
    ['github token', ['+const t = "gh' + 'p_abcdefghijklmnopqrstuvwxyz0123456789";']],
    ['quoted password literal', ['+password = "hunter2hunter2"']],
    ['json key', ['+  "client_secret": "a1b2c3d4e5f6g7h8"']],
    ['aws key', ['+AK' + 'IAABCDEFGHIJKLMNOP']],
    ['unquoted env assignment', ['+MISTRAL_API_KEY=Zk39dLmQ82xPaa71']],
    ['unquoted prefixed password', ['+DB_PASSWORD=Xk39dLmQ82x']],
    ['unquoted password colon', ['+password: hunter2hunter2']],
    ['dollar-leading literal', ['+password = "$ecretPass99"']],
    ['letters-only passphrase', ['+password = "correcthorsebatterystaple"']],
    ['spaced passphrase', ['+password: "a b c d e f g h"']],
    ['x-api-key header', ['+x-api-key: Zk39dLmQ82xPaa71']],
    ['cookie header', ['+Cookie: session=Zk39dLmQ82xPaa71']],
    ['basic auth header', ['+Authorization: Basic dXNlcjpwYXNzd29yZA==']],
    ['literal auth header', ['+Authorization: Zk39dLmQ82xPaa71']],
    ['double-plus content line token', ['++sk' + '-abcdefghijklmnopqrstuvwx']],
    ['double-plus content line assignment', ['++ password = "Xk39dLmQ82x"']],
    ['bearer token', ['+Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345']],
  ])('refuses %s', (_name, lines) => {
    expect(patchContainsCredential(patchWith(lines))).toBe(true);
  });

  it('scans only hunk content, not file headers or other sections', () => {
    const headerOnly = ['diff --git a/f b/f', '--- a/f', '+++ b/password: Zk39dLmQ82xPaa71', '@@ -1 +1 @@', '-x', '+y', ''].join('\n');
    expect(patchContainsCredential(headerOnly)).toBe(false);
  });

  it('refuses an added line carrying a known sentinel', () => {
    expect(patchContainsCredential(patchWith(['+value = unusualtoken987']), ['unusualtoken987'])).toBe(true);
    expect(patchContainsCredential(patchWith([' value = unusualtoken987']), ['unusualtoken987'])).toBe(false);
  });
});
