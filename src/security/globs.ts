import path from 'node:path';
import { isPathWithinRoot } from './paths.js';

const GLOBSTAR = '**';

export interface RootedGlobs {
  root: string;
  globs: readonly string[];
}

type SegmentMatcher = (loweredSegment: string) => boolean;
type CompiledPart = SegmentMatcher | typeof GLOBSTAR;

export interface ExclusionAnchor {
  prefix: readonly string[];
  globs: readonly string[];
}

export type ExclusionSpec = string | ExclusionAnchor;

export interface DenylistAnchor {
  base: string;
  prefix: readonly string[];
  globs: readonly string[];
}

export function compileSegment(pattern: string): SegmentMatcher {
  const pieces = pattern.toLowerCase().split('*');
  const first = pieces[0] ?? '';
  if (pieces.length === 1) return (segment) => segment === first;
  const last = pieces[pieces.length - 1] ?? '';
  const middle = pieces.slice(1, -1).filter((piece) => piece !== '');
  const minimum = first.length + last.length + middle.reduce((total, piece) => total + piece.length, 0);
  return (segment) => {
    if (segment.length < minimum || !segment.startsWith(first) || !segment.endsWith(last)) return false;
    const end = segment.length - last.length;
    let position = first.length;
    for (const piece of middle) {
      const found = segment.indexOf(piece, position);
      if (found < 0 || found + piece.length > end) return false;
      position = found + piece.length;
    }
    return true;
  };
}

export function matchesSegmentPattern(pattern: string, segment: string): boolean {
  return compileSegment(pattern)(segment.toLowerCase());
}

interface CompiledGlob {
  parts: readonly CompiledPart[];
  anywhere: boolean;
}

function compileGlob(glob: string): CompiledGlob {
  const parts = glob.split('/');
  return { parts: parts.map((part) => (part === GLOBSTAR ? GLOBSTAR : compileSegment(part))), anywhere: parts.length === 1 };
}

function withEmptyGlobstars(parts: readonly CompiledPart[], states: Iterable<number>): Set<number> {
  const closed = new Set<number>();
  for (const start of states) {
    let index = start;
    closed.add(index);
    while (index < parts.length && parts[index] === GLOBSTAR) {
      index += 1;
      closed.add(index);
    }
  }
  return closed;
}

function step(parts: readonly CompiledPart[], states: Iterable<number>, segment: string): Set<number> {
  const next = new Set<number>();
  for (const index of withEmptyGlobstars(parts, states)) {
    if (index >= parts.length) continue;
    const part = parts[index] as CompiledPart;
    if (part === GLOBSTAR) next.add(index);
    else if (part(segment)) next.add(index + 1);
  }
  return next;
}

function advance(parts: readonly CompiledPart[], segments: readonly string[]): Set<number> {
  let states: Set<number> = new Set([0]);
  for (const segment of segments) {
    states = step(parts, states, segment);
    if (states.size === 0) break;
  }
  return states;
}

function matchesWhole(parts: readonly CompiledPart[], segments: readonly string[]): boolean {
  return withEmptyGlobstars(parts, advance(parts, segments)).has(parts.length);
}

function matchesGlob(glob: CompiledGlob, lowered: readonly string[]): boolean {
  if (glob.anywhere) return lowered.some((segment) => matchesWhole(glob.parts, [segment]));
  return matchesWhole(glob.parts, lowered);
}

function anchorsOf(specs: readonly ExclusionSpec[]): ExclusionAnchor[] {
  const plain = specs.filter((spec): spec is string => typeof spec === 'string');
  const anchored = specs.filter((spec): spec is ExclusionAnchor => typeof spec !== 'string');
  return plain.length === 0 ? anchored : [{ prefix: [], globs: plain }, ...anchored];
}

export type ExcludedMatcher = (segments: readonly string[]) => boolean;

export function createExcludedMatcher(specs: readonly ExclusionSpec[]): ExcludedMatcher {
  const compiled = anchorsOf(specs)
    .filter((anchor) => anchor.globs.length > 0)
    .map((anchor) => ({ prefix: anchor.prefix.map((segment) => segment.toLowerCase()), globs: anchor.globs.map(compileGlob) }));
  if (compiled.length === 0) return () => false;
  return (segments) => {
    const lowered = segments.map((segment) => segment.toLowerCase());
    return compiled.some((anchor) => {
      const full = anchor.prefix.length === 0 ? lowered : [...anchor.prefix, ...lowered];
      return anchor.globs.some((glob) => matchesGlob(glob, full));
    });
  };
}

export function relativeSegments(relative: string): string[] {
  return relative.split(/[\\/]+/).filter((segment) => segment !== '');
}

export function excludedRelativePath(relative: string, specs: readonly ExclusionSpec[]): boolean {
  return createExcludedMatcher(specs)(relativeSegments(relative));
}

export function workspaceAnchors(scopes: readonly RootedGlobs[], workspace: string): ExclusionAnchor[] {
  return scopes.map((scope) => {
    if (!isPathWithinRoot(scope.root, workspace)) throw new RangeError('The workspace lies outside the allowed root its exclusions are anchored at.');
    return { prefix: relativeSegments(path.relative(scope.root, workspace)), globs: scope.globs };
  });
}

export function denylistAnchors(scopes: readonly RootedGlobs[], source: string, worker: string): DenylistAnchor[] {
  return workspaceAnchors(scopes, source).map((anchor, index) => (path.resolve(worker) === path.resolve(source)
    ? { base: (scopes[index] as RootedGlobs).root, prefix: [], globs: anchor.globs }
    : { base: worker, prefix: anchor.prefix, globs: anchor.globs }));
}

export function anchoredDenylistPatterns(anchor: DenylistAnchor): string[] {
  const prefix = anchor.prefix.map((segment) => segment.toLowerCase());
  const patterns: string[] = [];
  for (const glob of anchor.globs) {
    const compiled = compileGlob(glob);
    const raw = glob.split('/');
    if (compiled.anywhere) {
      if (prefix.some((segment) => matchesWhole(compiled.parts, [segment]))) patterns.push(`${anchor.base}/${GLOBSTAR}`);
      else patterns.push(`${anchor.base}/${glob}`, `${anchor.base}/${GLOBSTAR}/${glob}`);
      continue;
    }
    const states = prefix.length === 0 ? [0] : [...advance(compiled.parts, prefix)].sort((a, b) => a - b);
    for (const index of states) if (index < raw.length) patterns.push(`${anchor.base}/${raw.slice(index).join('/')}`);
  }
  return [...new Set(patterns)];
}
