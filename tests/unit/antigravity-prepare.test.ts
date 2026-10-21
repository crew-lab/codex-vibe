import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { runAntigravityPreparationCheck } from '../../src/preparation/antigravity-prepare.js';
import { WorkspacePathError } from '../../src/security/paths.js';
import {
  admissionRefusedForPlantedConfiguration,
  chooseProbeCall,
  classifyToolProbe,
  declaredFunctionNames,
  evaluateHookFailureModes,
  evaluateHookInvocation,
  evaluateProjectConfig,
  evaluateProxyProbe,
  evaluateStreamShape,
  isInferenceHost,
  plantedMarkersIn,
  scriptedGenerateResponse,
  startScriptedModelServer,
  streamToolShape,
  type ToolProbeEvidence
} from '../../src/preparation/antigravity-probes.js';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-agy.mjs');
const canonicalTmp = await realpath(tmpdir());
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(canonicalTmp, 'vsup-agy-prepare-test-'));
  roots.push(root);
  return root;
}

async function fakeAgy(root: string, mode: string): Promise<string> {
  const script = path.join(root, `agy-${mode || 'conforming'}`);
  await writeFile(script, `#!/bin/sh\nexec "${process.execPath}" "${fixture}" --fake-mode=${mode} "$@"\n`);
  await chmod(script, 0o755);
  return script;
}

async function prepareWith(mode: string) {
  const root = await makeRoot();
  const dataDir = path.join(root, 'data');
  await mkdir(dataDir, { recursive: true });
  const config = {
    ...DEFAULT_CONFIG,
    backend: 'antigravity' as const,
    allowedWorkspaceRoots: [root],
    paths: { antigravity: await fakeAgy(root, mode) }
  };
  return runAntigravityPreparationCheck(config, { dataDir });
}

function evidence(overrides: Partial<ToolProbeEvidence>): ToolProbeEvidence {
  return {
    outcome: 'denied',
    reason: 'probe_content_withheld',
    exit_code: 0,
    timed_out: false,
    model_requests: 2,
    function_call_issued: true,
    probe_tool: 'view_file',
    function_response_returned: true,
    nonce_returned: false,
    hook_invocations: 1,
    hook_payload_fields: [],
    ...overrides
  };
}

function postJson(url: string, body: unknown): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

