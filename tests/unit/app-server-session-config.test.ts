import { mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSessionStart } from '../../src/backends/app-server/protocol.js';
import {
  AGENT_NAMES,
  DISABLED_TOOLS,
  PROFILE_TOOLS,
  buildSessionConfig,
  buildThinkingOffWrite,
  sessionDirectories,
  workspaceDenylist,
  writeSessionFiles
} from '../../src/backends/app-server/session-config.js';
import { WorkspacePathError } from '../../src/security/paths.js';

const workspace = '/srv/work/space';
const runDirectory = '/srv/runs/run-0001';

function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern.charAt(index);
    if (char === '*') source += '.*';
    else if (char === '?') source += '.';
    else source += char.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 's');
}

function denied(denylist: readonly string[], file: string): boolean {
  return denylist.some((pattern) => globToRegExp(pattern).test(file));
}

let temporary = '';
beforeEach(async () => { temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'session-config-'))); });
afterEach(async () => { await rm(temporary, { recursive: true, force: true }); });

describe('session agentConfig', () => {
  it('builds the review profile exactly', () => {
    const plan = buildSessionConfig({ mode: 'review', workspace, runDirectory, maxTurns: 12 });
    expect(plan.agentConfig).toEqual({
      cwd: workspace,
      agent: 'supervisor-review',
      enabledTools: ['read_file'],
      disabledTools: ['ask_user_question', 'exit_plan_mode', 'cron'],
      maxTurns: 12
    });
  });

  it('builds the edit profile exactly', () => {
    const plan = buildSessionConfig({ mode: 'edit', workspace, runDirectory, maxTurns: 30 });
    expect(plan.agentConfig.enabledTools).toEqual(['read_file', 'write_file', 'edit']);
    expect(plan.agentConfig.agent).toBe('supervisor-edit');
    expect(plan.agentConfig.cwd).toBe(workspace);
    expect(plan.agentConfig.maxTurns).toBe(30);
  });

  it('is accepted by the strict session/start builder and never enables shell, search or write tools in a review', () => {
    for (const mode of ['review', 'edit'] as const) {
      const plan = buildSessionConfig({ mode, workspace, runDirectory, maxTurns: 5 });
      const request = buildSessionStart(plan.agentConfig);
      expect(request.params.agentConfig).toMatchObject({ autoApprove: false, trustWorkspace: false, workspaceRoots: [], mcpServers: [], headless: true });
      expect(PROFILE_TOOLS[mode]).not.toContain('bash');
      expect(PROFILE_TOOLS[mode]).not.toContain('grep');
    }
    expect(PROFILE_TOOLS.review).not.toContain('write_file');
    expect(PROFILE_TOOLS.review).not.toContain('edit');
    expect(DISABLED_TOOLS).toEqual(['ask_user_question', 'exit_plan_mode', 'cron']);
  });

  it('does not alias the shared constants into the plan', () => {
    const plan = buildSessionConfig({ mode: 'review', workspace, runDirectory, maxTurns: 5 });
    plan.agentConfig.enabledTools = [...plan.agentConfig.enabledTools, 'bash'];
    expect(buildSessionConfig({ mode: 'review', workspace, runDirectory, maxTurns: 5 }).agentConfig.enabledTools).toEqual(['read_file']);
    expect(PROFILE_TOOLS.review).toEqual(['read_file']);
  });

  it('rejects unsafe input', () => {
    expect(() => buildSessionConfig({ mode: 'review', workspace: 'relative/path', runDirectory, maxTurns: 5 })).toThrow(TypeError);
    expect(() => buildSessionConfig({ mode: 'review', workspace, runDirectory: 'relative', maxTurns: 5 })).toThrow(TypeError);
    expect(() => buildSessionConfig({ mode: 'review', workspace, runDirectory, maxTurns: 0 })).toThrow(RangeError);
    expect(() => buildSessionConfig({ mode: 'review', workspace, runDirectory, maxTurns: 1.5 })).toThrow(RangeError);
    expect(() => buildSessionConfig({ mode: 'shell' as 'review', workspace, runDirectory, maxTurns: 5 })).toThrow(TypeError);
    for (const unsafe of ['/srv/w*rk', '/srv/w?rk', '/srv/w[a]rk', '/srv/work]']) {
      expect(() => buildSessionConfig({ mode: 'edit', workspace: unsafe, runDirectory, maxTurns: 5 })).toThrow(WorkspacePathError);
    }
  });
});

