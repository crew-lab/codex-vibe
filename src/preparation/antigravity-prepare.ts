import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { digest } from '../acceptance/schema.js';
import {
  isSupportedAntigravityVersion,
  onlyAllowedAntigravityBuiltinSkills,
  resolveAntigravityExecutable,
  SUPPORTED_ANTIGRAVITY_VERSION,
  SUPPORTED_ANTIGRAVITY_VERSIONS,
  writeIsolatedSettings
} from '../backends/antigravity.js';
import {
  readAntigravityHookLedger,
  writeAntigravityPreToolHook
} from '../backends/antigravity-hook.js';
import type { SupervisorConfig } from '../contracts.js';
import { atomicWriteJson } from '../persistence/atomic.js';
import { publicValue } from '../reporting/export.js';
import { denylistAnchors, workspaceAnchors } from '../security/globs.js';
import { setupHeadlessBrowserNeutralizer } from '../security/environment.js';
import { createPrivateDir, createPrivateFile } from '../security/paths.js';
import { candidateIdentity, preparationIdentity, receiptPath } from './evidence.js';
import {
  isInferenceHost,
  NO_INFERENCE_GOOGLE_API_KEY,
  notRunProbeReport,
  probeReportPassed,
  runAgyProbes,
  type AgyProbeReport
} from './antigravity-probes.js';

export interface AntigravityProfilePrepareResult {
  settings_valid: boolean;
  hooks_valid: boolean;
  cli_readback_passed: boolean;
  synthetic_checks_passed: boolean;
  ledger_entries: number;
}

export interface AntigravityPreparationReport {
  schema_version: 2;
  backend: 'antigravity';
  result: 'pass' | 'fail';
  checked_at: string;
  candidate_sha256: string;
  executable: {
    configured: string;
    resolved_path: string | null;
    sha256: string | null;
    version: string | null;
    expected_version: string;
  };
  profiles: {
    review: AntigravityProfilePrepareResult;
    edit: AntigravityProfilePrepareResult;
  };
  network_observation: {
    verdict: 'none-observed-control-validated' | 'failed';
    total_tokens: number;
  };
  agy_probes: AgyProbeReport;
  findings: Array<{ level: 'info' | 'fail'; code: string; message: string }>;
}

interface ProxyAttempt {
  run: string;
  method: string;
  host: string;
  port: number | null;
}

interface PreparationRefusingProxy {
  port: number;
  attempts: ProxyAttempt[];
  setRun(run: string): void;
  attemptsFor(run: string): ProxyAttempt[];
  runControl(): Promise<boolean>;
  close(): Promise<void>;
}

