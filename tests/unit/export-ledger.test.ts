import { describe, expect, it } from 'vitest';
import { OUTSIDE_WORKSPACE, exportedLedgerPath } from '../../src/reporting/export.js';

describe('exported approval ledger paths', () => {
  const workspaces = ['/srv/data/worktrees/run-1', '/srv/work/project'];

  it('makes paths inside the run workspace workspace-relative', () => {
    expect(exportedLedgerPath('/srv/data/worktrees/run-1/src/index.ts', workspaces)).toBe('src/index.ts');
    expect(exportedLedgerPath('/srv/work/project/docs/a.md', workspaces)).toBe('docs/a.md');
    expect(exportedLedgerPath('file:///srv/work/project/docs/a.md', workspaces)).toBe('docs/a.md');
    expect(exportedLedgerPath('src/./index.ts', workspaces)).toBe('src/index.ts');
    expect(exportedLedgerPath(null, workspaces)).toBeNull();
  });

  it('replaces every path outside the workspace, traversal, home, URL and drive forms with a placeholder', () => {
    for (const raw of [
      '/etc/passwd', '/srv/work/project/../other/secret.txt', '/srv/work', '/srv/work/project', 'file:///etc/passwd', 'file://host/share/x',
      '../outside.txt', 'src/../../outside.txt', '..\\outside.txt', '~/notes.txt', '~', 'C:\\Users\\me\\x', 'https://example.invalid/x', '\\\\server\\share', '', '.'
    ]) expect(exportedLedgerPath(raw, workspaces), raw).toBe(OUTSIDE_WORKSPACE);
  });
});