describe('supervisor agent profile', () => {
  it('asks for every profile tool and carries the denylist without any allowlist', () => {
    for (const mode of ['review', 'edit'] as const) {
      const plan = buildSessionConfig({ mode, workspace, runDirectory, maxTurns: 5 });
      const parsed = parse(plan.profile.content) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(['description', 'display_name', 'safety', 'tools']);
      expect(parsed.safety).toBe(mode === 'review' ? 'safe' : 'destructive');
      const tools = parsed.tools as Record<string, Record<string, unknown>>;
      expect(Object.keys(tools)).toEqual([...PROFILE_TOOLS[mode]]);
      for (const policy of Object.values(tools)) {
        expect(Object.keys(policy).sort()).toEqual(['denylist', 'permission']);
        expect(policy.permission).toBe('ask');
        expect(policy.denylist).toEqual(workspaceDenylist(workspace));
      }
      expect(plan.profile.file).toBe(path.join(runDirectory, 'vibe-home', 'agents', `${AGENT_NAMES[mode]}.toml`));
    }
  });

  it('denies reserved paths and secret files and leaves ordinary files to the approval handler', () => {
    const denylist = workspaceDenylist(workspace);
    for (const file of [
      '/srv/work/space/.git', '/srv/work/space/.git/config', '/srv/work/space/a/b/.git/HEAD',
      '/srv/work/space/.vibe', '/srv/work/space/.vibe/config.toml', '/srv/work/space/pkg/.agents/skills/x.md',
      '/srv/work/space/.vibeignore', '/srv/work/space/sub/.vibeignore',
      '/srv/work/space/.env', '/srv/work/space/.env.local', '/srv/work/space/.envrc', '/srv/work/space/a/b/.env.production',
      '/srv/work/space/server.pem', '/srv/work/space/deep/dir/id.key', '/srv/work/space/x/y.p12', '/srv/work/space/z.pfx'
    ]) expect(denied(denylist, file), file).toBe(true);
    for (const file of [
      '/srv/work/space/src/index.ts', '/srv/work/space/README.md', '/srv/work/space/environment.ts',
      '/srv/work/space/docs/.github.md', '/srv/work/spacex/.git/config', '/srv/other/.env'
    ]) expect(denied(denylist, file), file).toBe(false);
  });

  it('writes the profile and private directories with owner-only permissions and can rewrite it', async () => {
    const run = path.join(temporary, 'run');
    const plan = buildSessionConfig({ mode: 'edit', workspace, runDirectory: run, maxTurns: 5 });
    await writeSessionFiles(plan);
    await writeSessionFiles(plan);
    expect(await readFile(plan.profile.file, 'utf8')).toBe(plan.profile.content);
    expect((await stat(plan.profile.file)).mode & 0o777).toBe(0o600);
    for (const directory of [plan.directories.home, plan.directories.vibeHome, plan.directories.tmp, plan.profile.directory]) {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
    }
  });

  it('refuses to write through a symlinked profile path', async () => {
    const run = path.join(temporary, 'run');
    const plan = buildSessionConfig({ mode: 'review', workspace, runDirectory: run, maxTurns: 5 });
    await writeSessionFiles(plan);
    await rm(plan.profile.file);
    const target = path.join(temporary, 'elsewhere.toml');
    await writeFile(target, 'untouched');
    await symlink(target, plan.profile.file);
    await expect(writeSessionFiles(plan)).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe('untouched');
  });
});

