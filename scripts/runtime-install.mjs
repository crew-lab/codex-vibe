import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runtimeVersions = new Map([
  ['3.0.2', 'unqualified']
]);

const allowedPythonSymlinkPattern = process.platform === 'win32'
  ? /^Scripts[/\\]python(\d+(\.\d+)?)?\.exe$/i
  : /^bin\/python(\d+(\.\d+)?)?$/;

function validVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !runtimeVersions.has(version)) throw new Error('Only explicitly catalogued Vibe versions can be planned.');
  return version;
}

async function ensureNoSymlinkPath(target, { allowMissing = true } = {}) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error(`Unsafe symlink in runtime path: ${current}`);
      if (!info.isDirectory() && current !== absolute) throw new Error(`Non-directory runtime path component: ${current}`);
    } catch (error) {
      if (error?.code === 'ENOENT' && allowMissing) continue;
      throw error;
    }
  }
  return absolute;
}

function executableFor(root) {
  return path.join(root, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'vibe.exe' : 'vibe');
}

export function planRuntimeInstall({ version, runtimeRoot, uvExecutable, pythonExecutable }) {
  validVersion(version);
  if (!path.isAbsolute(runtimeRoot) || !path.isAbsolute(uvExecutable) || !path.isAbsolute(pythonExecutable)) throw new Error('Runtime root, uv and Python paths must be absolute.');
  const isolatedRoot = path.resolve(runtimeRoot);
  const root = path.join(isolatedRoot, `vibe-${version}`);
  const executable = executableFor(root);
  const python = path.join(root, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const commands = [
    { executable: uvExecutable, args: ['venv', '--link-mode', 'copy', '--python', pythonExecutable, root] },
    { executable: uvExecutable, args: ['pip', 'install', '--offline', '--python', python, `mistral-vibe==${version}`] }
  ];
  return Object.freeze({ version, qualification: runtimeVersions.get(version), runtimeRoot: isolatedRoot, root, executable, python, uvExecutable, pythonExecutable, commands });
}

async function hashTree(root, { realPython, pythonSha256 } = {}) {
  const rows = [];
  let totalBytes = 0;
  const deadline = Date.now() + 60_000;
  const visit = async (directory) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (Date.now() > deadline || rows.length >= 50_000) throw new Error('Installed runtime manifest exceeded its inspection bounds.');
      const file = path.join(directory, entry.name);
      const stat = await lstat(file);
      const relativePath = path.relative(root, file).split(path.sep).join('/');
      if (stat.isSymbolicLink()) {
        if (!allowedPythonSymlinkPattern.test(relativePath) || !realPython) {
          throw new Error(`Installed runtime contains an unauthorized symlink: ${file}`);
        }
        const linkTarget = await readlink(file);
        const resolved = await realpath(file).catch(() => null);
        if (resolved !== realPython) {
          throw new Error(`Python symlink ${file} does not resolve to the configured interpreter.`);
        }
        rows.push({
          path: relativePath,
          linkTarget,
          sha256: pythonSha256,
          isInterpreterSymlink: true
        });
      } else if (stat.isDirectory()) {
        await visit(file);
      } else if (stat.isFile()) {
        totalBytes += stat.size;
        if (totalBytes > 2 * 1024 * 1024 * 1024) throw new Error('Installed runtime manifest exceeded its byte bound.');
        rows.push({
          path: relativePath,
          sha256: createHash('sha256').update(await readFile(file)).digest('hex')
        });
      } else {
        throw new Error(`Installed runtime contains a special file: ${file}`);
      }
    }
  };
  await visit(root);
  return rows;
}

async function makeImmutable(root) {
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const stat = await lstat(target);
      if (stat.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(target);
        await chmod(target, 0o500);
      } else {
        await chmod(target, stat.mode & 0o555);
      }
    }
  };
  await visit(root);
  await chmod(root, 0o500);
}

export async function removeOwnedTree(root) {
  const visit = async (directory) => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    await chmod(directory, 0o700).catch(() => {});
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const stat = await lstat(target).catch(() => null);
      if (!stat) continue;
      if (stat.isSymbolicLink()) await rm(target, { force: true });
      else if (stat.isDirectory()) await visit(target);
      else await chmod(target, 0o600).catch(() => {});
    }
  };
  await visit(root);
  await rm(root, { recursive: true, force: true });
}