describe('Antigravity preparation probe classification', () => {
  it('classifies Google Code Assist and other googleapis inference hosts, but not observed telemetry', () => {
    for (const host of [
      'generativelanguage.googleapis.com',
      'cloudcode-pa.googleapis.com',
      'daily-cloudcode-pa.sandbox.googleapis.com',
      'us-central1-aiplatform.googleapis.com',
      'unlisted-service.googleapis.com',
      'api.mistral.ai',
      'api.anthropic.com',
      'api.openai.com'
    ]) {
      expect(isInferenceHost(host), host).toBe(true);
    }
    for (const host of ['play.googleapis.com', 'antigravity-unleash.goog', 'antigravity-cli-auto-updater-1.us-central1.run.app', 'invalid-host', 'unparsed']) {
      expect(isInferenceHost(host), host).toBe(false);
    }
  });

  it('chooses the probe read from the declared functions, including the Code Assist request wrapper', () => {
    const gemini = { tools: [{ functionDeclarations: [{ name: 'list_dir' }, { name: 'view_file', parameters: { properties: { AbsolutePath: {} } } }] }] };
    expect(chooseProbeCall(gemini, '/w/p.txt')).toEqual({ name: 'view_file', args: { AbsolutePath: '/w/p.txt' } });
    const readFileCapitalPath = { tools: [{ functionDeclarations: [{ name: 'read_file', parameters: { properties: { Path: {} } } }] }] };
    expect(chooseProbeCall(readFileCapitalPath, '/w/p.txt')).toEqual({ name: 'read_file', args: { Path: '/w/p.txt' } });
    const wrapped = { model: 'm', request: { tools: [{ functionDeclarations: [{ name: 'read_file', parametersJsonSchema: { properties: { path: {} } } }] }] } };
    expect(chooseProbeCall(wrapped, '/w/p.txt')).toEqual({ name: 'read_file', args: { path: '/w/p.txt' } });
    expect(declaredFunctionNames(wrapped)).toEqual(['read_file']);
    expect(chooseProbeCall({ tools: [{ functionDeclarations: [{ name: 'run_command' }] }] }, '/w/p.txt')).toBeNull();
  });

  it('accepts only the WorkspacePathError that names the planted ancestor configuration', () => {
    const workspace = '/w/planted/packages/unisolated';
    const ancestor = '/w/planted/packages';
    const genuine = new WorkspacePathError(`Workspace ${workspace} contains project Antigravity configuration in ancestor directory ${ancestor} at .agents; this profile cannot prove it inactive.`);
    expect(admissionRefusedForPlantedConfiguration(genuine, workspace, ancestor)).toBe(true);
    expect(admissionRefusedForPlantedConfiguration(new Error('EACCES'), workspace, ancestor)).toBe(false);
    expect(admissionRefusedForPlantedConfiguration(new WorkspacePathError(`Workspace ${workspace} path /x could not be inspected: EACCES`), workspace, ancestor)).toBe(false);
    expect(admissionRefusedForPlantedConfiguration(new WorkspacePathError(`Workspace ${workspace} contains project Antigravity configuration in ancestor directory /other at .agents`), workspace, ancestor)).toBe(false);
    expect(admissionRefusedForPlantedConfiguration(null, workspace, ancestor)).toBe(false);
  });

  it('wraps the scripted reply for the Code Assist path and reports zero usage', () => {
    const part = { text: 'done' };
    expect(scriptedGenerateResponse(part, '/v1internal:streamGenerateContent')).toHaveProperty('response.candidates');
    expect(scriptedGenerateResponse(part, '/v1beta/models/x:generateContent')).toMatchObject({ usageMetadata: { totalTokenCount: 0 } });
  });

  it('classifies a tool probe as executed only when the probe content reaches the model', () => {
    const base = { modelRequests: 2, functionCallIssued: true, functionResponseReturned: true, nonceReturned: false, nonceSeenBeforeCall: false, hookInvocations: 1, timedOut: false };
    expect(classifyToolProbe({ ...base, nonceReturned: true })).toEqual({ outcome: 'executed', reason: 'probe_content_returned' });
    expect(classifyToolProbe(base)).toEqual({ outcome: 'denied', reason: 'probe_content_withheld' });
    expect(classifyToolProbe({ ...base, functionResponseReturned: false })).toEqual({ outcome: 'denied', reason: 'turn_ended_without_function_response' });
    expect(classifyToolProbe({ ...base, hookInvocations: 0 }).reason).toBe('hook_not_invoked');
    expect(classifyToolProbe({ ...base, modelRequests: 0 }).reason).toBe('scripted_model_unreached');
    expect(classifyToolProbe({ ...base, functionCallIssued: false }).reason).toBe('probe_call_not_issued');
    expect(classifyToolProbe({ ...base, nonceSeenBeforeCall: true, nonceReturned: true }).reason).toBe('probe_content_preloaded');
    expect(classifyToolProbe({ ...base, timedOut: true, nonceReturned: true }).outcome).toBe('inconclusive');
  });

  it('records stream tool-event field names and checks them against the backend parser', () => {
    const executed = [
      JSON.stringify({ event: 'step_update', step_update: { step_index: 0, step_type: 'planner_response', state: 'DONE' } }),
      JSON.stringify({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool_call', tool_name: 'view_file', state: 'DONE', args: { AbsolutePath: '/w/p.txt' } } }),
      'not json',
      JSON.stringify({ event: 'result', result: { status: 'SUCCESS' } })
    ].join('\n');
    const shape = streamToolShape(executed, 'view_file');
    expect(shape).toMatchObject({ lines: 4, unparsed_lines: 1, tool_events: 1, parser_probe_calls: 1 });
    expect(shape.field_paths).toContain('step_update.tool_name');
    expect(shape.field_paths).toContain('step_update.args.AbsolutePath');
    expect(shape.kinds).toEqual(expect.arrayContaining(['event=step_update', 'state=DONE', 'step_type=tool_call']));
    expect(shape.field_paths.join(' ')).not.toContain('/w/p.txt');

    const deniedExplicit = streamToolShape(JSON.stringify({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool_call', tool_name: 'view_file', state: 'DENIED' } }), 'view_file');
    const deniedImplicit = streamToolShape(JSON.stringify({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool_call', tool_name: 'view_file' } }), 'view_file');
    expect(evaluateStreamShape(shape, deniedExplicit)).toEqual([]);
    expect(evaluateStreamShape(shape, deniedImplicit).map((f) => f.code)).toEqual(['stream_shape_denied_counted_executed']);
    const unknown = streamToolShape(JSON.stringify({ event: 'tool_activity', activity: { name: 'view_file' } }), 'view_file');
    expect(unknown.tool_events).toBe(1);
    expect(evaluateStreamShape(unknown, deniedExplicit).map((f) => f.code)).toEqual(['stream_shape_executed_unparsed']);
  });

  it('fails hook invocation, failure-mode, proxy and project-configuration evidence that does not prove denial', () => {
    const executed = evidence({ outcome: 'executed', nonce_returned: true });
    expect(evaluateHookInvocation(executed, evidence({}))).toEqual([]);
    expect(evaluateHookInvocation(executed, executed).map((f) => f.code)).toEqual(['probe_deny_not_honoured']);
    expect(evaluateHookInvocation(evidence({}), evidence({})).map((f) => f.code)).toEqual(['probe_control_not_executed']);
    expect(evaluateHookInvocation(evidence({ outcome: 'executed', hook_invocations: 0 }), evidence({})).map((f) => f.code)).toEqual(['probe_control_hook_not_invoked']);

    expect(evaluateHookFailureModes({ timeout: evidence({}), nonzero_exit: evidence({}), unparseable_output: evidence({}) })).toEqual([]);
    expect(evaluateHookFailureModes({
      timeout: evidence({ outcome: 'inconclusive', reason: 'agy_run_timed_out' }),
      nonzero_exit: executed,
      unparseable_output: evidence({})
    }).map((f) => f.code)).toEqual(['hook_failure_timeout_inconclusive', 'hook_failure_nonzero_exit_allowed']);

    expect(evaluateProxyProbe([]).findings.map((f) => f.code)).toEqual(['proxy_not_honoured']);
    expect(evaluateProxyProbe(['play.googleapis.com']).findings.map((f) => f.code)).toEqual(['proxy_inference_host_unclassified']);
    expect(evaluateProxyProbe(['play.googleapis.com', 'cloudcode-pa.googleapis.com'])).toEqual({ inferenceHosts: ['cloudcode-pa.googleapis.com'], findings: [] });

    expect(evaluateProjectConfig([], true, executed)).toEqual([]);
    expect(evaluateProjectConfig(['vsup-planted-git-root-agents-rules'], true, executed).map((f) => f.code)).toEqual(['project_config_loaded']);
    expect(evaluateProjectConfig([], false, evidence({ outcome: 'inconclusive', reason: 'scripted_model_unreached' })).map((f) => f.code))
      .toEqual(['project_config_readback_failed', 'project_config_probe_inconclusive']);
    expect(plantedMarkersIn('x vsup-planted-parent-agent-rules y vsup-planted-parent-agent-rules')).toEqual(['vsup-planted-parent-agent-rules']);
  });

  it('serves a scripted function call, then text, and records whether the probe content came back', async () => {
    const server = await startScriptedModelServer();
    try {
      server.beginRun('probe-unit', 'nonce-0123', '/w/vsup-probe.txt');
      const tools = [{ functionDeclarations: [{ name: 'view_file', parameters: { properties: { AbsolutePath: {} } } }] }];
      const first = await postJson(`${server.url}/v1beta/models/m:streamGenerateContent?alt=sse`, { contents: [{ role: 'user', parts: [{ text: 'go' }] }], tools });
      expect(first.status).toBe(200);
      expect(first.text).toMatch(/^data: /);
      expect(JSON.parse(first.text.slice(6))).toMatchObject({ candidates: [{ content: { parts: [{ functionCall: { name: 'view_file', args: { AbsolutePath: '/w/vsup-probe.txt' } } }] } }] });
      const second = await postJson(`${server.url}/v1beta/models/m:generateContent`, {
        contents: [{ role: 'user', parts: [{ functionResponse: { name: 'view_file', response: { output: 'nonce-0123' } } }] }],
        tools
      });
      expect(JSON.parse(second.text)).toMatchObject({ candidates: [{ content: { parts: [{ text: 'done' }] } }] });
      expect((await postJson(`${server.url}/v1beta/models/m:countTokens`, {})).text).toBe('{"totalTokens":0}');
      expect((await postJson(`${server.url}/v1/other`, {})).status).toBe(404);
      expect(server.issuedTool('probe-unit')).toBe('view_file');
      expect(server.requests.map((r) => [r.generate, r.carries_function_response, r.nonce_seen, r.nonce_seen_before_call])).toEqual([
        [true, false, false, false],
        [true, true, true, false],
        [false, false, false, false],
        [false, false, false, false]
      ]);
      expect(server.requests[0]?.declared_tools).toEqual(['view_file']);
    } finally {
      await server.close();
    }
  });
});

describe('Antigravity preparation probes through a fake agy', () => {
  it('passes when agy invokes the hook, honours deny and hook failures, routes through the proxy and ignores planted project config', async () => {
    const out = await prepareWith('');
    const probes = out.report.agy_probes;
    expect(out.report.findings.filter((f) => f.level === 'fail')).toEqual([]);
    expect(out.status).toBe('passed');
    expect(out.report.schema_version).toBe(2);
    expect(probes.hook_invoked_and_deny_honoured).toMatchObject({
      result: 'pass',
      control: { outcome: 'executed', probe_tool: 'view_file', hook_invocations: 1 },
      deny_all: { outcome: 'denied', hook_invocations: 1 }
    });
    expect(probes.hook_invoked_and_deny_honoured.deny_all?.hook_payload_fields).toEqual(['conversationId', 'stepIdx', 'toolCall']);
    expect(probes.hook_failure_denies).toMatchObject({
      result: 'pass',
      timeout: { outcome: 'denied' },
      nonzero_exit: { outcome: 'denied' },
      unparseable_output: { outcome: 'denied' }
    });
    expect(probes.stream_tool_shape).toMatchObject({ result: 'pass', executed: { parser_probe_calls: 1 }, denied: { parser_probe_calls: 0 } });
    expect(probes.proxy_honoured).toMatchObject({ result: 'pass', inference_hosts: ['generativelanguage.googleapis.com'] });
    expect(probes.project_config_not_loaded).toMatchObject({ result: 'pass', loaded: [], readbacks_ok: true, run: { outcome: 'executed' } });
    expect(probes.scripted_model.declared_tools).toEqual(['view_file', 'read_file', 'list_dir']);
    expect(out.report.network_observation.verdict).toBe('none-observed-control-validated');
  }, 90_000);

  it('fails the receipt when agy lets a failed hook allow the call', async () => {
    const out = await prepareWith('hook-failure-allows');
    expect(out.status).toBe('failed');
    expect(out.report.agy_probes.hook_failure_denies.result).toBe('fail');
    expect(out.report.findings.map((f) => f.code)).toEqual(expect.arrayContaining([
      'hook_failure_timeout_allowed',
      'hook_failure_nonzero_exit_allowed',
      'hook_failure_unparseable_output_allowed'
    ]));
  }, 90_000);

  it('fails the receipt when agy runs the tool without honouring the hook', async () => {
    const out = await prepareWith('ignore-hooks');
    expect(out.status).toBe('failed');
    expect(out.report.agy_probes.hook_invoked_and_deny_honoured.result).toBe('fail');
    expect(out.report.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['probe_control_hook_not_invoked', 'probe_deny_not_honoured']));
  }, 90_000);

  it('fails the receipt when agy bypasses HTTPS_PROXY', async () => {
    const out = await prepareWith('bypass-proxy');
    expect(out.status).toBe('failed');
    expect(out.report.agy_probes.proxy_honoured).toMatchObject({ result: 'fail', attempts: 0 });
  }, 90_000);

  it('fails the receipt when agy loads project configuration above the workspace', async () => {
    const out = await prepareWith('load-project-config');
    expect(out.status).toBe('failed');
    expect(out.report.agy_probes.project_config_not_loaded.result).toBe('fail');
    expect(out.report.agy_probes.project_config_not_loaded.loaded).toEqual(expect.arrayContaining([
      'vsup-planted-git-root-agents-rules',
      'vsup-planted-parent-agent-rules'
    ]));
  }, 90_000);

  it('fails the receipt when the stream shape does not match the backend audit parser', async () => {
    const unparsed = await prepareWith('unparsed-shape');
    expect(unparsed.status).toBe('failed');
    expect(unparsed.report.agy_probes.stream_tool_shape.result).toBe('fail');
    expect(unparsed.report.findings.map((f) => f.code)).toContain('stream_shape_executed_unparsed');
    const deniedCounted = await prepareWith('denied-looks-executed');
    expect(deniedCounted.report.findings.map((f) => f.code)).toContain('stream_shape_denied_counted_executed');
  }, 120_000);

  it('fails closed as inconclusive when agy does not reach the scripted model endpoint', async () => {
    const out = await prepareWith('ignore-endpoint');
    expect(out.status).toBe('failed');
    expect(out.report.agy_probes.hook_invoked_and_deny_honoured.control).toMatchObject({ outcome: 'inconclusive', reason: 'scripted_model_unreached' });
    expect(out.report.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['probe_control_not_executed', 'provider_inference_attempted']));
  }, 90_000);
});