describe('child process environment additions', () => {
  it('pins the private directories and every Vibe setting by name and encoding', () => {
    const plan = buildSessionConfig({ mode: 'review', workspace, runDirectory, maxTurns: 5 });
    expect(plan.environment).toEqual({
      HOME: '/srv/runs/run-0001/child-home',
      VIBE_HOME: '/srv/runs/run-0001/vibe-home',
      TMPDIR: '/srv/runs/run-0001/tmp',
      LOG_LEVEL: 'ERROR',
      VIBE_SESSION_LOGGING__SAVE_DIR: '/srv/runs/run-0001/vibe-home/sessions',
      VIBE_ENABLE_SUBAGENTS: 'false',
      VIBE_ENABLE_BACKGROUND_PROCESSES: 'false',
      VIBE_MANAGED_SHELL_TOOLS_ENABLED: 'false',
      VIBE_ENABLE_CONNECTORS: 'false',
      VIBE_DISABLED_SKILLS: '["*"]',
      VIBE_MCP_SERVERS: '[]',
      VIBE_ENABLE_TELEMETRY: 'false',
      VIBE_ENABLE_OTEL: 'false',
      VIBE_ENABLE_UPDATE_CHECKS: 'false',
      VIBE_ENABLE_AUTO_UPDATE: 'false',
      VIBE_EXPERIMENTAL_ENABLE_MODEL_CATALOG: 'false',
      VIBE_EXPERIMENTAL_ENABLE_REGISTRY_SKILLS: 'false',
      VIBE_EXPERIMENTS__ENABLE: 'false',
      VIBE_SESSION_LOGGING__ENABLED: 'false',
      VIBE_SESSION_LOGGING__GENERATE_TITLES: 'false',
      VIBE_BYPASS_TOOL_PERMISSIONS: 'false'
    });
  });

  it('keeps every writable location inside the run directory and carries no credential', () => {
    const plan = buildSessionConfig({ mode: 'edit', workspace, runDirectory, maxTurns: 5 });
    expect(sessionDirectories(runDirectory)).toEqual(plan.directories);
    for (const name of ['HOME', 'VIBE_HOME', 'TMPDIR', 'VIBE_SESSION_LOGGING__SAVE_DIR']) {
      expect(plan.environment[name]?.startsWith(`${runDirectory}/`), name).toBe(true);
    }
    expect(Object.keys(plan.environment).filter((name) => /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name))).toEqual([]);
    expect(Object.values(plan.environment).every((value) => typeof value === 'string')).toBe(true);
  });

  it('does not depend on the mode', () => {
    const review = buildSessionConfig({ mode: 'review', workspace, runDirectory, maxTurns: 5 });
    const edit = buildSessionConfig({ mode: 'edit', workspace, runDirectory, maxTurns: 5 });
    expect(edit.environment).toEqual(review.environment);
  });
});

describe('thinking off write', () => {
  it('is a config/model/write that only sets the reasoning effort', () => {
    expect(buildThinkingOffWrite('session-1')).toEqual({ method: 'config/model/write', params: { sessionId: 'session-1', reasoningEffort: 'off' } });
    expect(() => buildThinkingOffWrite('')).toThrow(TypeError);
  });
});

describe('read-back expectation', () => {
  it('is derived from the same values the session is started with', () => {
    const plan = buildSessionConfig({ mode: 'edit', workspace, runDirectory, maxTurns: 5 });
    expect(plan.expectation.harness).toBe('unified');
    expect(plan.expectation.cwd).toBe(workspace);
    expect(plan.expectation.tools).toEqual(plan.agentConfig.enabledTools);
    expect(plan.expectation.disabledTools).toEqual(plan.agentConfig.disabledTools);
    expect(Object.keys(plan.expectation.toolPolicies)).toEqual(plan.agentConfig.enabledTools);
    expect(plan.expectation.toolPolicies.edit).toEqual({ permission: 'ask', denylist: plan.profile.document.tools.edit?.denylist });
    const paths = plan.expectation.settings.map((setting) => setting.path.join('.'));
    expect(paths).toContain('enable_subagents');
    expect(paths).toContain('session_logging.enabled');
    expect(plan.expectation.settings.find((setting) => setting.path.join('.') === 'disabled_skills')).toEqual({ path: ['disabled_skills'], value: ['*'], match: 'includes' });
  });
});