async function startPreparationRefusingProxy(): Promise<PreparationRefusingProxy> {
  const attempts: ProxyAttempt[] = [];
  const sockets = new Set<net.Socket>();
  let currentRun = 'unassigned';

  const hostOf = (raw: string): string => {
    const host = String(raw).toLowerCase();
    return /^[a-z0-9.-]{1,253}$/.test(host) ? host : 'invalid-host';
  };

  const describe = (line: string): { method: string; host: string; port: number | null } => {
    const parts = line.split(/\s+/);
    const method = (parts[0] ?? '').slice(0, 16).toUpperCase();
    const target = parts[1] ?? '';
    if (method === 'CONNECT') {
      const match = /^(.*):(\d{1,5})$/.exec(target);
      return { method, host: hostOf(match ? match[1]! : target), port: match ? Number(match[2]) : null };
    }
    try {
      const url = new URL(target);
      return { method, host: hostOf(url.hostname), port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80 };
    } catch {
      return { method, host: 'unparsed', port: null };
    }
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buffered = '';
    let answered = false;
    socket.on('data', (chunk) => {
      if (answered) return;
      buffered += chunk.toString('latin1');
      const newline = buffered.indexOf('\n');
      if (newline < 0 && buffered.length < 4096) return;
      answered = true;
      if (attempts.length < 500) {
        attempts.push({ run: currentRun, ...describe(buffered.slice(0, newline < 0 ? 4096 : newline).trim()) });
      }
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as net.AddressInfo;
  const port = address.port;

  const runControl = async (): Promise<boolean> => {
    currentRun = 'control';
    return new Promise<boolean>((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'GET',
          path: 'http://control.antigravity.local/test',
          headers: { Host: 'control.antigravity.local' },
          timeout: 2000
        },
        (res) => {
          res.resume();
          const recorded = attempts.some((a) => a.run === 'control');
          resolve(res.statusCode === 403 && recorded);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  };

  return {
    port,
    attempts,
    setRun(run: string) { currentRun = run; },
    attemptsFor(run: string) { return attempts.filter((attempt) => attempt.run === run); },
    runControl,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

async function runHookStdinCheck(
  hookScriptPath: string,
  payload: Record<string, unknown>
): Promise<{ decision?: string; reason?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookScriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000
    });
    const stdoutChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Hook exited with code ${code ?? 'null'}`));
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(stdoutChunks).toString('utf8').trim()) as {
          decision?: string;
          reason?: string;
        };
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function runCliSlashCommandReadback(
  executablePath: string,
  slashCommand: string,
  cwd: string,
  childHome: string,
  childTmp: string,
  proxyPort: number
): Promise<{ code: number; parsed: Record<string, unknown> | null }> {
  const neutralizerBin = await setupHeadlessBrowserNeutralizer(path.join(childHome, '.bin'));
  return new Promise((resolve) => {
    const child = spawn(
      executablePath,
      ['-p', slashCommand, '--output-format', 'json', '--sandbox', '--print-timeout', '5s'],
      {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          PATH: `${neutralizerBin}${path.delimiter}${process.env.PATH ?? ''}`,
          HOME: childHome,
          TMPDIR: childTmp,
          GEMINI_API_KEY: NO_INFERENCE_GOOGLE_API_KEY,
          HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
          HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
          ALL_PROXY: `http://127.0.0.1:${proxyPort}`,
          https_proxy: `http://127.0.0.1:${proxyPort}`,
          http_proxy: `http://127.0.0.1:${proxyPort}`,
          all_proxy: `http://127.0.0.1:${proxyPort}`,
          AGY_CLI_OSC7501: 'off',
          BROWSER: 'false',
          NO_COLOR: '1'
        },
        timeout: 10_000
      }
    );
    const stdoutChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(Buffer.from(chunk)));
    child.once('error', () => resolve({ code: 1, parsed: null }));
    child.once('close', (code) => {
      const raw = Buffer.concat(stdoutChunks).toString('utf8').trim();
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        resolve({ code: code ?? 1, parsed });
      } catch {
        resolve({ code: code ?? 1, parsed: null });
      }
    });
  });
}

