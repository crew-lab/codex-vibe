import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { RuntimeReadResult, SessionStartResult } from './protocol.js';

export interface SettingExpectation {
  path: readonly string[];
  value: unknown;
  match: 'equal' | 'includes';
}

export interface ToolPolicyExpectation {
  permission: string;
  denylist: readonly string[];
}

export interface ReadbackExpectation {
  harness: string;
  cwd: string;
  tools: readonly string[];
  disabledTools: readonly string[];
  toolPolicies: Readonly<Record<string, ToolPolicyExpectation>>;
  settings: readonly SettingExpectation[];
}

export interface ReadbackObservation {
  sessionStart: SessionStartResult;
  runtime: RuntimeReadResult;
  effective: { config: Record<string, unknown> };
}

export interface ReadbackOptions {
  checkThinking: boolean;
}

export interface ReadbackMismatch {
  path: string;
  expected: unknown;
  actual: unknown;
}

export const THINKING_OFF = 'off';
const MAX_FORMATTED_MISMATCHES = 20;
const MAX_FORMATTED_VALUE_CHARS = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describePath(segments: readonly string[]): string {
  return segments.map((segment, index) => (/^[A-Za-z0-9_]+$/.test(segment) ? (index === 0 ? segment : `.${segment}`) : `[${JSON.stringify(segment)}]`)).join('');
}

function valueAt(root: unknown, segments: readonly string[]): unknown {
  let cursor: unknown = root;
  for (const segment of segments) {
    if (!isRecord(cursor) || !Object.hasOwn(cursor, segment)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function sameStringSet(actual: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(actual) || !actual.every((item) => typeof item === 'string')) return false;
  const unique = new Set(actual as string[]);
  return unique.size === actual.length && unique.size === expected.length && expected.every((item) => unique.has(item));
}

function includesAll(actual: unknown, expected: unknown): boolean {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  return expected.every((item) => actual.some((candidate) => isDeepStrictEqual(candidate, item)));
}

export function compareReadback(expected: ReadbackExpectation, observed: ReadbackObservation, options: ReadbackOptions): ReadbackMismatch[] {
  const mismatches: ReadbackMismatch[] = [];
  const expect = (field: string, want: unknown, actual: unknown, ok: boolean): void => {
    if (!ok) mismatches.push({ path: field, expected: want, actual });
  };
  const equal = (field: string, want: unknown, actual: unknown): void => expect(field, want, actual, isDeepStrictEqual(actual, want));

  const { session } = observed.sessionStart.state;
  equal('session.harness', expected.harness, session.harness);
  expect('session.cwd', expected.cwd, session.cwd, session.cwd !== null && path.resolve(session.cwd) === path.resolve(expected.cwd));

  const { runtime } = observed.runtime;
  const toolNames = runtime.tools.map((tool) => tool.name);
  expect('runtime.tools', [...expected.tools], toolNames, sameStringSet(toolNames, expected.tools));
  equal('runtime.skills', [], runtime.skills);
  equal('runtime.hooksCount', 0, runtime.hooksCount);
  equal('runtime.issues', [], runtime.issues);
  equal('runtime.bypassToolPermissions', false, runtime.bypassToolPermissions);

  const mcpSources = isRecord(runtime.mcp) ? runtime.mcp.sources : undefined;
  equal('runtime.mcp.sources', [], mcpSources);

  const connectors = isRecord(runtime.connectors) ? runtime.connectors : undefined;
  equal('runtime.connectors.connected', 0, connectors?.connected);
  const total = connectors?.total;
  expect('runtime.connectors.total', 0, total, total === undefined || total === null || total === 0);

  const { config } = observed.effective;
  expect('config.enabled_tools', [...expected.tools], config.enabled_tools, sameStringSet(config.enabled_tools, expected.tools));
  expect('config.disabled_tools', [...expected.disabledTools], config.disabled_tools, includesAll(config.disabled_tools, expected.disabledTools));

  for (const setting of expected.settings) {
    const actual = valueAt(config, setting.path);
    const field = `config.${describePath(setting.path)}`;
    if (setting.match === 'includes') expect(field, setting.value, actual, includesAll(actual, setting.value));
    else equal(field, setting.value, actual);
  }

  for (const [tool, policy] of Object.entries(expected.toolPolicies)) {
    const entry = valueAt(config, ['tools', tool]);
    const prefix = `config.${describePath(['tools', tool])}`;
    equal(`${prefix}.permission`, policy.permission, isRecord(entry) ? entry.permission : undefined);
    equal(`${prefix}.denylist`, [...policy.denylist], isRecord(entry) ? entry.denylist : undefined);
  }

  if (options.checkThinking) {
    const active = runtime.activeModel;
    equal('runtime.config.activeModel.thinking', THINKING_OFF, active?.thinking ?? undefined);
    const alias = active?.alias ?? null;
    if (alias === null) mismatches.push({ path: 'runtime.config.activeModel.alias', expected: 'a model alias', actual: undefined });
    else equal(`config.${describePath(['models', alias, 'thinking'])}`, THINKING_OFF, valueAt(config, ['models', alias, 'thinking']));
  }

  return mismatches;
}

function formatValue(value: unknown): string {
  if (value === undefined) return 'missing';
  const text = JSON.stringify(value) ?? String(value);
  return text.length > MAX_FORMATTED_VALUE_CHARS ? `${text.slice(0, MAX_FORMATTED_VALUE_CHARS)}...` : text;
}

export function formatReadbackMismatches(mismatches: readonly ReadbackMismatch[]): string {
  const shown = mismatches.slice(0, MAX_FORMATTED_MISMATCHES).map((item) => `${item.path}: expected ${formatValue(item.expected)}, got ${formatValue(item.actual)}`);
  const hidden = mismatches.length - shown.length;
  return `${shown.join('; ')}${hidden > 0 ? `; and ${hidden} more` : ''}`;
}
