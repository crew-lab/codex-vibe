#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const rawArgs = process.argv.slice(2);
const modeArg = rawArgs.find((arg) => arg.startsWith('--fake-mode='));
const modes = new Set((modeArg ? modeArg.slice('--fake-mode='.length) : '').split(',').filter(Boolean));
const args = rawArgs.filter((arg) => arg !== modeArg);

if (args[0] === '--version') {
  if (modes.has('version-1.4.8')) {
    process.stdout.write('1.4.8\n');
  } else if (modes.has('version-1.4.7')) {
    process.stdout.write('1.4.7\n');
  } else if (modes.has('version-1.4.4')) {
    process.stdout.write('1.4.4\n');
  } else {
    process.stdout.write('1.4.0\n');
  }
  process.exit(0);
}

const prompt = args[args.indexOf('-p') + 1] ?? '';
const home = process.env.HOME ?? '';

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function plantedText(start) {
  const pieces = [];
  let dir = path.dirname(start);
  for (let depth = 0; depth < 4; depth += 1) {
    for (const sub of ['.agents/rules', '.agent/rules']) {
      const full = path.join(dir, sub);
      if (!fs.existsSync(full)) continue;
      for (const name of fs.readdirSync(full)) pieces.push(fs.readFileSync(path.join(full, name), 'utf8'));
    }
    dir = path.dirname(dir);
  }
  return pieces.join('\n');
}

const slash = ['/config', '/hooks', '/permissions', '/skills', '/agents'];
if (slash.includes(prompt)) {
  const settings = readJson(path.join(home, '.gemini', 'antigravity-cli', 'settings.json'), {});
  const hooks = readJson(path.join(home, '.gemini', 'config', 'hooks.json'), {});
  const out = (name, data) => process.stdout.write(JSON.stringify({ status: 'SUCCESS', command: { name, data } }) + '\n');
  if (prompt === '/config') out('config', { config: settings });
  if (prompt === '/hooks') out('hooks', { hooks: Object.keys(hooks).map((name) => ({ name, enabled: true, events: [{ event: 'PreToolUse', matcher: '*', count: 1 }] })) });
  if (prompt === '/permissions') out('permissions', { permissions: [{ scope: 'global', allow: settings.permissions?.allow ?? [], deny: settings.permissions?.deny ?? [] }] });
  if (prompt === '/skills') {
    const planted = modes.has('load-project-config') ? (plantedText(process.cwd()).match(/vsup-planted-[a-z0-9-]+/g) ?? []) : [];
    const skills = modes.has('builtin-skill')
      ? [{ name: 'unknown-built-in', builtin: true }]
      : modes.has('allowed-builtin-skills')
        ? [{ name: 'agy-customizations', builtin: true }, { name: 'automation', builtin: true }]
        : planted.map((name) => ({ name }));
    out('skills', { skills });
  }
  if (prompt === '/agents') out('agents', { agents: [] });
  process.exit(0);
}

function emit(value) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

