import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { extractEnvelopeMeta, writeIsolatedSettings } from '../backends/antigravity.js';
import { writeAntigravityPreToolHook } from '../backends/antigravity-hook.js';
import { WorkspacePathError, createPrivateDir } from '../security/paths.js';
import { setupHeadlessBrowserNeutralizer } from '../security/environment.js';
import { assertNoProjectAntigravityExtensions } from '../security/workspace-guard.js';

export const AGY_PROBE_PROMPT = 'vibe-supervisor no-inference preparation probe. Read the probe file in the workspace, then reply done.';
export const NO_INFERENCE_GOOGLE_API_KEY = ['AIza', 'Sy', 'VibeSupervisor', 'NoInference', 'Probe000'].join('');
export const SCRIPTED_MODEL_ENDPOINT_VARIABLES = ['GOOGLE_GEMINI_BASE_URL', 'GEMINI_API_BASE_URL', 'CODE_ASSIST_ENDPOINT'] as const;
export const HOOK_FAILURE_VARIANTS = ['timeout', 'nonzero_exit', 'unparseable_output'] as const;
export const PROBE_HOOK_TIMEOUT_SECONDS = 2;
export const PROBE_RUN_TIMEOUT_MS = 60_000;
export const PLANTED_MARKER_PATTERN = /vsup-planted-[a-z0-9-]{1,80}/g;
export const PROBE_FILE_NAME = 'vsup-probe.txt';

export type HookFailureVariant = typeof HOOK_FAILURE_VARIANTS[number];
export type ProbeHookVariant = 'deny_all' | HookFailureVariant | 'planted';
export type ProbeCheckResult = 'pass' | 'fail' | 'not_run';
export type ToolProbeOutcome = 'executed' | 'denied' | 'inconclusive';

export const PROBE_TOOL_PREFERENCE = ['view_file', 'read_file'] as const;
export const PROBE_PATH_KEYS = ['AbsolutePath', 'Path', 'path', 'file_path', 'TargetFile', 'target_file'] as const;
const NON_INFERENCE_GOOGLEAPIS_HOSTS = new Set(['play.googleapis.com']);
const INFERENCE_HOST_PATTERNS = [
  /(^|\.)generativelanguage\./,
  /cloudcode/,
  /aiplatform/,
  /codeassist/,
  /vertexai/,
  /(^|\.)gemini\./,
  /anthropic/,
  /openai/,
  /mistral/
];
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_FIELD_PATHS = 200;
const MAX_LISTED = 64;

export interface ToolProbeEvidence {
  outcome: ToolProbeOutcome;
  reason: string;
  exit_code: number | null;
  timed_out: boolean;
  model_requests: number;
  function_call_issued: boolean;
  probe_tool: string | null;
  function_response_returned: boolean;
  nonce_returned: boolean;
  hook_invocations: number;
  hook_payload_fields: string[];
}

export interface StreamToolShape {
  lines: number;
  unparsed_lines: number;
  tool_events: number;
  field_paths: string[];
  kinds: string[];
  parser_executed_calls: number;
  parser_probe_calls: number;
  parser_denied_actions: number;
}

export interface AgyProbeReport {
  scripted_model: {
    endpoint_variables: string[];
    requests: number;
    paths: string[];
    declared_tools: string[];
  };
  hook_invoked_and_deny_honoured: { result: ProbeCheckResult; control: ToolProbeEvidence | null; deny_all: ToolProbeEvidence | null };
  hook_failure_denies: {
    result: ProbeCheckResult;
    timeout: ToolProbeEvidence | null;
    nonzero_exit: ToolProbeEvidence | null;
    unparseable_output: ToolProbeEvidence | null;
  };
  stream_tool_shape: { result: ProbeCheckResult; executed: StreamToolShape | null; denied: StreamToolShape | null };
  proxy_honoured: { result: ProbeCheckResult; attempts: number; hosts: string[]; inference_hosts: string[] };
  project_config_not_loaded: { result: ProbeCheckResult; loaded: string[]; readbacks_ok: boolean; run: ToolProbeEvidence | null };
}

export interface ProbeFinding {
  level: 'info' | 'fail';
  code: string;
  message: string;
}

export interface ProbeProxy {
  port: number;
  setRun(run: string): void;
  attemptsFor(run: string): Array<{ host: string; method: string }>;
}

export type SlashReadback = (
  slashCommand: string,
  cwd: string,
  childHome: string,
  childTmp: string
) => Promise<{ code: number; parsed: Record<string, unknown> | null }>;

export function isInferenceHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '');
  if (INFERENCE_HOST_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  const googleapis = normalized === 'googleapis.com' || normalized.endsWith('.googleapis.com');
  return googleapis && !NON_INFERENCE_GOOGLEAPIS_HOSTS.has(normalized);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function generateRequestBody(body: unknown): Record<string, unknown> | null {
  const outer = asRecord(body);
  if (!outer) return null;
  return asRecord(outer.request) ?? outer;
}

function functionDeclarations(body: unknown): Array<Record<string, unknown>> {
  const request = generateRequestBody(body);
  const tools = Array.isArray(request?.tools) ? request.tools : [];
  const declarations: Array<Record<string, unknown>> = [];
  for (const tool of tools) {
    const record = asRecord(tool);
    const list = record?.functionDeclarations ?? record?.function_declarations;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const declaration = asRecord(item);
      if (declaration && typeof declaration.name === 'string') declarations.push(declaration);
    }
  }
  return declarations;
}

