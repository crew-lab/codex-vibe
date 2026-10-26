import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyRuntimeInstall, planRuntimeInstall } from '../../scripts/runtime-install.mjs';

const roots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(path.join('/private/tmp', 'vibe-runtime-install-'));
  roots.push(root);
  return root;
}

function resolveUv(): string | null {
  if (process.env.VIBE_TEST_UV && existsSync(process.env.VIBE_TEST_UV)) return process.env.VIBE_TEST_UV;
  try {
    const stdout = execFileSync('which', ['uv'], { encoding: 'utf8' }).trim();
    if (stdout && existsSync(stdout)) return stdout;
  } catch {}
  return null;
}

function resolvePython312(uv: string): string | null {
  if (process.env.VIBE_TEST_PYTHON && existsSync(process.env.VIBE_TEST_PYTHON)) return process.env.VIBE_TEST_PYTHON;
  try {
    const stdout = execFileSync(uv, ['python', 'find', '3.12'], { encoding: 'utf8' }).trim();
    if (stdout && existsSync(stdout)) return stdout;
  } catch {}
  return null;
}

const discoveredUv = resolveUv();
const discoveredPython = discoveredUv ? resolvePython312(discoveredUv) : null;

afterEach(async () => {
  const cleanup = async (root: string) => {
    const visit = async (directory: string) => {
      await chmod(directory, 0o700).catch(() => {});
      for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
        const target = path.join(directory, entry.name);
        const stat = await lstat(target).catch(() => null);
        if (stat?.isDirectory() && !stat.isSymbolicLink()) await visit(target);
        else if (stat && !stat.isSymbolicLink()) await chmod(target, 0o600).catch(() => {});
      }
    };
    await visit(root);
    await rm(root, { recursive: true, force: true });
  };
  await Promise.all(roots.splice(0).map(cleanup));
});