function post(base, body) {
  return new Promise((resolve, reject) => {
    const url = new URL('/v1beta/models/gemini-probe:streamGenerateContent?alt=sse', base);
    const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const data = text.split(/\r?\n/).filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
        resolve(data[0] ?? {});
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

function connectThroughProxy() {
  return new Promise((resolve) => {
    const proxy = new URL(process.env.HTTPS_PROXY ?? 'http://127.0.0.1:9');
    const socket = net.connect(Number(proxy.port), proxy.hostname, () => {
      socket.write('CONNECT generativelanguage.googleapis.com:443 HTTP/1.1\r\nHost: generativelanguage.googleapis.com:443\r\n\r\n');
    });
    socket.on('data', () => { socket.destroy(); resolve(); });
    socket.on('error', () => resolve());
    socket.on('close', () => resolve());
  });
}

function hookAllows(call) {
  if (modes.has('ignore-hooks')) return true;
  const config = readJson(path.join(home, '.gemini', modes.has('cli-hooks') ? 'antigravity-cli' : 'config', 'hooks.json'), {});
  let allowed = true;
  for (const entry of Object.values(config)) {
    if (!entry || entry.enabled === false) continue;
    for (const matcher of entry.PreToolUse ?? []) {
      for (const hook of matcher.hooks ?? []) {
        const result = spawnSync(hook.command, {
          shell: true,
          input: JSON.stringify({ toolCall: { name: call.name, args: call.args, id: 'fake-call-1' }, stepIdx: 1, conversationId: 'fake' }),
          timeout: (hook.timeout ?? 60) * 1000,
          encoding: 'utf8'
        });
        let decision = null;
        try { decision = JSON.parse(result.stdout.trim().split('\n').pop()).decision; } catch { decision = null; }
        const failed = Boolean(result.error) || result.status !== 0 || decision === null;
        if (modes.has('hook-failure-allows')) {
          if (decision === 'deny') allowed = false;
        } else if (failed || decision !== 'allow') {
          allowed = false;
        }
      }
    }
  }
  return allowed;
}

const base = modes.has('ignore-endpoint') ? undefined : process.env.GOOGLE_GEMINI_BASE_URL;
if (!base) {
  if (!modes.has('bypass-proxy')) await connectThroughProxy();
  emit({ event: 'result', result: { status: 'ERROR', error: 'provider unreachable' } });
  process.exit(1);
}

const systemText = modes.has('load-project-config') ? plantedText(process.cwd()) : '';
const declarations = [
  { name: 'view_file', parameters: { type: 'object', properties: { AbsolutePath: { type: 'string' } } } },
  { name: 'read_file', parameters: { type: 'object', properties: { Path: { type: 'string' } } } },
  { name: 'list_dir', parameters: { type: 'object', properties: { DirectoryPath: { type: 'string' } } } }
];
const contents = [{ role: 'user', parts: [{ text: prompt }] }];
const first = await post(base, { systemInstruction: { parts: [{ text: systemText }] }, contents, tools: [{ functionDeclarations: modes.has('json-schema-read') ? [{ name: 'read_file', parameters: {}, parametersJsonSchema: { type: 'object', properties: { Path: { type: 'string' } }, required: ['Path'] } }] : declarations }] });
emit({ event: 'step_update', step_update: { step_index: 0, step_type: 'planner_response', state: 'DONE' } });
const call = first.candidates?.[0]?.content?.parts?.find((part) => part.functionCall)?.functionCall;
if (call) {
  const allowed = hookAllows(call);
  let response;
  if (allowed) {
    response = { output: fs.readFileSync(call.args.AbsolutePath ?? call.args.Path ?? call.args.path, 'utf8') };
    if (modes.has('unparsed-shape')) emit({ event: 'tool_activity', activity: { name: call.name, phase: 'finished' } });
    else emit({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool_call', tool_name: call.name, state: 'DONE', args: call.args } });
  } else {
    response = { error: 'denied by PreToolUse hook' };
    if (modes.has('denied-looks-executed')) emit({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool_call', tool_name: call.name, args: call.args } });
    else emit({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool_call', tool_name: call.name, state: 'DENIED', args: call.args } });
  }
  contents.push({ role: 'model', parts: [{ functionCall: call }] });
  contents.push({ role: 'user', parts: [{ functionResponse: { name: call.name, response } }] });
  await post(base, { systemInstruction: { parts: [{ text: systemText }] }, contents, tools: [{ functionDeclarations: modes.has('json-schema-read') ? [{ name: 'read_file', parameters: {}, parametersJsonSchema: { type: 'object', properties: { Path: { type: 'string' } }, required: ['Path'] } }] : declarations }] });
}
emit({ event: 'result', result: { status: 'SUCCESS', response: 'done', num_turns: 2 } });
process.exit(0);