async function acquireInstallLock(runtimeRoot, version) {
  const lockPath = path.join(runtimeRoot, `.vibe-${version}.install.lock`);
  let handle;
  try {
    handle = await open(lockPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`A Vibe ${version} installation lock already exists; inspect it before retrying.`);
    throw error;
  }
  const info = await handle.stat();
  if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
    await handle.close();
    throw new Error('Runtime installation lock is unsafe.');
  }
  const identity = { dev: info.dev, ino: info.ino };
  await handle.writeFile(`${JSON.stringify({ version, pid: process.pid })}\n`);
  return async () => {
    await handle.close().catch(() => {});
    const current = await lstat(lockPath).catch(() => null);
    if (current && current.isFile() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) await rm(lockPath, { force: true });
  };
}

function run(executable, args, timeoutMs = 600_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: path.dirname(executable), HOME: process.env.HOME ?? '', UV_NO_CONFIG: '1' } });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('close', () => clearTimeout(timeout));
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Runtime install command failed with exit code ${code}${stderr ? `: ${stderr.trim()}` : ''}.`)));
  });
}

function readVersion(executable) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: path.dirname(executable), HOME: '', UV_NO_CONFIG: '1' } });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      const match = /^vibe (\d+\.\d+\.\d+)\s*$/m.exec(output);
      if (code === 0 && match) resolve(match[1]);
      else reject(new Error('Installed Vibe executable did not report a valid version.'));
    });
  });
}

function readPythonVersion(executable) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-V'], { stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: path.dirname(executable), HOME: '', UV_NO_CONFIG: '1' } });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      const match = /^Python (\d+\.\d+\.\d+.*)$/m.exec(output.trim());
      if (code === 0 && match) resolve(match[1]);
      else reject(new Error('Python executable did not report a valid version.'));
    });
  });
}

export async function applyRuntimeInstall(plan, { runCommand = run, inspectVersion = readVersion, inspectPythonVersion = readPythonVersion } = {}) {
  validVersion(plan.version);
  const expected = planRuntimeInstall({ version: plan.version, runtimeRoot: plan.runtimeRoot, uvExecutable: plan.uvExecutable, pythonExecutable: plan.pythonExecutable });
  if (JSON.stringify(plan) !== JSON.stringify(expected)) throw new Error('Runtime plan does not match its versioned installation paths and commands.');
  if (plan.qualification !== runtimeVersions.get(plan.version)) throw new Error('Runtime qualification cannot be changed by an installation plan.');
  const runtimeRoot = await ensureNoSymlinkPath(plan.runtimeRoot);
  const parentInfo = await lstat(path.dirname(runtimeRoot));
  const parentIsTrusted = parentInfo.isDirectory() && !parentInfo.isSymbolicLink() &&
    (parentInfo.uid === process.getuid?.() || parentInfo.uid === 0) &&
    ((parentInfo.mode & 0o022) === 0 || (parentInfo.uid === 0 && (parentInfo.mode & 0o1000) !== 0));
  if (!parentIsTrusted) throw new Error('Runtime parent must be user-owned or a protected system directory.');
  try { await mkdir(runtimeRoot, { mode: 0o700 }); } catch (error) { if (error?.code !== 'EEXIST') throw error; }
  const rootInfo = await lstat(runtimeRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || rootInfo.uid !== process.getuid?.() || (rootInfo.mode & 0o077) !== 0) throw new Error('Runtime root must be an owner-private directory owned by the current user.');
  const root = await ensureNoSymlinkPath(plan.root);
  if (plan.commands.length !== 2 || plan.commands.some((command) => !path.isAbsolute(command.executable))) throw new Error('Runtime plan commands are invalid.');
  const realPython = await realpath(plan.pythonExecutable);
  const pythonStat = await lstat(realPython);
  if (!pythonStat.isFile()) throw new Error(`Python executable is not a regular file: ${realPython}`);
  const pythonBytes = await readFile(realPython);
  const pythonSha256 = createHash('sha256').update(pythonBytes).digest('hex');
  const pythonVersion = await inspectPythonVersion(plan.pythonExecutable);
  if (!pythonVersion || typeof pythonVersion !== 'string' || !/^\d+\.\d+/.test(pythonVersion)) {
    throw new Error(`Unable to determine valid Python version for: ${plan.pythonExecutable}`);
  }
  const interpreterBinding = {
    type: 'external-verified',
    executable: plan.pythonExecutable,
    resolvedExecutable: realPython,
    sha256: pythonSha256,
    version: pythonVersion
  };
  const releaseInstallLock = await acquireInstallLock(runtimeRoot, plan.version);
  let ownedIdentity;
  try {
    try { await lstat(root); throw new Error('Versioned runtime already exists and is immutable.'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    try { await runCommand(plan.commands[0].executable, plan.commands[0].args); } catch (error) {
      const partial = await lstat(root).catch(() => null);
      if (partial?.isDirectory() && !partial.isSymbolicLink() && partial.uid === process.getuid?.()) ownedIdentity = { dev: partial.dev, ino: partial.ino };
      throw error;
    }
    const createdInfo = await lstat(root);
    if (!createdInfo.isDirectory() || createdInfo.isSymbolicLink() || createdInfo.uid !== process.getuid?.()) throw new Error('uv did not create a user-owned runtime directory.');
    ownedIdentity = { dev: createdInfo.dev, ino: createdInfo.ino };
    await runCommand(plan.commands[1].executable, plan.commands[1].args);
    await assertOwnedRoot(root, ownedIdentity);
    const reportedVersion = await inspectVersion(plan.executable);
    if (reportedVersion !== plan.version) throw new Error('Installed Vibe version did not match the requested version.');
    const entries = await hashTree(root, { realPython, pythonSha256 });
    await assertOwnedRoot(root, ownedIdentity);
    const manifest = { format: 1, version: plan.version, qualification: runtimeVersions.get(plan.version), executable: path.relative(root, plan.executable).split(path.sep).join('/'), interpreterBinding, entries };
    manifest.sha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    await writeFile(path.join(root, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await assertOwnedRoot(root, ownedIdentity);
    await makeImmutable(root);
    const finalizedVersion = await inspectVersion(plan.executable);
    if (finalizedVersion !== plan.version) throw new Error('Finalized Vibe executable did not report the installed version.');
    return { version: plan.version, qualification: manifest.qualification, executable: plan.executable, manifestSha256: manifest.sha256, interpreterBinding, entries: entries.length };
  } catch (error) {
    if (ownedIdentity) {
      try {
        await assertOwnedRoot(root, ownedIdentity);
        await removeOwnedTree(root);
      } catch {}
    }
    throw error;
  } finally {
    await releaseInstallLock();
  }
}

async function assertOwnedRoot(root, expected) {
  const current = await lstat(root);
  if (current.isSymbolicLink() || !current.isDirectory() || current.uid !== process.getuid?.() || current.dev !== expected.dev || current.ino !== expected.ino) throw new Error('Runtime directory ownership or identity changed during installation.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  let version;
  let runtimeRoot;
  let uvExecutable;
  let pythonExecutable;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version' && i + 1 < args.length) version = args[++i];
    else if (args[i] === '--runtime-root' && i + 1 < args.length) runtimeRoot = path.resolve(args[++i]);
    else if (args[i] === '--uv' && i + 1 < args.length) uvExecutable = path.resolve(args[++i]);
    else if (args[i] === '--python' && i + 1 < args.length) pythonExecutable = path.resolve(args[++i]);
  }
  if (!version || !runtimeRoot || !uvExecutable || !pythonExecutable) {
    process.stderr.write('Usage: node scripts/runtime-install.mjs --version <version> --runtime-root <dir> --uv <path> --python <path>\n');
    process.exit(2);
  }
  const plan = planRuntimeInstall({ version, runtimeRoot, uvExecutable, pythonExecutable });
  applyRuntimeInstall(plan)
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
      process.exit(1);
    });
}