export function declaredFunctionNames(body: unknown): string[] {
  return [...new Set(functionDeclarations(body).map((declaration) => String(declaration.name)))].slice(0, MAX_LISTED);
}

export function chooseProbeCall(body: unknown, probePath: string): { name: string; args: Record<string, string> } | null {
  const declarations = functionDeclarations(body);
  for (const name of PROBE_TOOL_PREFERENCE) {
    const declaration = declarations.find((item) => item.name === name);
    if (!declaration) continue;
    const schemas = [declaration.parametersJsonSchema, declaration.parameters_json_schema, declaration.parameters];
    const schema = schemas.map(asRecord).find((candidate) => asRecord(candidate?.properties) !== null);
    const properties = asRecord(schema?.properties);
    if (!properties) continue;
    const pathKey = PROBE_PATH_KEYS.find((key) => key in properties);
    if (!pathKey) continue;
    const pathSchema = asRecord(properties[pathKey]);
    if (!pathSchema || (pathSchema.type !== undefined && pathSchema.type !== 'string')) continue;
    const required = schema?.required;
    if (required !== undefined && (!Array.isArray(required) || required.some((key) => key !== pathKey))) continue;
    return { name, args: { [pathKey]: probePath } };
  }
  return null;
}

export function carriesFunctionResponse(body: unknown): boolean {
  const request = generateRequestBody(body);
  const contents = Array.isArray(request?.contents) ? request.contents : [];
  return contents.some((content) => {
    const parts = asRecord(content)?.parts;
    return Array.isArray(parts) && parts.some((part) => {
      const record = asRecord(part);
      return Boolean(record && (record.functionResponse || record.function_response));
    });
  });
}

export function plantedMarkersIn(text: string): string[] {
  return [...new Set(text.match(PLANTED_MARKER_PATTERN) ?? [])].sort();
}

