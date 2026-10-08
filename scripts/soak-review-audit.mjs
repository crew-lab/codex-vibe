import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

async function directory(target) {
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || info.mode & 0o077 || await realpath(target) !== target) throw new Error('Unsafe audit directory');
}
async function records(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || info.mode & 0o077 || info.nlink !== 1 || info.size > 8 * 1024 * 1024) throw new Error('Unsafe audit record');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const current = await handle.stat();
    if (current.ino !== info.ino || current.dev !== info.dev || current.size !== info.size) throw new Error('Changed audit record');
    const buffer = Buffer.alloc(info.size + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== info.size) throw new Error('Changed audit size');
    return buffer.subarray(0, bytesRead).toString('utf8').trim().split('\n').map((line) => JSON.parse(line));
  } finally { await handle.close(); }
}
export async function auditReview(home, runId, bounds) {
  if (!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(runId)) throw new Error('Invalid run');
  let target = home;
  await directory(target);
  for (const part of ['runs', runId, 'vibe-home', 'sessions']) { target = path.join(target, part); await directory(target); }
  const entries = (await readdir(target)).filter((entry) => entry !== 'active');
  if (entries.length !== 1 || !/^session_[A-Za-z0-9_-]+$/.test(entries[0])) throw new Error('Ambiguous session');
  target = path.join(target, entries[0]); await directory(target);
  const messages = await records(path.join(target, 'messages.jsonl'));
  const counts = { read_file: 0, grep: 0, unexpected: 0 };
  let finalAnswer = false;
  for (const message of messages) {
    if (!message || !['user', 'assistant', 'tool', 'system'].includes(message.role)) throw new Error('Invalid message');
    if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) throw new Error('Invalid calls');
    if (message.role === 'user') finalAnswer = false;
    if (message.role !== 'assistant') continue;
    if (message.tool_calls?.length) {
      finalAnswer = false;
      for (const call of message.tool_calls) {
        const name = call.function?.name;
        if (typeof name !== 'string') throw new Error('Invalid tool');
        if (name === 'read_file' || name === 'grep') counts[name] += 1;
        else counts.unexpected += 1;
      }
    } else if (typeof message.content === 'string' && message.content.trim() && !message.content.includes('<vibe_stop_event>')) finalAnswer = true;
  }
  const violations = [];
  if (counts.read_file > bounds.reads || counts.grep > bounds.searches || counts.unexpected) violations.push('task_bounds');
  if (bounds.requireFinal && !finalAnswer) violations.push('final_answer_missing');
  return { status: 'validated', counts, final_answer: finalAnswer, violations };
}
