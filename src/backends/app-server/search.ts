import path from 'node:path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, opendir } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { checkedPath, readSearchFile, searchExcluded } from './path-policy.js';
import { supervisorError } from '../../contracts.js';
import { redactSecrets } from '../../security/redaction.js';

export const listFilesSchema = z.object({
  path: z.string().min(1).max(4096).default('.'),
  cursor: z.string().min(1).max(4096).optional(),
  limit: z.number().int().min(1).max(1000).default(200),
}).strict();
export const grepSchema = z.object({
  pattern: z.string().min(1).max(1024).refine(value => value.trim().length > 0),
  path: z.string().min(1).max(4096).default('.'),
  case_sensitive: z.boolean().default(true),
  max_matches: z.number().int().min(1).max(500).default(100),
}).strict();

interface FileEntry { path: string; size: number; identity: string }
interface Listing { files: FileEntry[]; complete: boolean; reason?: string; skipped: number }
interface Match { path: string; line: number; text: string; column: number }
interface RegexMatch { line: number; text: string; column: number }
interface RegexReply { id: number; matches?: RegexMatch[]; error?: true }

const MAX_RESULT = 65_536;
const REGEX_WORKER = `
const {parentPort, workerData} = require('node:worker_threads');
let regex;
try { regex = new RegExp(workerData.pattern, workerData.caseSensitive ? 'u' : 'iu'); }
catch { parentPort.postMessage({id: 0, error: true}); }
parentPort.on('message', ({id,text,limit}) => {
  if (!regex) { parentPort.postMessage({id,error:true}); return; }
  const matches=[]; let line=0;
  for (const value of text.split(/\\r?\\n/)) {
    line++; const match=regex.exec(value);
    if (match) {
      const start=Math.max(0,match.index-200);
      matches.push({line,column:match.index+1,text:value.slice(start,start+2000)});
      if(matches.length>=limit) break;
    }
  }
  parentPort.postMessage({id,matches});
});
`;

class RegexRunner {
  private readonly worker: Worker;
  private nextId = 1;
  private invalid = false;
  private exited = false;
  constructor(pattern: string, caseSensitive: boolean) {
    this.worker = new Worker(REGEX_WORKER, {
      eval: true, workerData: { pattern, caseSensitive }, env: {},
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8 },
    });
    this.worker.on('message', (value: RegexReply) => { if (value.id === 0 && value.error) this.invalid = true; });
    this.worker.on('error', () => { this.exited = true; });
    this.worker.on('exit', () => { this.exited = true; });
  }

  async scan(text: string, limit: number, timeoutMs: number): Promise<RegexMatch[]> {
    if (this.invalid || this.exited) throw supervisorError('VSUP_INVALID_ARGUMENT', 'Search regex is invalid or exceeded its resource limit.');
    const id = this.nextId++;
    return await new Promise<RegexMatch[]>((resolve, reject) => {
      const finish = (error?: unknown, result?: RegexMatch[]) => {
        clearTimeout(timer); this.worker.off('message', onMessage); this.worker.off('error', onError); this.worker.off('exit', onExit);
        if (error) reject(error); else resolve(result ?? []);
      };
      const onMessage = (value: RegexReply) => {
        if (value.id !== id) return;
        if (value.error || !Array.isArray(value.matches)) finish(supervisorError('VSUP_INVALID_ARGUMENT', 'Invalid search regex.'));
        else finish(undefined, value.matches);
      };
      const onError = () => finish(supervisorError('VSUP_OUTPUT_LIMIT', 'Search regex worker exceeded its resource limit.'));
      const onExit = () => finish(supervisorError('VSUP_OUTPUT_LIMIT', 'Search regex worker stopped before returning a result.'));
      const timer = setTimeout(() => {
        finish(supervisorError('VSUP_TIMEOUT', 'Search regex time limit exceeded.'));
        void this.worker.terminate();
      }, Math.max(1, timeoutMs));
      this.worker.on('message', onMessage); this.worker.once('error', onError); this.worker.once('exit', onExit);
      this.worker.postMessage({ id, text, limit });
    });
  }

  async close(): Promise<void> { await this.worker.terminate(); }
}

/** Supervisor-owned local search. No shell, subprocess search command, or network path. */
export class WorkspaceSearch {
  private readonly cursorKey = randomBytes(32);
  private busy = false;
  constructor(private readonly root: string, private readonly runId: string, private readonly timeoutMs = 10_000, private readonly regexTimeoutMs = 2000) {}

  async listFiles(input: unknown): Promise<{ files: string[]; next_cursor: string | null; complete: boolean; reason?: string; skipped_files: number }> {
    const params = listFilesSchema.parse(input);
    return await this.exclusive(async () => {
      const listing = await this.listing(params.path, performance.now() + Math.min(this.timeoutMs, 10_000));
      const query = createHash('sha256').update(path.relative(this.root, await checkedPath(this.root, params.path))).digest('hex');
      const snapshot = createHash('sha256').update(JSON.stringify(listing.files)).digest('hex');
      const offset = params.cursor === undefined ? 0 : this.cursorOffset(params.cursor, query, snapshot, listing.files.length);
      const files: string[] = [];
      for (const entry of listing.files.slice(offset, offset + params.limit)) {
        const info = await lstat(await checkedPath(this.root, entry.path));
        if (`${info.dev}:${info.ino}:${info.mtimeMs}:${info.ctimeMs}:${info.size}` !== entry.identity) throw supervisorError('VSUP_WORKSPACE_INVALID', 'Search listing changed before disclosure.');
        if (Buffer.byteLength(JSON.stringify(files)) + Buffer.byteLength(entry.path) + 4096 > MAX_RESULT) break;
        files.push(entry.path);
      }
      const end = offset + files.length;
      const next = end < listing.files.length ? this.cursor({ run: this.runId, query, snapshot, offset: end }) : null;
      return {
        files, next_cursor: next, complete: listing.complete && next === null,
        ...(next !== null ? { reason: 'pagination' } : listing.reason === undefined ? {} : { reason: listing.reason }),
        skipped_files: listing.skipped,
      };
    });
  }