describe('isolated Vibe runtime install planning', () => {
  it('plans only the exact 3.0.2 environment and keeps it unqualified', () => {
    const plan = planRuntimeInstall({ version: '3.0.2', runtimeRoot: '/private/runtime', uvExecutable: '/bin/uv', pythonExecutable: '/bin/python3' });
    expect(plan).toMatchObject({ qualification: 'unqualified', executable: '/private/runtime/vibe-3.0.2/bin/vibe' });
    expect(plan.commands.map((command) => command.executable)).toEqual(['/bin/uv', '/bin/uv']);
    expect(plan.commands[0].args).toContain('--link-mode');
    expect(plan.commands[0].args).toContain('copy');
    expect(plan.commands[0].args).toContain(plan.root);
    expect(plan.commands[1].args).toContain('--offline');
    expect(plan.commands[1].args).toContain('mistral-vibe==3.0.2');
    expect(() => planRuntimeInstall({ version: '2.26.1', runtimeRoot: '/private/runtime', uvExecutable: '/bin/uv', pythonExecutable: '/bin/python3' })).toThrow();
    expect(() => planRuntimeInstall({ version: '3.0.3', runtimeRoot: '/private/runtime', uvExecutable: '/bin/uv', pythonExecutable: '/bin/python3' })).toThrow();
  });

  it('applies only into a new private version directory and records immutable identity', async () => {
    const parent = await tempRoot();
    const mockPython = path.join(parent, 'fake-python');
    await writeFile(mockPython, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const plan = planRuntimeInstall({ version: '3.0.2', runtimeRoot: path.join(parent, 'runtimes'), uvExecutable: '/bin/uv', pythonExecutable: mockPython });
    const calls: string[][] = [];
    const result = await applyRuntimeInstall(plan, {
      inspectPythonVersion: async () => '3.12.0',
      runCommand: async (executable: string, args: string[]) => {
        calls.push([executable, ...args]);
        if (calls.length === 1) await mkdir(path.join(plan.root, 'bin'), { recursive: true, mode: 0o700 });
        if (calls.length === 2) {
          const executable = path.join(plan.root, 'bin', 'vibe');
          await writeFile(executable, '#!/bin/sh\nprintf "vibe 3.0.2\\n"\n');
          await chmod(executable, 0o755);
          await writeFile(path.join(plan.root, 'package.txt'), 'mistral-vibe 3.0.2');
        }
      },
    });
    expect(calls[1]).toContain(path.join(plan.root, 'bin', 'python'));
    expect(result).toMatchObject({ version: '3.0.2', qualification: 'unqualified', executable: plan.executable, entries: 2, interpreterBinding: { type: 'external-verified' } });
    const manifest = JSON.parse(await readFile(path.join(plan.root, 'runtime-manifest.json'), 'utf8')) as { sha256: string; qualification: string; interpreterBinding: { type: string; executable: string } };
    expect(manifest.sha256).toBe(result.manifestSha256);
    expect(manifest.qualification).toBe('unqualified');
    expect(manifest.interpreterBinding.type).toBe('external-verified');
    expect(manifest.interpreterBinding.executable).toBe(mockPython);
    expect((await readFile(plan.executable, 'utf8')).startsWith('#!/bin/sh')).toBe(true);
    await expect(applyRuntimeInstall(plan, { inspectPythonVersion: async () => '3.12.0', runCommand: async () => { throw new Error('must not overwrite'); } })).rejects.toThrow('already exists');
  });

  it('fails closed when interpreter does not exist, is not a regular file, or version cannot be read', async () => {
    const parent = await tempRoot();
    const missingPython = path.join(parent, 'missing-python');
    const planMissing = planRuntimeInstall({ version: '3.0.2', runtimeRoot: path.join(parent, 'runtimes'), uvExecutable: '/bin/uv', pythonExecutable: missingPython });
    await expect(applyRuntimeInstall(planMissing, { runCommand: async () => {} })).rejects.toThrow();

    const dirPython = path.join(parent, 'dir-python');
    await mkdir(dirPython);
    const planDir = planRuntimeInstall({ version: '3.0.2', runtimeRoot: path.join(parent, 'runtimes'), uvExecutable: '/bin/uv', pythonExecutable: dirPython });
    await expect(applyRuntimeInstall(planDir, { runCommand: async () => {} })).rejects.toThrow(/not a regular file/);

    const validPython = path.join(parent, 'valid-python');
    await writeFile(validPython, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const planBadVersion = planRuntimeInstall({ version: '3.0.2', runtimeRoot: path.join(parent, 'runtimes'), uvExecutable: '/bin/uv', pythonExecutable: validPython });
    await expect(applyRuntimeInstall(planBadVersion, { inspectPythonVersion: async () => 'unknown', runCommand: async () => {} })).rejects.toThrow(/Unable to determine valid Python version/);
  });

  it('refuses a symlinked version directory and removes failed staging output', async () => {
    const parent = await tempRoot();
    const external = path.join(parent, 'existing-runtime');
    await mkdir(external);
    const mockPython = path.join(parent, 'fake-python');
    await writeFile(mockPython, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const plan = planRuntimeInstall({ version: '3.0.2', runtimeRoot: path.join(parent, 'runtimes'), uvExecutable: '/bin/uv', pythonExecutable: mockPython });
    await mkdir(plan.runtimeRoot, { mode: 0o700 });
    await symlink(external, plan.root);
    await expect(applyRuntimeInstall(plan, { inspectPythonVersion: async () => '3.12.0', runCommand: async () => {} })).rejects.toThrow('symlink');
  });

  it('rejects changed commands and removes a partial new installation after failure', async () => {
    const parent = await tempRoot();
    const mockPython = path.join(parent, 'fake-python');
    await writeFile(mockPython, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const plan = planRuntimeInstall({ version: '3.0.2', runtimeRoot: path.join(parent, 'runtimes'), uvExecutable: '/bin/uv', pythonExecutable: mockPython });
    const changed = { ...plan, commands: [{ executable: '/bin/other', args: [] }, ...plan.commands.slice(1)] };
    await expect(applyRuntimeInstall(changed, { inspectPythonVersion: async () => '3.12.0', runCommand: async () => {} })).rejects.toThrow('does not match');
    await expect(applyRuntimeInstall(plan, {
      inspectPythonVersion: async () => '3.12.0',
      runCommand: async () => { await mkdir(path.join(plan.root, 'partial'), { recursive: true }); throw new Error('install failed'); }
    })).rejects.toThrow('install failed');
    await expect(readFile(path.join(plan.root, 'partial'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('lets only one concurrent installer create a versioned runtime', async () => {
    const parent = await tempRoot();
    const mockPython = path.join(parent, 'fake-python');
    await writeFile(mockPython, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const plan = planRuntimeInstall({ version: '3.0.2', runtimeRoot: path.join(parent, 'runtimes'), uvExecutable: '/bin/uv', pythonExecutable: mockPython });
    let release!: () => void;
    const started = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const enteredFirst = new Promise<void>((resolve) => { entered = resolve; });
    const first = applyRuntimeInstall(plan, {
      inspectPythonVersion: async () => '3.12.0',
      runCommand: async (_executable: string, args: string[]) => {
        if (args[0] === 'venv') {
          await mkdir(path.join(plan.root, 'bin'), { recursive: true, mode: 0o700 });
          entered();
          await started;
          return;
        }
        await writeFile(plan.executable, '#!/bin/sh\nprintf "vibe 3.0.2\\n"\n', { mode: 0o700 });
      }
    });
    await enteredFirst;
    await expect(applyRuntimeInstall(plan, { inspectPythonVersion: async () => '3.12.0', runCommand: async () => { throw new Error('second installer must not run'); } })).rejects.toThrow('installation lock already exists');
    release();
    await expect(first).resolves.toMatchObject({ version: '3.0.2' });
  });

  it.runIf(Boolean(discoveredUv && discoveredPython))('performs a real offline runtime installation with discovered uv', async () => {
    const parent = await tempRoot();
    const plan = planRuntimeInstall({
      version: '3.0.2',
      runtimeRoot: path.join(parent, 'runtimes'),
      uvExecutable: discoveredUv!,
      pythonExecutable: discoveredPython!
    });
    const result = await applyRuntimeInstall(plan);
    expect(result.version).toBe('3.0.2');
    expect(result.qualification).toBe('unqualified');
    expect(result.executable).toBe(plan.executable);
    expect(result.interpreterBinding).toMatchObject({
      type: 'external-verified',
      executable: discoveredPython!
    });
    expect(result.entries).toBeGreaterThan(100);

    const manifest = JSON.parse(await readFile(path.join(plan.root, 'runtime-manifest.json'), 'utf8')) as {
      sha256: string;
      qualification: string;
      interpreterBinding: { type: string; executable: string; sha256: string; version: string };
      entries: Array<{ path: string; isInterpreterSymlink?: boolean }>;
    };
    expect(manifest.sha256).toBe(result.manifestSha256);
    expect(manifest.interpreterBinding.type).toBe('external-verified');
    expect(manifest.interpreterBinding.executable).toBe(discoveredPython!);
    expect(manifest.interpreterBinding.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.interpreterBinding.version).toMatch(/^3\.12\./);
    const pythonEntry = manifest.entries.find((e) => e.path === 'bin/python');
    expect(pythonEntry?.isInterpreterSymlink).toBe(true);

    const versionOutput = execFileSync(result.executable, ['--version'], { encoding: 'utf8' });
    expect(versionOutput.trim()).toBe('vibe 3.0.2');
  });
});