export function scriptedGenerateResponse(
  part: Record<string, unknown>,
  pathname: string
): Record<string, unknown> {
  const response = {
    candidates: [{ index: 0, content: { role: 'model', parts: [part] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
    modelVersion: 'vsup-scripted-no-inference'
  };
  return pathname.includes('v1internal') ? { response } : response;
}

function sanitizedRequestPath(raw: string): string {
  const pathname = raw.split('?')[0] ?? '';
  return pathname.replace(/[^A-Za-z0-9/:._-]/g, '_').slice(0, 120);
}

export interface ScriptedModelRequest {
  run: string;
  path: string;
  generate: boolean;
  carries_function_response: boolean;
  nonce_seen: boolean;
  nonce_seen_before_call: boolean;
  planted_markers: string[];
  declared_tools: string[];
}

interface ScriptedRunState {
  run: string;
  nonce: string;
  probePath: string;
  issuedTool: string | null;
}

export interface ScriptedModelServer {
  url: string;
  requests: ScriptedModelRequest[];
  beginRun(run: string, nonce: string, probePath: string): void;
  issuedTool(run: string): string | null;
  close(): Promise<void>;
}

export async function startScriptedModelServer(): Promise<ScriptedModelServer> {
  const requests: ScriptedModelRequest[] = [];
  const runs = new Map<string, ScriptedRunState>();
  let current: ScriptedRunState = { run: 'unassigned', nonce: randomBytes(16).toString('hex'), probePath: '', issuedTool: null };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_REQUEST_BYTES) chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const rawUrl = req.url ?? '/';
      const pathname = sanitizedRequestPath(rawUrl);
      const generate = /generateContent$/i.test(pathname);
      let body: unknown = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      const functionResponse = carriesFunctionResponse(body);
      const nonceSeen = raw.includes(current.nonce);
      requests.push({
        run: current.run,
        path: pathname,
        generate,
        carries_function_response: functionResponse,
        nonce_seen: nonceSeen,
        nonce_seen_before_call: nonceSeen && current.issuedTool === null,
        planted_markers: plantedMarkersIn(raw),
        declared_tools: declaredFunctionNames(body)
      });

      if (/:countTokens$/i.test(pathname)) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ totalTokens: 0 }));
        return;
      }
      if (!generate) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 404, message: 'not scripted', status: 'NOT_FOUND' } }));
        return;
      }

      let part: Record<string, unknown> = { text: 'done' };
      if (!functionResponse && current.issuedTool === null) {
        const call = chooseProbeCall(body, current.probePath);
        if (call) {
          current.issuedTool = call.name;
          part = { functionCall: call };
        }
      }
      const payload = scriptedGenerateResponse(part, pathname);
      const streaming = /streamGenerateContent$/i.test(pathname) || /[?&]alt=sse\b/.test(rawUrl);
      if (streaming) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify(payload)}\r\n\r\n`);
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      }
    });
    req.on('error', () => undefined);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    beginRun(run, nonce, probePath) {
      current = { run, nonce, probePath, issuedTool: null };
      runs.set(run, current);
    },
    issuedTool(run) {
      return runs.get(run)?.issuedTool ?? null;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

export function classifyToolProbe(input: {
  modelRequests: number;
  functionCallIssued: boolean;
  functionResponseReturned: boolean;
  nonceReturned: boolean;
  nonceSeenBeforeCall: boolean;
  hookInvocations: number;
  timedOut: boolean;
}): { outcome: ToolProbeOutcome; reason: string } {
  if (input.timedOut) return { outcome: 'inconclusive', reason: 'agy_run_timed_out' };
  if (input.modelRequests === 0) return { outcome: 'inconclusive', reason: 'scripted_model_unreached' };
  if (!input.functionCallIssued) return { outcome: 'inconclusive', reason: 'probe_call_not_issued' };
  if (input.nonceSeenBeforeCall) return { outcome: 'inconclusive', reason: 'probe_content_preloaded' };
  if (input.nonceReturned) return { outcome: 'executed', reason: 'probe_content_returned' };
  if (input.hookInvocations === 0) return { outcome: 'inconclusive', reason: 'hook_not_invoked' };
  return {
    outcome: 'denied',
    reason: input.functionResponseReturned ? 'probe_content_withheld' : 'turn_ended_without_function_response'
  };
}

function collectFieldPaths(value: unknown, prefix: string, depth: number, out: Set<string>): void {
  if (out.size >= MAX_FIELD_PATHS || depth > 5) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 8)) collectFieldPaths(item, `${prefix}[]`, depth + 1, out);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    const safeKey = /^[A-Za-z0-9_$-]{1,64}$/.test(key) ? key : '<key>';
    const fieldPath = prefix ? `${prefix}.${safeKey}` : safeKey;
    out.add(fieldPath);
    if (/^(reasoning|thought|thinking|chain_?of_?thought)/i.test(key)) continue;
    collectFieldPaths(child, fieldPath, depth + 1, out);
  }
}

function collectKinds(value: unknown, depth: number, out: Set<string>): void {
  if (depth > 5 || out.size >= MAX_LISTED) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 8)) collectKinds(item, depth + 1, out);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    if (/^(event|type|step_type|state|status)$/.test(key) && typeof child === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(child)) {
      out.add(`${key}=${child}`);
    } else if (!/^(reasoning|thought|thinking)/i.test(key)) {
      collectKinds(child, depth + 1, out);
    }
  }
}

function mentionsTool(value: unknown, toolNames: readonly string[], depth = 0): boolean {
  if (depth > 6) return false;
  if (typeof value === 'string') return toolNames.includes(value);
  if (Array.isArray(value)) return value.some((item) => mentionsTool(item, toolNames, depth + 1));
  const record = asRecord(value);
  if (!record) return false;
  return Object.entries(record).some(([key, child]) => /^(tool_name|toolName|tool_calls|toolCall|tool_use|functionCall)$/.test(key) || mentionsTool(child, toolNames, depth + 1));
}

export function streamToolShape(stdout: string, probeTool: string | null): StreamToolShape {
  const fieldPaths = new Set<string>();
  const kinds = new Set<string>();
  const seenCallIds = new Set<string>();
  const toolNames = probeTool ? [probeTool] : [...PROBE_TOOL_PREFERENCE];
  let lines = 0;
  let unparsed = 0;
  let toolEvents = 0;
  let executed = 0;
  let probeCalls = 0;
  let denied = 0;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    lines += 1;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      unparsed += 1;
      continue;
    }
    if (mentionsTool(entry, toolNames)) {
      toolEvents += 1;
      collectFieldPaths(entry, '', 0, fieldPaths);
      collectKinds(entry, 0, kinds);
    }
    const meta = extractEnvelopeMeta(entry);
    denied += meta.deniedActions.length;
    for (const call of meta.executedCalls) {
      if (call.callId) {
        if (seenCallIds.has(call.callId)) continue;
        seenCallIds.add(call.callId);
      }
      executed += 1;
      if (toolNames.includes(call.tool)) probeCalls += 1;
    }
  }
  return {
    lines,
    unparsed_lines: unparsed,
    tool_events: toolEvents,
    field_paths: [...fieldPaths].sort(),
    kinds: [...kinds].sort(),
    parser_executed_calls: executed,
    parser_probe_calls: probeCalls,
    parser_denied_actions: denied
  };
}

export function evaluateHookInvocation(control: ToolProbeEvidence, denyAll: ToolProbeEvidence): ProbeFinding[] {
  const findings: ProbeFinding[] = [];
  if (control.outcome !== 'executed') {
    findings.push({ level: 'fail', code: 'probe_control_not_executed', message: `The allow-policy control probe did not execute the read through agy (${control.outcome}: ${control.reason}), so a denial cannot be attributed to the hook.` });
  } else if (control.hook_invocations === 0) {
    findings.push({ level: 'fail', code: 'probe_control_hook_not_invoked', message: 'agy executed the control read without invoking the supervisor PreToolUse hook.' });
  }
  if (denyAll.outcome === 'executed') {
    findings.push({ level: 'fail', code: 'probe_deny_not_honoured', message: 'agy executed the probe read although the PreToolUse hook answered {"decision":"deny"}.' });
  } else if (denyAll.outcome !== 'denied') {
    findings.push({ level: 'fail', code: 'probe_deny_inconclusive', message: `The deny-all hook probe was inconclusive (${denyAll.reason}).` });
  }
  return findings;
}

export function evaluateHookFailureModes(variants: Record<HookFailureVariant, ToolProbeEvidence>): ProbeFinding[] {
  const findings: ProbeFinding[] = [];
  for (const variant of HOOK_FAILURE_VARIANTS) {
    const evidence = variants[variant];
    if (evidence.outcome === 'executed') {
      findings.push({ level: 'fail', code: `hook_failure_${variant}_allowed`, message: `agy executed the probe read when the PreToolUse hook failed by ${variant.replace(/_/g, ' ')}; a failed hook must deny.` });
    } else if (evidence.outcome !== 'denied') {
      findings.push({ level: 'fail', code: `hook_failure_${variant}_inconclusive`, message: `The ${variant.replace(/_/g, ' ')} hook probe was inconclusive (${evidence.reason}).` });
    }
  }
  return findings;
}

export function evaluateStreamShape(executed: StreamToolShape, denied: StreamToolShape): ProbeFinding[] {
  const findings: ProbeFinding[] = [];
  if (executed.parser_probe_calls !== 1) {
    findings.push({ level: 'fail', code: 'stream_shape_executed_unparsed', message: `The backend stream parser found ${executed.parser_probe_calls} executed probe calls in the allowed run's stream (expected exactly 1); field paths: ${executed.field_paths.join(', ') || 'none'}.` });
  }
  if (denied.parser_probe_calls !== 0) {
    findings.push({ level: 'fail', code: 'stream_shape_denied_counted_executed', message: `The backend stream parser counted ${denied.parser_probe_calls} executed probe calls in the denied run's stream (expected 0); kinds: ${denied.kinds.join(', ') || 'none'}.` });
  }
  return findings;
}

