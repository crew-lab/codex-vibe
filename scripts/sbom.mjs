import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const packages = [];
for (const [relative, metadata] of Object.entries(lock.packages ?? {})) {
  if (!relative) continue;
  const item = metadata;
  const name = item.name ?? relative.split('node_modules/').at(-1);
  if (!name || !item.version) continue;
  packages.push({
    SPDXID: `SPDXRef-Package-${packages.length + 1}`,
    name,
    versionInfo: item.version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: item.license ?? 'NOASSERTION',
    externalRefs: [{ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: `pkg:npm/${String(name).replace(/^@/, '').replace('/', '%2F')}@${item.version}` }],
  });
}
const sbom = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: 'vibe-supervisor-source-lockfile',
  documentNamespace: `https://spdx.org/spdxdocs/vibe-supervisor-${randomUUID()}`,
  creationInfo: { creators: ['Tool: vibe-supervisor-sbom-script'], created: new Date().toISOString() },
  packages,
  annotations: [{ annotationType: 'OTHER', annotator: 'Tool: vibe-supervisor-sbom-script', annotationDate: new Date().toISOString(), comment: 'Generated from package-lock.json. Missing license metadata is recorded as NOASSERTION and requires release review.' }],
};
const output = path.join(root, 'dist', 'sbom.spdx.json');
await writeFile(output, `${JSON.stringify(sbom, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Wrote SPDX SBOM with ${packages.length} locked package entries to ${path.relative(root, output)}.\n`);
