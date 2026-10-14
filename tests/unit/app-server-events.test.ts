import { describe, it, expect } from 'vitest';
import { applyPatch, HistoryProjection, EventWatermark } from '../../src/backends/app-server/events.js';

const message = { id: 'message', sessionId: 'session', turnId: 'turn', type: 'message', role: 'assistant', generationStatus: 'in_progress', content: [{ type: 'text', text: 'Hello' }] };
describe('public history projection and event ordering', () => {
  it('reduces append patches and returns the final completed assistant text', () => {
    const history = new HistoryProjection('session', 4096); history.add(message);
    history.update('message', [{ op: 'append', path: '/content/0/text', value: ' world' }, { op: 'replace', path: '/generationStatus', value: 'completed' }]);
    expect(history.finalMessage('turn', 1024)).toBe('Hello world');
  });
  it('drops reasoning bodies and refuses a patch that would hide an effect', () => {
    const history = new HistoryProjection('session', 4096);
    history.add({ ...message, type: 'reasoning', text: 'private-canary' });
    history.update('message', [{ op: 'append', path: '/text', value: 'more-private' }]);
    expect(JSON.stringify(history.values())).not.toContain('private');
    expect(() => history.update('message', [{ op: 'replace', path: '/type', value: 'effect' }])).toThrow();
  });
  it('rejects unknown types, foreign sessions, identity changes and unknown updates', () => {
    const history = new HistoryProjection('session', 4096);
    expect(() => history.add({ ...message, type: 'future_effect' })).toThrow();
    expect(() => history.add({ ...message, sessionId: 'other' })).toThrow();
    history.add(message);
    expect(() => history.update('message', [{ op: 'replace', path: '/turnId', value: 'other' }])).toThrow();
    expect(() => history.update('missing', [])).toThrow();
  });
  it('rejects prototype pointers and invalid array operations', () => {
    expect(() => applyPatch(message, [{ op: 'add', path: '/__proto__/polluted', value: true }])).toThrow();
    expect(() => applyPatch(message, [{ op: 'replace', path: '/content/3/text', value: 'invalid' }])).toThrow();
    expect(() => applyPatch(message, [{ op: 'copy', path: '/content', from: '/content' }])).toThrow();
    expect({}).not.toHaveProperty('polluted');
  });
  it('bounds projection bytes and final messages', () => {
    expect(() => new HistoryProjection('session', 20).add(message)).toThrow();
    const history = new HistoryProjection('session', 4096); history.add({ ...message, generationStatus: 'completed' });
    expect(() => history.finalMessage('turn', 2)).toThrow();
  });
  it('distinguishes a replay, next event and gap before adopting a snapshot', () => {
    const watermark = new EventWatermark(5);
    expect(watermark.inspect(4)).toBe('replay'); expect(watermark.inspect(6)).toBe('next'); expect(watermark.inspect(8)).toBe('gap');
    watermark.adopt(8); expect(watermark.inspect(8)).toBe('replay');
    expect(() => watermark.adopt(3)).toThrow(); expect(() => watermark.inspect(NaN)).toThrow();
  });
});
