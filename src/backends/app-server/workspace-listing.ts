import { GitOperationError, preparationGit } from '../../git/worktree.js';
import { restrictedRelativePath } from './approvals.js';

export interface ListingLimits {
  maxFiles: number;
  maxBytes: number;
  timeoutMs: number;
  maxGitOutputBytes: number;
}

export const DEFAULT_LISTING_LIMITS: Readonly<ListingLimits> = {
  maxFiles: 1000,
  maxBytes: 32 * 1024,
  timeoutMs: 10_000,
  maxGitOutputBytes: 8 * 1024 * 1024
};

export type ListingUnavailable = 'not_repository' | 'git_missing' | 'timeout' | 'output_limit' | 'failed';

export interface WorkspaceListing {
  text: string | null;
  included: number;
  eligible: number;
  truncated: boolean;
  unavailable: ListingUnavailable | null;
}

const GIT_LIST_ARGUMENTS: readonly string[] = ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
const UNSAFE_CODE_POINTS = (value: string): boolean => [...value].some((character) => { const code = character.codePointAt(0) ?? 0; return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || code === 0xfffd; });
const HEADING = 'Workspace files (paths relative to the workspace root):';

function unavailable(reason: ListingUnavailable): WorkspaceListing {
  return { text: null, included: 0, eligible: 0, truncated: false, unavailable: reason };
}

function classify(error: unknown): ListingUnavailable {
  if (!(error instanceof GitOperationError)) return 'failed';
  switch (error.kind) {
    case 'not_repository': return 'not_repository';
    case 'missing': return 'git_missing';
    case 'timeout': return 'timeout';
    case 'overflow': return 'output_limit';
    default: return 'failed';
  }
}

export function eligibleListingPaths(output: Buffer): string[] {
  const seen = new Set<string>();
  for (const path of output.toString('utf8').split('\0')) {
    if (path.length === 0 || path.startsWith('/') || UNSAFE_CODE_POINTS(path)) continue;
    if (path.split('/').some((segment) => segment === '..' || segment === '.')) continue;
    if (restrictedRelativePath(path) !== null) continue;
    seen.add(path);
  }
  return [...seen].sort();
}

export function formatListing(paths: readonly string[], limits: Pick<ListingLimits, 'maxFiles' | 'maxBytes'>): WorkspaceListing {
  if (paths.length === 0) return { text: null, included: 0, eligible: 0, truncated: false, unavailable: null };
  const lines: string[] = [];
  let bytes = Buffer.byteLength(HEADING) + 1;
  for (const path of paths) {
    const line = `- ${path}`;
    const next = bytes + Buffer.byteLength(line) + 1;
    if (lines.length >= limits.maxFiles || next > limits.maxBytes) break;
    lines.push(line);
    bytes = next;
  }
  const omitted = paths.length - lines.length;
  const truncated = omitted > 0;
  const closing = truncated
    ? [`[Listing truncated: ${omitted} more ${omitted === 1 ? 'file' : 'files'} not shown; the limit is ${limits.maxFiles} files or ${limits.maxBytes} bytes.]`]
    : [];
  return { text: [HEADING, ...lines, ...closing].join('\n'), included: lines.length, eligible: paths.length, truncated, unavailable: null };
}

export async function buildWorkspaceListing(workspace: string, overrides: Partial<ListingLimits> = {}): Promise<WorkspaceListing> {
  const limits = { ...DEFAULT_LISTING_LIMITS, ...overrides };
  let output: Buffer;
  try {
    output = await preparationGit(workspace, [...GIT_LIST_ARGUMENTS], process.env, [0], { timeoutMs: limits.timeoutMs, maxOutputBytes: limits.maxGitOutputBytes });
  } catch (error) {
    return unavailable(classify(error));
  }
  return formatListing(eligibleListingPaths(output), limits);
}
