import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distBackends = path.join(root, 'dist', 'backends');
const fixturePath = path.join(root, 'src', 'backends', 'runtime', 'test_vibe_supervisor_launcher.py');
const shimPath = path.join(root, 'src', 'backends', 'runtime', 'vibe_supervisor_launcher.py');

const HELP = `Usage: node scripts/compat-probe.mjs [options]

Revalidate an installed Mistral Vibe against the versions this supervisor is pinned to.
Requires a built tree (npm run build) and a real Vibe install. No prompt is sent and no key is used.

Options:
  --vibe <path>       vibe executable (default: resolved from PATH)
  --vibe-acp <path>   vibe-acp executable (default: resolved from PATH)
  --python <path>     Vibe Python interpreter (default: from the vibe entrypoint shebang)
  --out <file>        also write the JSON report to this file (always printed to stdout)
  --help              show this help

Exit code is non-zero when any check is FAIL. MANUAL and SKIPPED do not fail the run.
`;

function parseOptions(argv) {
  return parseArgs({
    args: argv,
    options: {
      vibe: { type: 'string' }, 'vibe-acp': { type: 'string' }, python: { type: 'string' },
      out: { type: 'string' }, help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  }).values;
}

function check(name, status, detail) { return { name, status, detail }; }

async function loadDist() {
  try { await access(path.join(distBackends, 'acp.js')); }
  catch { throw new Error('dist/ is missing: run npm run build first'); }
  const load = (relative) => import(new URL(`file://${path.join(root, 'dist', relative)}`).href);
  const [pinned, acp, programmatic, launcher, redaction, environment] = await Promise.all([
    load('backends/pinned.js'), load('backends/acp.js'), load('backends/programmatic.js'),
    load('backends/launcher.js'), load('security/redaction.js'), load('security/environment.js'),
  ]);
  return { pinned, acp, programmatic, launcher, redaction, environment };
}

function runProcess(command, args, env, timeoutMs) {
  return new Promise((resolve) => {
    let output = '';
    const limit = 64 * 1024;
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = (chunk) => { if (output.length < limit) output += chunk.toString('utf8'); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, output: String(error) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, output }); });
  });
}

async function shimPin() {
  const text = await readFile(shimPath, 'utf8');
  return text.match(/^EXPECTED_VERSION\s*=\s*"([^"]+)"/m)?.[1];
}

const MANUAL_TOOL_PATH = 'Run with the Vibe Python interpreter against the installed package (vibe/core/tools/builtins/read_file.py, grep.py, vibe/core/tools/utils.py): configure read_file and grep with permission never, allowlist [<root>, <root>/**] and denylist including <root>/.env, <root>/.env.*, <root>/**/.env; then invoke the stock path resolver for an in-root file (expect ALWAYS) and for an outside path, a symlink inside the root pointing outside, and <root>/.env (expect NEVER for each). Internal API is not documented precisely enough in docs/compatibility.md to automate without guessing.';
const MANUAL_INVENTORY = 'Needs an authenticated hosted Vibe session: start a review run on a throwaway repository and record the effective tool inventory (expect only read_file and grep), the active mode (plan), untrusted workspace trust, and the permission-request count. Roadmap Phase 3 in Handoff.md.';
const MANUAL_HOSTED = 'Needs authenticated hosted inference: run one hosted review and one hosted edit on a throwaway repository and record chunk shapes. Roadmap Phase 3 in Handoff.md.';