  async grep(input: unknown): Promise<{ matches: Match[]; complete: boolean; reason?: string; scanned_files: number; skipped_files: number }> {
    const params = grepSchema.parse(input);
    return await this.exclusive(async () => {
      const deadline = performance.now() + Math.min(this.timeoutMs, 10_000);
      const listing = await this.listing(params.path, deadline);
      const matches: Match[] = [];
      let bytes = 0; let scanned = 0; let skipped = listing.skipped;
      let reason = listing.reason;
      const runner = new RegexRunner(params.pattern, params.case_sensitive);
      try {
        await runner.scan('', 1, Math.min(this.regexTimeoutMs, 2000, deadline - performance.now()));
        for (const entry of listing.files) {
          if (performance.now() >= deadline) { reason = 'time_limit'; break; }
          if (bytes + entry.size > 67_108_864) { reason = 'scan_byte_limit'; break; }
          const file = await readSearchFile(this.root, entry.path);
          if (file.text === undefined) {
            skipped++;
            if (file.reason === 'file_size_limit') reason ??= file.reason;
            continue;
          }
          bytes += Buffer.byteLength(file.text); scanned++;
          const found = await runner.scan(file.text, params.max_matches - matches.length, Math.min(this.regexTimeoutMs, 2000, deadline - performance.now()));
          for (const item of found) {
            const match = { ...item, text: redactSecrets(item.text), path: entry.path };
            if (Buffer.byteLength(JSON.stringify(matches)) + Buffer.byteLength(JSON.stringify(match)) + 4096 > MAX_RESULT) { reason = 'result_byte_limit'; break; }
            matches.push(match);
          }
          if (reason === 'result_byte_limit') break;
          if (matches.length >= params.max_matches) { reason = 'match_limit'; break; }
        }
        return { matches, complete: listing.complete && reason === undefined, ...(reason === undefined ? {} : { reason }), scanned_files: scanned, skipped_files: skipped };
      } finally { await runner.close(); }
    });
  }

  private async listing(input: string, deadline: number): Promise<Listing> {
    const start = await checkedPath(this.root, input);
    const initialRoot = await lstat(this.root);
    const relative = path.relative(this.root, start);
    if (searchExcluded(relative)) throw supervisorError('VSUP_WORKSPACE_INVALID', 'Search scope is excluded by policy.');
    const files: FileEntry[] = []; const directories = [start];
    let inspected = 0; let skipped = 0; let reason: string | undefined;
    const add = async (file: string) => {
      const rel = path.relative(this.root, file);
      if (searchExcluded(rel)) { skipped++; return; }
      const info = await lstat(file);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) { skipped++; return; }
      if (info.isDirectory()) directories.push(file);
      else files.push({ path: rel, size: info.size, identity: `${info.dev}:${info.ino}:${info.mtimeMs}:${info.ctimeMs}:${info.size}` });
    };
    const startInfo = await lstat(start);
    if (startInfo.isFile()) { directories.pop(); await add(start); }
    else if (!startInfo.isDirectory()) throw supervisorError('VSUP_WORKSPACE_INVALID', 'Search scope is not a regular file or directory.');
    for (let index = 0; index < directories.length; index++) {
      if (reason) break;
      const directory = directories[index] as string;
      await checkedPath(this.root, path.relative(this.root, directory) || '.');
      const handle = await opendir(directory);
      for await (const entry of handle) {
        if (++inspected > 20_000) { reason = 'file_count_limit'; break; }
        if (performance.now() >= deadline) { reason = 'time_limit'; break; }
        await add(path.join(directory, entry.name));
      }
    }
    const currentRoot = await lstat(await checkedPath(this.root, '.'));
    if (currentRoot.dev !== initialRoot.dev || currentRoot.ino !== initialRoot.ino) throw supervisorError('VSUP_WORKSPACE_INVALID', 'Search root changed during enumeration.');
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return { files, complete: reason === undefined, ...(reason === undefined ? {} : { reason }), skipped };
  }

  private cursor(payload: Record<string, unknown>): string {
    const value = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return value + '.' + createHmac('sha256', this.cursorKey).update(value).digest('base64url');
  }

  private cursorOffset(cursor: string, query: string, snapshot: string, count: number): number {
    try {
      const parts = cursor.split('.');
      if (parts.length !== 2) throw new Error('Invalid cursor');
      const value = parts[0] as string;
      const signature = Buffer.from(parts[1] as string, 'base64url');
      const expected = createHmac('sha256', this.cursorKey).update(value).digest();
      if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error('Invalid cursor');
      const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
      if (payload.run !== this.runId || payload.query !== query || payload.snapshot !== snapshot || typeof payload.offset !== 'number' || !Number.isSafeInteger(payload.offset) || payload.offset < 0 || payload.offset > count) throw new Error('Stale cursor');
      return payload.offset;
    } catch { throw supervisorError('VSUP_INVALID_ARGUMENT', 'Search cursor is invalid or stale. Start a new listing.'); }
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw supervisorError('VSUP_LIMIT_EXCEEDED', 'The search service already has an active request.');
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
}
