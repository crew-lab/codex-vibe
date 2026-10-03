import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['node_modules', '.git', '.cache']);
const secretPatterns = [
  { name: 'private-key PEM', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/ },
  { name: 'Mistral/OpenAI key', pattern: /\bsk-[A-Za-z0-9_-]{24,}\b/ },
];
const findings = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(absolute);
    else if (entry.isFile()) {
      const bytes = await readFile(absolute);
      if (bytes.includes(0)) continue;
      const source = bytes.toString('utf8');
      for (const secret of secretPatterns) if (secret.pattern.test(source)) findings.push({ path: path.relative(root, absolute), type: secret.name });
    }
  }
}
await visit(root);
if (findings.length) {
  process.stderr.write(`Secret scan failed: ${JSON.stringify(findings)}\n`);
  process.exitCode = 1;
} else process.stdout.write('Secret scan passed: no recognized credential formats found.\n');
