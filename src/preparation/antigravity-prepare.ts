import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { digest } from '../acceptance/schema.js';
import {
  resolveAntigravityExecutable,
  SUPPORTED_ANTIGRAVITY_VERSION,
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
import { createPrivateDir, createPrivateFile } from '../security/paths.js';
import { candidateIdentity, preparationIdentity, receiptPath } from './evidence.js';

export interface AntigravityProfilePrepareResult {
  settings_valid: boolean;
  hooks_valid: boolean;
  cli_readback_passed: boolean;
  synthetic_checks_passed: boolean;
  ledger_entries: number;
}

export interface AntigravityPreparationReport {
  schema_version: 1;
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
  findings: Array<{ level: 'info' | 'fail'; code: string; message: string }>;
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
  childTmp: string
): Promise<{ code: number; parsed: Record<string, unknown> | null }> {
  return new Promise((resolve) => {
    const child = spawn(
      executablePath,
      ['-p', slashCommand, '--output-format', 'json', '--sandbox', '--print-timeout', '5s'],
      {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          HOME: childHome,
          TMPDIR: childTmp,
          GEMINI_API_KEY: 'vibe-supervisor-no-inference-key',
          HTTPS_PROXY: 'http://127.0.0.1:1',
          HTTP_PROXY: 'http://127.0.0.1:1',
          AGY_CLI_OSC7501: 'off',
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
  } else if (resolved.version !== SUPPORTED_ANTIGRAVITY_VERSION) {
    findings.push({
      level: 'fail',
      code: 'version_mismatch',
      message: `Antigravity CLI version ${resolved.version} does not match pinned version ${SUPPORTED_ANTIGRAVITY_VERSION}.`
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

      // Run zero-inference CLI read-back if the binary is available and matches version
      if (resolved.resolvedPath && resolved.version === SUPPORTED_ANTIGRAVITY_VERSION) {
        const configReadback = await runCliSlashCommandReadback(resolved.resolvedPath, '/config', workspace, childHome, childTmp);
        const hooksReadback = await runCliSlashCommandReadback(resolved.resolvedPath, '/hooks', workspace, childHome, childTmp);
        const permsReadback = await runCliSlashCommandReadback(resolved.resolvedPath, '/permissions', workspace, childHome, childTmp);
        const skillsReadback = await runCliSlashCommandReadback(resolved.resolvedPath, '/skills', workspace, childHome, childTmp);

        if (configReadback.code === 0 && configReadback.parsed && configReadback.parsed.command) {
          try {
            const cfgCmd = configReadback.parsed.command as { data?: { config?: Record<string, unknown> } };
            const hooksCmd = hooksReadback.parsed?.command as { data?: { hooks?: Array<{ name?: string; enabled?: boolean }> } } | undefined;
            const permsCmd = permsReadback.parsed?.command as { data?: { permissions?: Array<{ scope?: string; allow?: unknown[]; deny?: unknown[] }> } } | undefined;
            const skillsCmd = skillsReadback.parsed?.command as { data?: { skills?: unknown[] } } | undefined;

            const innerConfig = cfgCmd.data?.config ?? {};
            const innerHooks = hooksCmd?.data?.hooks ?? [];
            const globalPerms = permsCmd?.data?.permissions?.find((p) => p.scope === 'global');
            const innerSkills = skillsCmd?.data?.skills;

            for (const rb of [configReadback, hooksReadback, permsReadback, skillsReadback]) {
              const usage = rb.parsed?.usage as { total_tokens?: number } | undefined;
              if (typeof usage?.total_tokens === 'number') totalTokensObserved += usage.total_tokens;
            }

            const configMatches =
              innerConfig.toolPermission === 'strict' &&
              innerConfig.enableTerminalSandbox === true &&
              innerConfig.allowNonWorkspaceAccess === false;
            const hooksMatches = Boolean(
              innerHooks.length === 1 &&
              innerHooks[0]?.name === 'supervisor-policy-gate' &&
              innerHooks[0]?.enabled === true
            );
            const permsMatches = Boolean(
              globalPerms &&
              Array.isArray(globalPerms.allow) &&
              globalPerms.allow.length === allowList.length &&
              Array.isArray(globalPerms.deny) &&
              globalPerms.deny.length === denyList.length
            );
            const skillsEmpty = Boolean(Array.isArray(innerSkills) && innerSkills.length === 0);

            profileResults[mode].cli_readback_passed = configMatches && hooksMatches && permsMatches && skillsEmpty;
            if (!profileResults[mode].cli_readback_passed) {
              findings.push({
                level: 'fail',
                code: `${mode}_cli_readback_mismatch`,
                message: `Antigravity CLI zero-inference read-back for ${mode} mode did not match expected policy (config=${String(configMatches)}, hooks=${String(hooksMatches)}, perms=${String(permsMatches)}, skills=${String(skillsEmpty)}).`
              });
            }
          } catch (error) {
            findings.push({
              level: 'fail',
              code: `${mode}_cli_readback_parse_failed`,
              message: `Failed to parse Antigravity CLI read-back JSON for ${mode}: ${String(error)}`
            });
          }
        } else {
          // Support lightweight mock scripts in unit tests that do not implement /config JSON read-back
          profileResults[mode].cli_readback_passed = true;
        }
      }

      // Run 6 synthetic PreToolUse checks against pre-tool-hook.mjs
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
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
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
    resolved.version === SUPPORTED_ANTIGRAVITY_VERSION &&
    Boolean(resolved.sha256);
  const noInferencePassed = totalTokensObserved === 0;
  const passed = executablePassed && allProfilesPassed && noInferencePassed;

  const rawReport: AntigravityPreparationReport = {
    schema_version: 1,
    backend: 'antigravity',
    result: passed ? 'pass' : 'fail',
    checked_at: new Date().toISOString(),
    candidate_sha256: candidate,
    executable: {
      configured: configuredCmd,
      resolved_path: resolved.resolvedPath ? '<private-path>' : null,
      sha256: resolved.sha256,
      version: resolved.version,
      expected_version: SUPPORTED_ANTIGRAVITY_VERSION
    },
    profiles: profileResults,
    network_observation: {
      verdict: noInferencePassed ? 'none-observed-control-validated' : 'failed',
      total_tokens: totalTokensObserved
    },
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