export async function runChecks(options) {
  const dist = await loadDist();
  const { pinned, acp, programmatic, launcher, redaction, environment } = dist;
  const redact = (value) => redaction.redactSecrets(String(value));
  const paths = {};
  if (options.vibe) paths.vibe = options.vibe;
  if (options['vibe-acp']) paths.vibeAcp = options['vibe-acp'];
  const config = { paths };
  const childEnv = environment.buildChildEnvironment();
  const resolve = async (command) => {
    try { return await launcher.resolveCommand(command, childEnv); } catch { return null; }
  };
  const vibePath = await resolve(options.vibe ?? 'vibe');
  const vibeAcpPath = await resolve(options['vibe-acp'] ?? 'vibe-acp');

  let python = options.python ?? null;
  let pythonDetail = options.python ? 'from --python' : '';
  if (!python) {
    for (const entrypoint of [vibePath, vibeAcpPath]) {
      if (!entrypoint) continue;
      try { python = await launcher.pythonFor(entrypoint, childEnv); pythonDetail = 'from entrypoint shebang'; break; }
      catch (error) { pythonDetail = redact(error instanceof Error ? error.message : error); }
    }
  }

  const checks = [];

  const cli = await new programmatic.ProgrammaticBackend(config).probe();
  const cliPass = cli.available && cli.version === pinned.SUPPORTED_VIBE;
  checks.push(check('vibe_cli_version', cliPass ? 'PASS' : 'FAIL', cliPass
    ? `vibe --version reports ${cli.version}`
    : redact(`Expected Vibe ${pinned.SUPPORTED_VIBE}; ${cli.version ? `found ${cli.version}` : `could not run vibe (${JSON.stringify(cli.details ?? {})})`}`)));

  class OverridingAcpBackend extends acp.AcpBackend {
    async buildLaunch(args, profile, runDirectory) {
      const launch = await super.buildLaunch(args, profile, runDirectory);
      return python && options.python ? { ...launch, command: python } : launch;
    }
  }

  let acpPass = false;
  let acpProbe;
  if (!cliPass) {
    checks.push(check('acp_initialize', 'SKIPPED', 'Requires vibe_cli_version to pass.'));
  } else {
    acpProbe = await new OverridingAcpBackend(config).probe();
    const version = acpProbe.version;
    const protocol = acpProbe.details?.protocolVersion;
    acpPass = acpProbe.available && version === pinned.SUPPORTED_VIBE && protocol === pinned.ACP_PROTOCOL_VERSION;
    checks.push(check('acp_initialize', acpPass ? 'PASS' : 'FAIL', acpPass
      ? `ACP initialize under isolated HOME/VIBE_HOME through the pinned shim: Vibe ${version}, protocolVersion ${protocol}`
      : redact(`Expected Vibe ${pinned.SUPPORTED_VIBE} with protocolVersion ${pinned.ACP_PROTOCOL_VERSION}; found version ${version ?? 'none'}, protocolVersion ${protocol ?? 'none'} (${JSON.stringify(acpProbe.details ?? {})})`)));
  }

  if (!acpPass) checks.push(check('acp_load_session_advertised', 'SKIPPED', 'Requires acp_initialize to pass.'));
  else {
    const advertised = acpProbe.details?.loadSession === true;
    checks.push(check('acp_load_session_advertised', advertised ? 'PASS' : 'FAIL', advertised
      ? 'initialize advertised agentCapabilities.loadSession = true'
      : 'initialize did not advertise agentCapabilities.loadSession = true; session recovery must stay disabled'));
  }

  if (!cliPass || !python) {
    checks.push(check('launcher_logger_fixture', 'SKIPPED', !cliPass ? 'Requires vibe_cli_version to pass.' : `No Vibe Python interpreter resolved (${pythonDetail || 'no entrypoint'}).`));
  } else {
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'vibe-compat-probe-'));
    try {
      const env = { ...childEnv, HOME: scratch, VIBE_HOME: path.join(scratch, 'vibe-home'), VIBE_ACP_LOGGING_ENABLED: '0' };
      const result = await runProcess(python, [fixturePath], env, 120_000);
      const tail = redact(result.output.trim().split('\n').slice(-6).join('\n'));
      checks.push(check('launcher_logger_fixture', result.code === 0 ? 'PASS' : 'FAIL', result.code === 0
        ? 'test_vibe_supervisor_launcher.py passed against the installed Vibe logger'
        : `test_vibe_supervisor_launcher.py exited ${result.code}: ${tail}`));
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }

  checks.push(check('tool_path_resolver', 'MANUAL', MANUAL_TOOL_PATH));
  checks.push(check('effective_tool_inventory', 'MANUAL', MANUAL_INVENTORY));
  checks.push(check('hosted_inference', 'MANUAL', MANUAL_HOSTED));

  const shim = await shimPin();
  checks.push(check('shim_pin_consistent', shim === pinned.SUPPORTED_VIBE ? 'PASS' : 'FAIL', shim === pinned.SUPPORTED_VIBE
    ? `launcher shim EXPECTED_VERSION matches ${pinned.SUPPORTED_VIBE}`
    : `launcher shim EXPECTED_VERSION ${shim ?? 'unreadable'} differs from ${pinned.SUPPORTED_VIBE}`));

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    os_release: os.release(),
    arch: process.arch,
    pinned: { vibe: pinned.SUPPORTED_VIBE, acp_protocol: pinned.ACP_PROTOCOL_VERSION, shim_expected_version: shim ?? null },
    executables: { vibe: vibePath, vibe_acp: vibeAcpPath, python: python ?? null, python_source: pythonDetail || null },
    checks,
  };
}

async function main() {
  let options;
  try { options = parseOptions(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n\n${HELP}`); process.exitCode = 2; return; }
  if (options.help) { process.stdout.write(HELP); return; }
  let report;
  try { report = await runChecks(options); }
  catch (error) { process.stderr.write(`compat-probe: ${error.message}\n`); process.exitCode = 2; return; }
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out) await writeFile(path.resolve(options.out), text, { mode: 0o600 });
  process.stdout.write(text);
  if (report.checks.some((entry) => entry.status === 'FAIL')) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
