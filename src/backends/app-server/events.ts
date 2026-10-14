import { supervisorError } from '../../contracts.js';
import { object, string, array, type JsonObject } from './protocol.js';

const TYPES = new Set(['message', 'reasoning', 'effect', 'callback', 'checkpoint', 'notice']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** Public protocol patches support string append, not arbitrary JavaScript evaluation. */
export function applyPatch(input: JsonObject, operations: unknown): JsonObject {
  let document: unknown = structuredClone(input);
  for (const raw of array(operations, 'history patch')) {
    const patch = object(raw, 'patch operation');
    if (!['add', 'replace', 'remove', 'test', 'append'].includes(patch.op as string) || typeof patch.path !== 'string') throw supervisorError('VSUP_BACKEND_ERROR', 'Unsupported history patch.');
    if (patch.path === '') {
      if (patch.op === 'test') { if (JSON.stringify(document) !== JSON.stringify(patch.value)) throw supervisorError('VSUP_BACKEND_ERROR', 'History patch test failed.'); }
      else if (patch.op === 'add' || patch.op === 'replace') document = structuredClone(patch.value);
      else throw supervisorError('VSUP_BACKEND_ERROR', 'Invalid history root patch.');
      continue;
    }
    if (!patch.path.startsWith('/') || /~(?![01])/.test(patch.path)) throw supervisorError('VSUP_BACKEND_ERROR', 'Invalid history pointer.');
    const parts = patch.path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (parts.some(part => FORBIDDEN_KEYS.has(part))) throw supervisorError('VSUP_BACKEND_ERROR', 'Unsafe history pointer.');
    let parent = document;
    for (const part of parts.slice(0, -1)) {
      if (Array.isArray(parent)) {
        if (!/^(0|[1-9]\d*)$/.test(part) || Number(part) >= parent.length) throw supervisorError('VSUP_BACKEND_ERROR', 'Invalid history array pointer.');
        parent = parent[Number(part)];
      } else {
        const current = object(parent, 'patch target');
        if (!Object.hasOwn(current, part)) throw supervisorError('VSUP_BACKEND_ERROR', 'Missing history pointer target.');
        parent = current[part];
      }
    }
    const key = parts.at(-1) as string;
    if (Array.isArray(parent)) {
      const index = key === '-' && patch.op === 'add' ? parent.length : /^(0|[1-9]\d*)$/.test(key) ? Number(key) : -1;
      if (index < 0 || index > parent.length || (patch.op !== 'add' && index === parent.length)) throw supervisorError('VSUP_BACKEND_ERROR', 'Invalid history array index.');
      if (patch.op === 'add') parent.splice(index, 0, structuredClone(patch.value));
      else if (patch.op === 'remove') parent.splice(index, 1);
      else if (patch.op === 'replace') parent[index] = structuredClone(patch.value);
      else if (patch.op === 'append') {
        if (typeof parent[index] !== 'string' || typeof patch.value !== 'string') throw supervisorError('VSUP_BACKEND_ERROR', 'Append requires string values.');
        parent[index] += patch.value;
      } else if (JSON.stringify(parent[index]) !== JSON.stringify(patch.value)) throw supervisorError('VSUP_BACKEND_ERROR', 'History patch test failed.');
    } else {
      const target = object(parent, 'patch target');
      if (patch.op !== 'add' && !Object.hasOwn(target, key)) throw supervisorError('VSUP_BACKEND_ERROR', 'Missing history patch target.');
      if (patch.op === 'remove') delete target[key];
      else if (patch.op === 'test') { if (JSON.stringify(target[key]) !== JSON.stringify(patch.value)) throw supervisorError('VSUP_BACKEND_ERROR', 'History patch test failed.'); }
      else if (patch.op === 'append') {
        if (typeof target[key] !== 'string' || typeof patch.value !== 'string') throw supervisorError('VSUP_BACKEND_ERROR', 'Append requires string values.');
        target[key] += patch.value;
      } else target[key] = structuredClone(patch.value);
    }
  }
  return object(document, 'patched entry');
}

/** In-memory projection. Reasoning content is never retained in this projection. */
export class HistoryProjection {
  private readonly entries = new Map<string, JsonObject>();
  private readonly reasoning = new Set<string>();
  private bytes = 0;
  constructor(private readonly sessionId: string, private readonly maxBytes: number) {}

  add(value: unknown): JsonObject | undefined {
    const entry = object(value, 'history entry');
    const id = string(entry.id, 'history id');
    if (entry.sessionId !== this.sessionId || typeof entry.type !== 'string' || !TYPES.has(entry.type)) throw supervisorError('VSUP_BACKEND_ERROR', 'Unknown or foreign history entry.');
    if (entry.generationStatus !== 'in_progress' && entry.generationStatus !== 'completed') throw supervisorError('VSUP_BACKEND_ERROR', 'Invalid history generation state.');
    if (entry.type === 'reasoning') {
      if (this.entries.has(id)) throw supervisorError('VSUP_BACKEND_ERROR', 'History entry type changed.');
      this.reasoning.add(id);
      this.boundCount();
      return undefined;
    }
    if (this.reasoning.has(id)) throw supervisorError('VSUP_BACKEND_ERROR', 'Reasoning entry changed type.');
    const previous = this.entries.get(id);
    if (previous && previous.type !== entry.type) throw supervisorError('VSUP_BACKEND_ERROR', 'History entry type changed.');
    const copy = structuredClone(entry);
    const next = this.bytes - (previous ? Buffer.byteLength(JSON.stringify(previous)) : 0) + Buffer.byteLength(JSON.stringify(copy));
    if (next > this.maxBytes) throw supervisorError('VSUP_OUTPUT_LIMIT', 'History projection byte limit exceeded.');
    this.entries.set(id, copy); this.bytes = next;
    this.boundCount();
    return copy;
  }

  update(id: string, patch: unknown): JsonObject | undefined {
    if (this.reasoning.has(id)) {
      for (const raw of array(patch, 'reasoning patch')) {
        const op = object(raw);
        if (typeof op.path !== 'string' || !/^\/(?:text|summary|updatedAt|generationStatus)(?:\/|$)/.test(op.path) || !['add', 'replace', 'append', 'remove', 'test'].includes(op.op as string)) throw supervisorError('VSUP_BACKEND_ERROR', 'Reasoning patch attempted an identity or type change.');
      }
      return undefined;
    }
    const before = this.entries.get(id);
    if (!before) throw supervisorError('VSUP_BACKEND_ERROR', 'History update refers to an unknown entry.');
    const after = applyPatch(before, patch);
    if (after.id !== id || after.sessionId !== before.sessionId || after.turnId !== before.turnId || after.type !== before.type) throw supervisorError('VSUP_BACKEND_ERROR', 'History patch changed entry identity.');
    return this.add(after);
  }

  values(): JsonObject[] { return [...this.entries.values()].map(entry => structuredClone(entry)); }

  finalMessage(turnId: string, maxBytes: number): string | undefined {
    let result: string | undefined;
    for (const entry of this.entries.values()) {
      if (entry.type !== 'message' || entry.role !== 'assistant' || entry.turnId !== turnId || entry.generationStatus !== 'completed') continue;
      const parts = array(entry.content, 'message content').filter(item => object(item).type === 'text').map(item => {
        const text = object(item).text;
        if (typeof text !== 'string') throw supervisorError('VSUP_BACKEND_ERROR', 'Invalid assistant text.');
        return text;
      });
      const text = parts.join('\n\n');
      if (Buffer.byteLength(text) > maxBytes) throw supervisorError('VSUP_OUTPUT_LIMIT', 'Final assistant message exceeds the transcript budget.');
      result = text || undefined;
    }
    return result;
  }

  private boundCount(): void {
    if (this.entries.size + this.reasoning.size > 4096) throw supervisorError('VSUP_OUTPUT_LIMIT', 'History entry count limit exceeded.');
  }
}

export class EventWatermark {
  constructor(private current: number) {
    if (!Number.isSafeInteger(current) || current < 0) throw supervisorError('VSUP_BACKEND_ERROR', 'Invalid initial event watermark.');
  }
  inspect(value: unknown): 'replay' | 'next' | 'gap' {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw supervisorError('VSUP_BACKEND_ERROR', 'Invalid event identifier.');
    if (value <= this.current) return 'replay';
    return value === this.current + 1 ? 'next' : 'gap';
  }
  adopt(value: unknown): void {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < this.current) throw supervisorError('VSUP_BACKEND_ERROR', 'Invalid reconciled event watermark.');
    this.current = value;
  }
}