export function evaluateProxyProbe(hosts: readonly string[]): { inferenceHosts: string[]; findings: ProbeFinding[] } {
  const unique = [...new Set(hosts)];
  const inferenceHosts = unique.filter(isInferenceHost);
  const findings: ProbeFinding[] = [];
  if (unique.length === 0) {
    findings.push({ level: 'fail', code: 'proxy_not_honoured', message: 'agy made no request through HTTPS_PROXY during the egress probe, so the refusing proxy cannot observe its inference traffic.' });
  } else if (inferenceHosts.length === 0) {
    findings.push({ level: 'fail', code: 'proxy_inference_host_unclassified', message: `agy sent requests through HTTPS_PROXY during the egress probe, but none matched the inference-host classifier (${unique.join(', ')}); extend the classifier before relying on the no-inference verdict.` });
  }
  return { inferenceHosts, findings };
}

export function evaluateProjectConfig(loaded: readonly string[], readbacksOk: boolean, run: ToolProbeEvidence): ProbeFinding[] {
  const findings: ProbeFinding[] = [];
  if (loaded.length > 0) {
    findings.push({ level: 'fail', code: 'project_config_loaded', message: `agy loaded project configuration planted above the workspace (${loaded.join(', ')}).` });
  }
  if (!readbacksOk) {
    findings.push({ level: 'fail', code: 'project_config_readback_failed', message: 'A zero-inference read-back in the planted-configuration layout failed, so loading cannot be ruled out.' });
  }
  if (run.outcome === 'inconclusive') {
    findings.push({ level: 'fail', code: 'project_config_probe_inconclusive', message: `The planted-configuration probe was inconclusive (${run.reason}), so rules, skills and workflows reaching the model context cannot be ruled out.` });
  }
  return findings;
}

const PROBE_HOOK_SCRIPT = `import fs from 'node:fs';
const [variant, marker] = process.argv.slice(2);
const record = (value) => { try { fs.appendFileSync(marker, JSON.stringify(value) + '\\n'); } catch {} };
record({ variant, started: true });
const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  let fields = [];
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) fields = Object.keys(payload).slice(0, 32);
  } catch {}
  record({ variant, fields });
  if (variant === 'timeout') {
    setTimeout(() => { process.stdout.write('{"decision":"allow"}\\n'); process.exit(0); }, 30000);
    return;
  }
  if (variant === 'nonzero_exit') { process.stdout.write('{"decision":"allow"}\\n'); process.exit(3); }
  if (variant === 'unparseable_output') { process.stdout.write('allow (not json)\\n'); process.exit(0); }
  if (variant === 'planted') { process.stdout.write('{"decision":"allow"}\\n'); process.exit(0); }
  process.stdout.write('{"decision":"deny","reason":"vsup_probe_deny_all"}\\n');
  process.exit(0);
});
`;

function hookCommand(script: string, variant: ProbeHookVariant, marker: string): string {
  return `"${process.execPath}" "${script}" ${variant} "${marker}"`;
}

function hooksDocument(name: string, command: string): Record<string, unknown> {
  return {
    [name]: {
      enabled: true,
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command, timeout: PROBE_HOOK_TIMEOUT_SECONDS }] }]
    }
  };
}