export async function runAntigravityPreparationCheck(
  config: SupervisorConfig,
  options: { dataDir?: string } = {}
): Promise<{
  status: 'passed' | 'failed';
  candidate_sha256: string;
  hosted_acceptance: 'unverified';
  report_sha256: string;
  report: AntigravityPreparationReport;
}> {
  const candidate = await candidateIdentity();
  const targetReceipt = receiptPath(config, options.dataDir);
  const reportsDir = path.join(path.dirname(targetReceipt), 'preparation-reports');
  await createPrivateDir(reportsDir);

  let identity: string | null = null;
  try {
    identity = await preparationIdentity(config, candidate);
  } catch {
    identity = digest(`missing-pin:${candidate}:${new Date().toISOString()}`);
  }

  const startedPayload = Buffer.from(
    JSON.stringify({
      result: 'incomplete',
      stage: 'no-inference-check-started',
      checked_at: new Date().toISOString()
    }) + '\n'
  );
  const startedHash = digest(startedPayload);
  try {
    await createPrivateFile(path.join(reportsDir, `${startedHash}.json`), startedPayload, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await atomicWriteJson(targetReceipt, {
    schema_version: 1,
    result: 'failed',
    identity,
    checked_at: new Date().toISOString(),
    report_sha256: startedHash
  });

  const findings: Array<{ level: 'info' | 'fail'; code: string; message: string }> = [];
  const configuredCmd = config.paths?.antigravity ?? 'agy';
  const resolved = await resolveAntigravityExecutable(configuredCmd);

  if (!resolved.resolvedPath || !resolved.version || !resolved.sha256) {
    findings.push({
      level: 'fail',
      code: 'executable_unavailable',
      message: resolved.error ?? `Antigravity CLI (${configuredCmd}) could not be resolved or probed.`
    });
  } else if (!isSupportedAntigravityVersion(resolved.version)) {
    findings.push({
      level: 'fail',
      code: 'version_mismatch',
      message: `Antigravity CLI version ${resolved.version} does not match supported pinned versions (${SUPPORTED_ANTIGRAVITY_VERSIONS.join(', ')}).`
    });
  } else {
    findings.push({
      level: 'info',
      code: 'executable_verified',
      message: `Antigravity CLI ${resolved.version} verified (sha256: ${resolved.sha256}).`
    });
  }

  const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vsup-agy-prep-')));
  let totalTokensObserved = 0;
  let usageObservedCount = 0;

  const profileResults: Record<'review' | 'edit', AntigravityProfilePrepareResult> = {
    review: {
      settings_valid: false,
      hooks_valid: false,
      cli_readback_passed: false,
      synthetic_checks_passed: false,
      ledger_entries: 0
    },
    edit: {
      settings_valid: false,
      hooks_valid: false,
      cli_readback_passed: false,
      synthetic_checks_passed: false,
      ledger_entries: 0
    }
  };

  let probeReport: AgyProbeReport = notRunProbeReport();
  const proxy = await startPreparationRefusingProxy();
  const controlPassed = await proxy.runControl();
  if (!controlPassed) {
    findings.push({
      level: 'fail',
      code: 'proxy_control_failed',
      message: 'Positive control through local refusing proxy did not succeed.'
    });
  }

  try {
    const workspace = path.join(tempRoot, 'workspace');
    await mkdir(path.join(workspace, 'src'), { recursive: true });
    await mkdir(path.join(workspace, 'excluded'), { recursive: true });
    await writeFile(path.join(workspace, 'src', 'index.ts'), 'export const ok = true;\n');
    await writeFile(path.join(workspace, 'excluded', 'secret.txt'), 'TOP_SECRET=1\n');
    await writeFile(path.join(workspace, '.env'), 'SECRET_KEY=123\n');

    const exclusions = [{ root: workspace, globs: ['excluded/**'] }];
    const anchors = workspaceAnchors(exclusions, workspace);
    const denylist = denylistAnchors(exclusions, workspace, workspace);

    for (const mode of ['review', 'edit'] as const) {
      const childHome = path.join(tempRoot, `home-${mode}`);
      const childTmp = path.join(tempRoot, `tmp-${mode}`);
      await createPrivateDir(childHome);
      await createPrivateDir(childTmp);

      await writeIsolatedSettings(childHome, mode, workspace, denylist, { modelProvider: 'gemini' });
      await writeAntigravityPreToolHook(childHome, {
        mode,
        workerWorkspace: workspace,
        excludedAnchors: anchors
      });

      const settingsPath = path.join(childHome, '.gemini', 'antigravity-cli', 'settings.json');
      const hooksPath = path.join(childHome, '.gemini', 'config', 'hooks.json');
      const hookScriptPath = path.join(childHome, '.gemini', 'antigravity-cli', 'pre-tool-hook.mjs');

      const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as {
        toolPermission?: string;
        enableTerminalSandbox?: boolean;
        allowNonWorkspaceAccess?: boolean;
        permissions?: { allow?: string[]; deny?: string[] };
      };

      const allowList = settings.permissions?.allow ?? [];
      const denyList = settings.permissions?.deny ?? [];
      const hasValidReviewAllow = allowList.includes(`read_file(${workspace})`) && allowList.includes(`read_file(${workspace}/**)`);
      const hasValidEditAllow = mode === 'edit'
        ? allowList.includes(`write_file(${workspace})`) && allowList.includes(`write_file(${workspace}/**)`)
        : !allowList.some((rule) => rule.startsWith('write_file('));
      const hasRequiredDenies =
        denyList.includes('command(*)') &&
        denyList.includes('mcp(*)') &&
        denyList.includes('read_url(*)') &&
        denyList.includes('execute_url(*)') &&
        (mode === 'review' ? denyList.includes('write_file(*)') : true);

      profileResults[mode].settings_valid =
        settings.toolPermission === 'strict' &&
        settings.enableTerminalSandbox === true &&
        settings.allowNonWorkspaceAccess === false &&
        hasValidReviewAllow &&
        hasValidEditAllow &&
        hasRequiredDenies;

      if (!profileResults[mode].settings_valid) {
        findings.push({
          level: 'fail',
          code: `${mode}_settings_invalid`,
          message: `Isolated settings.json for ${mode} mode did not match unified permission rules.`
        });
      }

      const hooksJson = JSON.parse(await readFile(hooksPath, 'utf8')) as Record<string, unknown>;
      const gate = hooksJson['supervisor-policy-gate'] as { enabled?: boolean; PreToolUse?: unknown[] } | undefined;
      profileResults[mode].hooks_valid = Boolean(gate?.enabled === true && Array.isArray(gate.PreToolUse) && gate.PreToolUse.length === 1);
      if (!profileResults[mode].hooks_valid) {
        findings.push({
          level: 'fail',
          code: `${mode}_hooks_invalid`,
          message: `Isolated hooks.json for ${mode} mode is missing supervisor-policy-gate.`
        });
      }

      if (resolved.resolvedPath && resolved.version && isSupportedAntigravityVersion(resolved.version)) {
        proxy.setRun(`subject-${mode}`);
        const configReadback = await runCliSlashCommandReadback(resolved.resolvedPath, '/config', workspace, childHome, childTmp, proxy.port);
        const hooksReadback = await runCliSlashCommandReadback(resolved.resolvedPath, '/hooks', workspace, childHome, childTmp, proxy.port);
        const permsReadback = await runCliSlashCommandReadback(resolved.resolvedPath, '/permissions', workspace, childHome, childTmp, proxy.port);
        const skillsReadback = await runCliSlashCommandReadback(resolved.resolvedPath, '/skills', workspace, childHome, childTmp, proxy.port);
        const agentsReadback = await runCliSlashCommandReadback(resolved.resolvedPath, '/agents', workspace, childHome, childTmp, proxy.port);

        const readbacks = [
          { cmd: '/config', rb: configReadback },
          { cmd: '/hooks', rb: hooksReadback },
          { cmd: '/permissions', rb: permsReadback },
          { cmd: '/skills', rb: skillsReadback },
          { cmd: '/agents', rb: agentsReadback }
        ];

        let readbackSuccess = true;
        for (const item of readbacks) {
          if (item.rb.code !== 0 || !item.rb.parsed) {
            readbackSuccess = false;
            findings.push({
              level: 'fail',
              code: `${mode}_cli_readback_${item.cmd.slice(1)}_failed`,
              message: `Antigravity CLI zero-inference command ${item.cmd} for ${mode} exited with code ${item.rb.code}${!item.rb.parsed ? ' and produced invalid JSON' : ''}.`
            });
          }
        }

        if (readbackSuccess) {
          try {
            const cfgCmd = configReadback.parsed!.command as { data?: { config?: Record<string, unknown> } } | undefined;
            const hooksCmd = hooksReadback.parsed!.command as {
              data?: {
                hooks?: Array<{
                  name?: string;
                  enabled?: boolean;
                  events?: Array<{ event?: string; matcher?: string }>;
                }>;
              };
            } | undefined;
            const permsCmd = permsReadback.parsed!.command as { data?: { permissions?: Array<{ scope?: string; allow?: unknown[]; deny?: unknown[] }> } } | undefined;
            const skillsCmd = skillsReadback.parsed!.command as { data?: { skills?: unknown[] } } | undefined;
            const agentsCmd = agentsReadback.parsed!.command as { data?: { agents?: unknown[] } } | undefined;

            const innerConfig = cfgCmd?.data?.config ?? {};
            const innerHooks = hooksCmd?.data?.hooks ?? [];
            const innerSkills = skillsCmd?.data?.skills;
            const innerAgents = agentsCmd?.data?.agents;

            for (const { rb } of readbacks) {
              const cmdData = (rb.parsed?.command as { data?: { usage?: { total_tokens?: number } } } | undefined)?.data;
              const usage = (rb.parsed?.usage ?? cmdData?.usage) as { total_tokens?: number } | undefined;
              if (usage && typeof usage.total_tokens === 'number') {
                totalTokensObserved += usage.total_tokens;
                usageObservedCount += 1;
              }
            }

            const configMatches =
              innerConfig.toolPermission === 'strict' &&
              innerConfig.enableTerminalSandbox === true &&
              innerConfig.allowNonWorkspaceAccess === false;

            const gateHook = innerHooks.find((h) => h.name === 'supervisor-policy-gate');
            const hookActions = Array.isArray((gateHook as { actions?: unknown[] })?.actions)
              ? (gateHook as { actions: Array<{ event?: string; matcher?: string }> }).actions
              : Array.isArray(gateHook?.events)
                ? gateHook.events
                : [];
            const hooksMatches = Boolean(
              innerHooks.length === 1 &&
              gateHook &&
              gateHook.enabled === true &&
              hookActions.some((e) => e.event === 'PreToolUse' && e.matcher === '*')
            );

            const permsMatches = antigravityPermissionsMatch(permsCmd?.data?.permissions, allowList, denyList);

            const skillsMatches = Boolean(Array.isArray(innerSkills) && onlyAllowedAntigravityBuiltinSkills(innerSkills));
            const agentsEmpty = Boolean(!innerAgents || (Array.isArray(innerAgents) && innerAgents.length === 0));

            profileResults[mode].cli_readback_passed =
              configMatches && hooksMatches && permsMatches && skillsMatches && agentsEmpty;

            if (!profileResults[mode].cli_readback_passed) {
              findings.push({
                level: 'fail',
                code: `${mode}_cli_readback_mismatch`,
                message: `Antigravity CLI zero-inference read-back for ${mode} mode did not match expected policy (config=${String(configMatches)}, hooks=${String(hooksMatches)}, perms=${String(permsMatches)}, skills=${String(skillsMatches)}, agents=${String(agentsEmpty)}).`
              });
            }
          } catch (error) {
            findings.push({
              level: 'fail',
              code: `${mode}_cli_readback_parse_failed`,
              message: `Failed to parse Antigravity CLI read-back JSON for ${mode}: ${String(error)}`
            });
            profileResults[mode].cli_readback_passed = false;
          }
        } else {
          profileResults[mode].cli_readback_passed = false;
        }
      } else {
        profileResults[mode].cli_readback_passed = false;
        findings.push({
          level: 'fail',
          code: `${mode}_cli_unavailable`,
          message: `Antigravity CLI executable is unavailable or version does not match supported versions (${SUPPORTED_ANTIGRAVITY_VERSIONS.join(', ')}).`
        });
      }

      const syntheticCases: Array<{
        tool: string;
        args: Record<string, unknown>;
        expectedDecision: 'allow' | 'deny';
        expectedReason?: string;
      }> = [
        {
          tool: 'view_file',
          args: { AbsolutePath: path.join(workspace, 'src', 'index.ts') },
          expectedDecision: 'allow'
        },
        {
          tool: 'view_file',
          args: { AbsolutePath: path.join(workspace, 'excluded', 'secret.txt') },
          expectedDecision: 'deny',
          expectedReason: 'path_excluded'
        },
        {
          tool: 'view_file',
          args: { AbsolutePath: path.join(workspace, '.env') },
          expectedDecision: 'deny',
          expectedReason: 'path_secret'
        },
        {
          tool: 'view_file',
          args: { AbsolutePath: path.join(workspace, '.gemini', 'config', 'hooks.json') },
          expectedDecision: 'deny',
          expectedReason: 'path_reserved'
        },
        {
          tool: 'view_file',
          args: { AbsolutePath: '/etc/hosts' },
          expectedDecision: 'deny',
          expectedReason: 'path_outside_workspace'
        },
        {
          tool: 'write_to_file',
          args: { TargetFile: path.join(workspace, 'src', 'index.ts'), CodeContent: 'export const x = 2;\n' },
          expectedDecision: mode === 'edit' ? 'allow' : 'deny',
          ...(mode === 'review' ? { expectedReason: 'tool_not_in_profile' } : {})
        }
      ];

      let allSyntheticPassed = true;
      for (let idx = 0; idx < syntheticCases.length; idx++) {
        const testCase = syntheticCases[idx]!;
        const response = await runHookStdinCheck(hookScriptPath, {
          toolCall: { name: testCase.tool, args: testCase.args },
          stepIdx: idx + 1,
          conversationId: `prep-${mode}`
        });
        if (response.decision !== testCase.expectedDecision) {
          allSyntheticPassed = false;
          findings.push({
            level: 'fail',
            code: `${mode}_synthetic_check_failed`,
            message: `Synthetic PreToolUse check #${idx + 1} (${testCase.tool}) returned decision=${String(response.decision)}, expected=${testCase.expectedDecision}.`
          });
        } else if (testCase.expectedReason && response.reason !== testCase.expectedReason) {
          allSyntheticPassed = false;
          findings.push({
            level: 'fail',
            code: `${mode}_synthetic_reason_mismatch`,
            message: `Synthetic PreToolUse check #${idx + 1} (${testCase.tool}) returned reason=${String(response.reason)}, expected=${testCase.expectedReason}.`
          });
        }
      }

      const ledger = await readAntigravityHookLedger(childHome, [], 0);
      profileResults[mode].ledger_entries = ledger.approvals.records.length;
      profileResults[mode].synthetic_checks_passed =
        allSyntheticPassed && ledger.approvals.records.length === syntheticCases.length;
    }

    const executablePath = resolved.resolvedPath;
    if (executablePath && resolved.version && isSupportedAntigravityVersion(resolved.version)) {
      const probes = await runAgyProbes({
        executablePath,
        root: tempRoot,
        proxy,
        readback: (slashCommand, cwd, childHome, childTmp) =>
          runCliSlashCommandReadback(executablePath, slashCommand, cwd, childHome, childTmp, proxy.port)
      });
      probeReport = probes.report;
      findings.push(...probes.findings);
    } else {
      findings.push({
        level: 'fail',
        code: 'agy_probes_not_run',
        message: 'The hook, stream-shape, proxy and project-configuration probes need the pinned agy executable and did not run.'
      });
    }
  } finally {
    await proxy.close().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }

  const subjectAttempts = proxy.attempts.filter((a) => a.run.startsWith('subject-') || a.run.startsWith('probe-'));
  let networkVerdict: 'none-observed-control-validated' | 'failed';
  if (!controlPassed) {
    networkVerdict = 'failed';
  } else {
    const inferenceHosts = subjectAttempts.filter((a) => isInferenceHost(a.host));
    if (inferenceHosts.length > 0) {
      networkVerdict = 'failed';
      findings.push({
        level: 'fail',
        code: 'provider_inference_attempted',
        message: `Antigravity CLI attempted provider inference during zero-inference check (${inferenceHosts.map((h) => h.host).join(', ')}).`
      });
    } else {
      networkVerdict = 'none-observed-control-validated';
      if (subjectAttempts.length > 0) {
        findings.push({
          level: 'info',
          code: 'background_telemetry_refused',
          message: `Antigravity CLI background telemetry/updater requests were intercepted and refused by proxy (${[...new Set(subjectAttempts.map((h) => h.host))].join(', ')}). No provider inference occurred.`
        });
      }
    }
  }

  if (usageObservedCount === 0) {
    findings.push({
      level: 'info',
      code: 'usage_not_reported',
      message: 'Antigravity CLI slash commands did not report usage statistics in command output.'
    });
  }

  const allProfilesPassed = (['review', 'edit'] as const).every(
    (mode) =>
      profileResults[mode].settings_valid &&
      profileResults[mode].hooks_valid &&
      profileResults[mode].cli_readback_passed &&
      profileResults[mode].synthetic_checks_passed
  );
  const executablePassed =
    Boolean(resolved.resolvedPath) &&
    Boolean(resolved.version && isSupportedAntigravityVersion(resolved.version)) &&
    Boolean(resolved.sha256);
  const noInferencePassed = totalTokensObserved === 0 && networkVerdict === 'none-observed-control-validated';
  const passed = executablePassed && allProfilesPassed && noInferencePassed && probeReportPassed(probeReport);

  const rawReport: AntigravityPreparationReport = {
    schema_version: 2,
    backend: 'antigravity',
    result: passed ? 'pass' : 'fail',
    checked_at: new Date().toISOString(),
    candidate_sha256: candidate,
    executable: {
      configured: configuredCmd,
      resolved_path: resolved.resolvedPath ? '<private-path>' : null,
      sha256: resolved.sha256,
      version: resolved.version,
      expected_version: resolved.version && isSupportedAntigravityVersion(resolved.version) ? resolved.version : SUPPORTED_ANTIGRAVITY_VERSION
    },
    profiles: profileResults,
    network_observation: {
      verdict: networkVerdict,
      total_tokens: totalTokensObserved
    },
    agy_probes: probeReport,
    findings
  };

  const sanitizedReport = publicValue(rawReport) as AntigravityPreparationReport;
  const reportBytes = Buffer.from(JSON.stringify(sanitizedReport, null, 2) + '\n', 'utf8');
  const reportSha256 = digest(reportBytes);
  const savedReportPath = path.join(reportsDir, `${reportSha256}.json`);

  try {
    await createPrivateFile(savedReportPath, reportBytes, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }

  await atomicWriteJson(targetReceipt, {
    schema_version: 1,
    result: passed ? 'passed' : 'failed',
    identity,
    checked_at: new Date().toISOString(),
    report_sha256: reportSha256
  });

  return {
    status: passed ? 'passed' : 'failed',
    candidate_sha256: candidate,
    hosted_acceptance: 'unverified',
    report_sha256: reportSha256,
    report: sanitizedReport
  };
}

export function antigravityPermissionsMatch(value: unknown, expectedAllow: readonly string[], expectedDeny: readonly string[]): boolean {
  if (!Array.isArray(value)) return false;
  const scopes = new Set<string>();
  let globalMatched = false;
  const normalizeRule = (rule: string): string =>
    rule.trim().replace(/^view_file\(/, 'read_file(').replace(/^write_to_file\(/, 'write_file(');
  const matches = (actual: unknown, expected: readonly string[]): boolean => {
    if (!Array.isArray(actual) || actual.some((rule) => typeof rule !== 'string')) return false;
    const normalized = [...new Set(actual.map((rule: string) => normalizeRule(rule)))].sort();
    const wanted = [...new Set(expected.map((rule: string) => normalizeRule(rule)))].sort();
    return normalized.length === wanted.length && normalized.every((rule, index) => rule === wanted[index]);
  };
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const scope = entry as { scope?: unknown; allow?: unknown; deny?: unknown };
    if (typeof scope.scope !== 'string' || !['global', 'project', 'shared'].includes(scope.scope) || scopes.has(scope.scope)) return false;
    scopes.add(scope.scope);
    if (scope.scope === 'global') {
      globalMatched = matches(scope.allow ?? [], expectedAllow) && matches(scope.deny ?? [], expectedDeny);
      if (!globalMatched) return false;
    } else if (!matches(scope.allow ?? [], []) || !matches(scope.deny ?? [], [])) return false;
  }
  return globalMatched;
}
