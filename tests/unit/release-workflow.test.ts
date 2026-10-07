import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { private?: boolean };

describe('release workflow', () => {
  it('runs on v* tag pushes only', () => {
    expect(workflow).toMatch(/^on:\n {2}push:\n {4}tags:\n {6}- 'v\*'\n/m);
    expect(workflow).not.toMatch(/pull_request|workflow_dispatch|branches:/);
  });

  it('fails when the tag differs from v plus the package.json version', () => {
    expect(workflow).toMatch(/GITHUB_REF_NAME/);
    expect(workflow).toMatch(/package\.json/);
    expect(workflow).toMatch(/"v\$\{?version\}?" ?!= ?"\$\{?GITHUB_REF_NAME\}?"|\[ "\$GITHUB_REF_NAME" != "v\$version" \]/);
    expect(workflow).toMatch(/exit 1/);
  });

  it('refuses a tag whose commit is not on main, with the full history checked out', () => {
    expect(workflow).toMatch(/fetch-depth: 0/);
    expect(workflow).toMatch(/git merge-base --is-ancestor "\$GITHUB_SHA" refs\/remotes\/origin\/main/);
    const guard = workflow.indexOf('merge-base --is-ancestor');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(workflow.indexOf('npm ci'));
  });

  it('grants no permissions by default and contents write only to the release job', () => {
    expect(workflow).toMatch(/^permissions: \{\}$|^permissions:\n {2}contents: read$/m);
    const release = workflow.slice(workflow.indexOf('\n  release:'));
    expect(release).toMatch(/permissions:\n {6}contents: write/);
    expect(workflow.match(/contents: write/g)).toHaveLength(1);
    expect(workflow.slice(0, workflow.indexOf('\n  release:'))).not.toContain('contents: write');
  });

  it('builds with package:rc from a cache populated in the job and attaches the four release files', () => {
    expect(workflow).toMatch(/npm ci/);
    expect(workflow).toMatch(/VIBE_SUPERVISOR_TEST_NPM_CACHE=.* npm run package:rc|VIBE_SUPERVISOR_TEST_NPM_CACHE: .*\n(?:.*\n)*?.*npm run package:rc/);
    for (const name of ['SHA256SUMS', 'sbom.spdx.json', 'acceptance.json', '.tgz']) expect(workflow).toContain(name);
    expect(workflow).toMatch(/gh release create/);
  });

  it('pins third-party actions to commit SHAs and never publishes to npm', () => {
    for (const line of workflow.split('\n').filter((entry) => /uses:/.test(entry))) expect(line).toMatch(/uses: [\w./-]+@[0-9a-f]{40}$/);
    expect(workflow).not.toMatch(/npm publish|NODE_AUTH_TOKEN|NPM_TOKEN/);
    expect(packageJson.private).toBe(true);
  });
});