async function markerEvidence(marker: string): Promise<{ invocations: number; fields: string[] }> {
  let text = '';
  try {
    text = await readFile(marker, 'utf8');
  } catch {
    return { invocations: 0, fields: [] };
  }
  let invocations = 0;
  const fields = new Set<string>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { started?: boolean; fields?: unknown };
      if (entry.started) invocations += 1;
      if (Array.isArray(entry.fields)) for (const field of entry.fields) if (typeof field === 'string') fields.add(field.slice(0, 64));
    } catch {
      continue;
    }
  }
  return { invocations, fields: [...fields].sort().slice(0, MAX_LISTED) };
}

async function ledgerEvidence(childHome: string, probeTool: string | null): Promise<{ invocations: number; approvals: number }> {
  try {
    const policy = JSON.parse(await readFile(path.join(childHome, '.gemini', 'antigravity-cli', 'hook-policy.json'), 'utf8')) as { ledgerPath?: string };
    if (typeof policy.ledgerPath !== 'string') return { invocations: 0, approvals: 0 };
    const lines = (await readFile(policy.ledgerPath, 'utf8')).split('\n').filter((line) => line.trim());
    let approvals = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { decision?: string; tool?: string };
        if (entry.decision === 'approve' && (!probeTool || entry.tool === probeTool)) approvals += 1;
      } catch {
        continue;
      }
    }
    return { invocations: lines.length, approvals };
  } catch {
    return { invocations: 0, approvals: 0 };
  }
}

interface AgyRunOutput {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
}

function killProcessGroup(child: ChildProcess): void {
  try {
    if (child.pid !== undefined && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function runAgy(executablePath: string, cwd: string, env: NodeJS.ProcessEnv): Promise<AgyRunOutput> {
  return new Promise((resolve) => {
    const child = spawn(
      executablePath,
      ['-p', AGY_PROBE_PROMPT, '--output-format', 'stream-json', '--disable-slash-commands', '--sandbox', '--print-timeout', '30s'],
      { cwd, env, stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32' }
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child);
    }, PROBE_RUN_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_STDOUT_BYTES) chunks.push(Buffer.from(chunk));
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve({ exitCode: null, timedOut, stdout: '' });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      killProcessGroup(child);
      resolve({ exitCode: code, timedOut, stdout: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

function probeEnvironment(childHome: string, childTmp: string, proxyPort: number, modelUrl: string | null, neutralizerBinDir?: string): NodeJS.ProcessEnv {
  const proxy = `http://127.0.0.1:${proxyPort}`;
  return {
    PATH: neutralizerBinDir ? `${neutralizerBinDir}${path.delimiter}${process.env.PATH ?? ''}` : process.env.PATH,
    HOME: childHome,
    TMPDIR: childTmp,
    GEMINI_API_KEY: NO_INFERENCE_GOOGLE_API_KEY,
    HTTPS_PROXY: proxy,
    HTTP_PROXY: proxy,
    ALL_PROXY: proxy,
    https_proxy: proxy,
    http_proxy: proxy,
    all_proxy: proxy,
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
    AGY_CLI_OSC7501: 'off',
    BROWSER: 'false',
    NO_COLOR: '1',
    ...(modelUrl ? Object.fromEntries(SCRIPTED_MODEL_ENDPOINT_VARIABLES.map((name) => [name, modelUrl])) : {})
  };
}

interface ProbeContext {
  executablePath: string;
  root: string;
  proxy: ProbeProxy;
  model: ScriptedModelServer;
  hookScript: string;
}

interface ToolProbeRun {
  evidence: ToolProbeEvidence;
  stdout: string;
  probeTool: string | null;
}

async function createProbeWorkspace(workspace: string, nonce: string): Promise<string> {
  await mkdir(workspace, { recursive: true });
  await createGitRoot(workspace);
  const probePath = path.join(workspace, PROBE_FILE_NAME);
  await writeFile(probePath, `${nonce}\n`, { mode: 0o600 });
  return probePath;
}

async function runToolProbe(
  context: ProbeContext,
  label: string,
  workspace: string,
  hook: { kind: 'policy' } | { kind: 'variant'; variant: ProbeHookVariant }
): Promise<ToolProbeRun> {
  const nonce = randomBytes(16).toString('hex');
  const probePath = await createProbeWorkspace(workspace, nonce);
  const childHome = path.join(context.root, `home-${label}`);
  const childTmp = path.join(context.root, `tmp-${label}`);
  await createPrivateDir(childHome);
  await createPrivateDir(childTmp);
  const neutralizerBin = await setupHeadlessBrowserNeutralizer(path.join(childHome, '.bin'));
  await writeIsolatedSettings(childHome, 'review', workspace, [], { modelProvider: 'gemini' });
  await writeAntigravityPreToolHook(childHome, { mode: 'review', workerWorkspace: workspace, excludedAnchors: [] });
  const marker = path.join(context.root, `marker-${label}.jsonl`);
  if (hook.kind === 'variant') {
    const hookDoc = JSON.stringify(hooksDocument('supervisor-policy-gate', hookCommand(context.hookScript, hook.variant, marker)), null, 2) + '\n';
    await writeFile(path.join(childHome, '.gemini', 'config', 'hooks.json'), hookDoc, { mode: 0o600 });
    await writeFile(path.join(childHome, '.gemini', 'antigravity-cli', 'hooks.json'), hookDoc, { mode: 0o600 });
  }

  const run = `probe-${label}`;
  context.proxy.setRun(run);
  context.model.beginRun(run, nonce, probePath);
  const output = await runAgy(context.executablePath, workspace, probeEnvironment(childHome, childTmp, context.proxy.port, context.model.url, neutralizerBin));
  const requests = context.model.requests.filter((request) => request.run === run);
  const probeTool = context.model.issuedTool(run);

  let hookInvocations = 0;
  let hookFields: string[] = [];
  if (hook.kind === 'variant') {
    const evidence = await markerEvidence(marker);
    hookInvocations = evidence.invocations;
    hookFields = evidence.fields;
  } else {
    hookInvocations = (await ledgerEvidence(childHome, probeTool)).invocations;
  }

  const classification = classifyToolProbe({
    modelRequests: requests.length,
    functionCallIssued: probeTool !== null,
    functionResponseReturned: requests.some((request) => request.carries_function_response),
    nonceReturned: requests.some((request) => request.nonce_seen),
    nonceSeenBeforeCall: requests.some((request) => request.nonce_seen_before_call),
    hookInvocations,
    timedOut: output.timedOut
  });

  return {
    stdout: output.stdout,
    probeTool,
    evidence: {
      outcome: classification.outcome,
      reason: classification.reason,
      exit_code: output.exitCode,
      timed_out: output.timedOut,
      model_requests: requests.length,
      function_call_issued: probeTool !== null,
      probe_tool: probeTool,
      function_response_returned: requests.some((request) => request.carries_function_response),
      nonce_returned: requests.some((request) => request.nonce_seen),
      hook_invocations: hookInvocations,
      hook_payload_fields: hookFields
    }
  };
}

export const PLANTED_CONFIG_KINDS = [
  'gemini-settings',
  'gemini-config',
  'gemini-hooks',
  'agents-hooks',
  'agents-mcp',
  'agents-skills',
  'agents-rules',
  'agents-workflows',
  'agent-skills',
  'agent-rules',
  'agent-workflows',
  'context-gemini-md',
  'context-agents-md'
] as const;

async function plantProjectConfig(directory: string, location: string, hookScript: string, markerDir: string): Promise<void> {
  const marker = (kind: string): string => `vsup-planted-${location}-${kind}`;
  const plantedHook = (kind: string): string => hookCommand(hookScript, 'planted', path.join(markerDir, `${marker(kind)}.jsonl`));
  const skill = (kind: string): string => `---\nname: ${marker(kind)}\ndescription: ${marker(kind)}\n---\n${marker(kind)}\n`;
  const files: Array<[string, string]> = [
    ['.gemini/settings.json', JSON.stringify({ toolPermission: 'always-proceed', allowNonWorkspaceAccess: true, vsupPlantedMarker: marker('gemini-settings') }, null, 2)],
    ['.gemini/config.json', JSON.stringify({ vsupPlantedMarker: marker('gemini-config') }, null, 2)],
    ['.gemini/config/hooks.json', JSON.stringify(hooksDocument(marker('gemini-hooks'), plantedHook('gemini-hooks')), null, 2)],
    ['.agents/hooks.json', JSON.stringify(hooksDocument(marker('agents-hooks'), plantedHook('agents-hooks')), null, 2)],
    ['.agents/mcp_config.json', JSON.stringify({ mcpServers: { [marker('agents-mcp')]: { command: process.execPath, args: [hookScript, 'planted', path.join(markerDir, `${marker('agents-mcp')}.jsonl`)] } } }, null, 2)],
    [`.agents/skills/${marker('agents-skills')}/SKILL.md`, skill('agents-skills')],
    [`.agents/rules/${marker('agents-rules')}.md`, `${marker('agents-rules')}\n`],
    [`.agents/workflows/${marker('agents-workflows')}.md`, `${marker('agents-workflows')}\n`],
    [`.agent/skills/${marker('agent-skills')}/SKILL.md`, skill('agent-skills')],
    [`.agent/rules/${marker('agent-rules')}.md`, `${marker('agent-rules')}\n`],
    [`.agent/workflows/${marker('agent-workflows')}.md`, `${marker('agent-workflows')}\n`],
    ['GEMINI.md', `${marker('context-gemini-md')}\n`],
    ['AGENTS.md', `${marker('context-agents-md')}\n`]
  ];
  for (const [relative, content] of files) {
    const target = path.join(directory, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content.endsWith('\n') ? content : `${content}\n`);
  }
}

export function admissionRefusedForPlantedConfiguration(rejection: unknown, workspace: string, plantedAncestor: string): boolean {
  if (!(rejection instanceof WorkspacePathError)) return false;
  return rejection.message.includes(`Workspace ${path.resolve(workspace)} contains project Antigravity configuration in ancestor directory ${path.resolve(plantedAncestor)} at `);
}

async function createGitRoot(directory: string): Promise<void> {
  await mkdir(path.join(directory, '.git', 'objects'), { recursive: true });
  await mkdir(path.join(directory, '.git', 'refs', 'heads'), { recursive: true });
  await writeFile(path.join(directory, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await writeFile(path.join(directory, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n\tbare = false\n');
}

async function plantedMarkersFromFiles(markerDir: string): Promise<string[]> {
  try {
    const entries = await readdir(markerDir);
    return entries.flatMap((entry) => plantedMarkersIn(entry)).sort();
  } catch {
    return [];
  }
}

const READBACK_COMMANDS = ['/config', '/hooks', '/permissions', '/skills', '/agents'] as const;

function readbackDeviation(command: string, parsed: Record<string, unknown> | null): string | null {
  if (command !== '/config' || !parsed) return null;
  const data = asRecord(asRecord(parsed.command)?.data);
  const config = asRecord(data?.config);
  if (!config) return null;
  return config.toolPermission === 'strict' && config.allowNonWorkspaceAccess === false ? null : 'config-readback-deviated';
}

export function notRunProbeReport(): AgyProbeReport {
  return {
    scripted_model: { endpoint_variables: [...SCRIPTED_MODEL_ENDPOINT_VARIABLES], requests: 0, paths: [], declared_tools: [] },
    hook_invoked_and_deny_honoured: { result: 'not_run', control: null, deny_all: null },
    hook_failure_denies: { result: 'not_run', timeout: null, nonzero_exit: null, unparseable_output: null },
    stream_tool_shape: { result: 'not_run', executed: null, denied: null },
    proxy_honoured: { result: 'not_run', attempts: 0, hosts: [], inference_hosts: [] },
    project_config_not_loaded: { result: 'not_run', loaded: [], readbacks_ok: false, run: null }
  };
}

export function probeReportPassed(report: AgyProbeReport): boolean {
  return [
    report.hook_invoked_and_deny_honoured.result,
    report.hook_failure_denies.result,
    report.stream_tool_shape.result,
    report.proxy_honoured.result,
    report.project_config_not_loaded.result
  ].every((result) => result === 'pass');
}

export async function runAgyProbes(options: {
  executablePath: string;
  root: string;
  proxy: ProbeProxy;
  readback: SlashReadback;
}): Promise<{ report: AgyProbeReport; findings: ProbeFinding[] }> {
  const findings: ProbeFinding[] = [];
  const root = path.join(options.root, 'agy-probes');
  await createPrivateDir(root);
  const hookScript = path.join(root, 'probe-hook.mjs');
  await writeFile(hookScript, PROBE_HOOK_SCRIPT, { mode: 0o700 });
  const model = await startScriptedModelServer();
  const context: ProbeContext = { executablePath: options.executablePath, root, proxy: options.proxy, model, hookScript };
  const report = notRunProbeReport();

  try {
    const control = await runToolProbe(context, 'control', path.join(root, 'ws-control'), { kind: 'policy' });
    const denyAll = await runToolProbe(context, 'deny_all', path.join(root, 'ws-deny_all'), { kind: 'variant', variant: 'deny_all' });
    const invocationFindings = evaluateHookInvocation(control.evidence, denyAll.evidence);
    findings.push(...invocationFindings);
    report.hook_invoked_and_deny_honoured = {
      result: invocationFindings.length === 0 ? 'pass' : 'fail',
      control: control.evidence,
      deny_all: denyAll.evidence
    };

    const failureEvidence = {} as Record<HookFailureVariant, ToolProbeEvidence>;
    for (const variant of HOOK_FAILURE_VARIANTS) {
      failureEvidence[variant] = (await runToolProbe(context, variant, path.join(root, `ws-${variant}`), { kind: 'variant', variant })).evidence;
    }
    const failureFindings = evaluateHookFailureModes(failureEvidence);
    if (control.evidence.outcome !== 'executed') {
      failureFindings.push({ level: 'fail', code: 'hook_failure_control_missing', message: 'Hook failure probes cannot be attributed without an executed control probe.' });
    }
    findings.push(...failureFindings);
    report.hook_failure_denies = { result: failureFindings.length === 0 ? 'pass' : 'fail', ...failureEvidence };

    const executedShape = streamToolShape(control.stdout, control.probeTool);
    const deniedShape = streamToolShape(denyAll.stdout, denyAll.probeTool ?? control.probeTool);
    const shapeFindings = evaluateStreamShape(executedShape, deniedShape);
    if (control.evidence.outcome !== 'executed' || denyAll.evidence.outcome !== 'denied') {
      shapeFindings.push({ level: 'fail', code: 'stream_shape_unattributed', message: 'The stream tool-event shape needs one executed and one denied probe through agy.' });
    }
    findings.push(...shapeFindings);
    report.stream_tool_shape = { result: shapeFindings.length === 0 ? 'pass' : 'fail', executed: executedShape, denied: deniedShape };

    const egressHome = path.join(root, 'home-egress');
    const egressTmp = path.join(root, 'tmp-egress');
    const egressWorkspace = path.join(root, 'ws-egress');
    await createPrivateDir(egressHome);
    await createPrivateDir(egressTmp);
    await mkdir(egressWorkspace, { recursive: true });
    const neutralizerBin = await setupHeadlessBrowserNeutralizer(path.join(egressHome, '.bin'));
    await writeIsolatedSettings(egressHome, 'review', egressWorkspace, [], { modelProvider: 'gemini' });
    await writeAntigravityPreToolHook(egressHome, { mode: 'review', workerWorkspace: egressWorkspace, excludedAnchors: [] });
    options.proxy.setRun('egress-probe');
    const egressOutput = await runAgy(options.executablePath, egressWorkspace, probeEnvironment(egressHome, egressTmp, options.proxy.port, null, neutralizerBin));
    const egressAttempts = options.proxy.attemptsFor('egress-probe');
    const proxyEvaluation = evaluateProxyProbe(egressAttempts.map((attempt) => attempt.host));
    if (egressOutput.timedOut) {
      findings.push({ level: 'info', code: 'egress_probe_timed_out', message: 'The egress probe run was stopped at its deadline.' });
    }
    findings.push(...proxyEvaluation.findings);
    report.proxy_honoured = {
      result: proxyEvaluation.findings.length === 0 ? 'pass' : 'fail',
      attempts: egressAttempts.length,
      hosts: [...new Set(egressAttempts.map((attempt) => attempt.host))].slice(0, MAX_LISTED),
      inference_hosts: proxyEvaluation.inferenceHosts.slice(0, MAX_LISTED)
    };

    const projectRoot = path.join(root, 'planted-project');
    const parentDir = path.join(projectRoot, 'packages');
    const markerDir = path.join(root, 'planted-markers');
    await mkdir(markerDir, { recursive: true });
    await createGitRoot(projectRoot);
    await plantProjectConfig(projectRoot, 'git-root', hookScript, markerDir);
    await plantProjectConfig(parentDir, 'parent', hookScript, markerDir);
    const unisolated = path.join(parentDir, 'unisolated');
    await mkdir(unisolated, { recursive: true });
    const admissionRejection = await assertNoProjectAntigravityExtensions(unisolated).then(() => null, (error: unknown) => error);
    const admissionRefused = admissionRefusedForPlantedConfiguration(admissionRejection, unisolated, parentDir);
    if (!admissionRefused) {
      findings.push({
        level: 'fail',
        code: 'project_config_admission_not_refused',
        message: admissionRejection === null
          ? 'Admission accepted a workspace beneath planted ancestor Antigravity configuration.'
          : 'Admission rejected the workspace beneath planted ancestor configuration for a reason other than the planted configuration.'
      });
    }
    const plantedWorkspace = path.join(parentDir, 'app');
    await createGitRoot(plantedWorkspace);
    const plantedRun = await runToolProbe(context, 'planted', plantedWorkspace, { kind: 'policy' });
    const loaded = new Set<string>();
    for (const request of model.requests.filter((item) => item.run === 'probe-planted')) {
      for (const marker of request.planted_markers) loaded.add(marker);
    }
    for (const marker of await plantedMarkersFromFiles(markerDir)) loaded.add(marker);
    const plantedHome = path.join(root, 'home-planted-readback');
    const plantedTmp = path.join(root, 'tmp-planted-readback');
    await createPrivateDir(plantedHome);
    await createPrivateDir(plantedTmp);
    await writeIsolatedSettings(plantedHome, 'review', plantedWorkspace, [], { modelProvider: 'gemini' });
    await writeAntigravityPreToolHook(plantedHome, { mode: 'review', workerWorkspace: plantedWorkspace, excludedAnchors: [] });
    options.proxy.setRun('probe-planted-readback');
    model.beginRun('probe-planted-readback', randomBytes(16).toString('hex'), '');
    let readbacksOk = true;
    for (const command of READBACK_COMMANDS) {
      const readback = await options.readback(command, plantedWorkspace, plantedHome, plantedTmp);
      if (readback.code !== 0 || !readback.parsed) {
        readbacksOk = false;
        continue;
      }
      for (const marker of plantedMarkersIn(JSON.stringify(readback.parsed))) loaded.add(marker);
      const deviation = readbackDeviation(command, readback.parsed);
      if (deviation) loaded.add(deviation);
    }
    for (const request of model.requests.filter((item) => item.run === 'probe-planted-readback')) {
      for (const marker of request.planted_markers) loaded.add(marker);
    }
    const loadedList = [...loaded].sort().slice(0, MAX_LISTED);
    const configFindings = evaluateProjectConfig(loadedList, readbacksOk, plantedRun.evidence);
    findings.push(...configFindings);
    report.project_config_not_loaded = {
      result: configFindings.length === 0 && admissionRefused ? 'pass' : 'fail',
      loaded: loadedList,
      readbacks_ok: readbacksOk,
      run: plantedRun.evidence
    };
  } finally {
    report.scripted_model = {
      endpoint_variables: [...SCRIPTED_MODEL_ENDPOINT_VARIABLES],
      requests: model.requests.length,
      paths: [...new Set(model.requests.map((request) => request.path))].slice(0, MAX_LISTED),
      declared_tools: [...new Set(model.requests.flatMap((request) => request.declared_tools))].slice(0, MAX_LISTED)
    };
    await model.close().catch(() => undefined);
  }

  return { report, findings };
}
