# Installation and usage

codex-vibe lets an MCP client delegate reviews and isolated edits to Mistral Vibe. The package is a private, unpublished release candidate; install from this checkout or a locally produced tarball rather than relying on a public npm package.

## Prerequisites

- Node.js 20.19 or newer, npm, and Git. Validation so far used Node 24.21.0 on macOS arm64.
- Mistral Vibe exactly **2.25.8**, with a working Python entrypoint. The launcher uses the Python interpreter in the installed Vibe executable's shebang and requires the matching Vibe package there.
- `vibe` on PATH, and `vibe-acp` if using ACP; executable paths can also be configured explicitly.
- Provider authentication for actual model work, using Vibe's supported credential mechanism. A local compatibility probe does not establish successful authentication.

Provision the pinned Vibe installation using your normal Python tool management process. A different Vibe version is intentionally rejected. No hosted model call is needed to install, build, validate configuration, or run the initialization probe.

## Install from the source checkout

```sh
cd /path/to/cdx-vibe
npm ci
npm run build
node dist/cli.js --version
node dist/cli.js init
```

`init` prints the configuration path and refuses to overwrite an existing configuration. On macOS the default is:

```text
~/Library/Application Support/VibeSupervisor/config.toml
```

Linux uses the XDG data directory or `~/.local/share/vibe-supervisor`; Windows uses the application data directory's `VibeSupervisor` folder. `VIBE_SUPERVISOR_HOME` overrides the config/data root. If you use that override, ensure it is also present in the MCP server's environment; shell exports alone may not reach a desktop client.

Edit the generated TOML. Keep the existing sections and limits, and set these top-level values before any table header:

```toml
version = 1
backend = "programmatic"
allowed_workspace_roots = ["/absolute/canonical/path/to/your/repository"]
```

Use the real canonical workspace path, replacing the placeholder. The initial empty allowlist denies all delegated work. If executables are not on the client process's PATH, add a paths table:

```toml
[paths]
vibe = "/absolute/path/to/vibe"
vibe_acp = "/absolute/path/to/vibe-acp"
```

See [configuration](docs/configuration.md) and [the full example](examples/config.toml) for limits and other settings. Keep shell, network tools, raw ACP logging, reasoning persistence, and temporary trust disabled.

```sh
node dist/cli.js config validate
node dist/cli.js doctor --json
node dist/cli.js test-acp
```

`test-acp` is optional for the default programmatic backend. It negotiates ACP initialization without a model prompt. Doctor can report authentication and desktop visibility as unverified even when local prerequisites pass.

## Register with Codex

Preview the MCP entry first:

```sh
node dist/cli.js configure-codex --user --dry-run
```

To register it, run:

```sh
node dist/cli.js configure-codex --user
```

This writes the `mcp_servers.vibe-supervisor` entry in the user's Codex configuration, preserving unrelated content and backing up an existing nonempty file. It points to the current Node executable and built CLI: retain those paths and rebuild after source updates. For project scope, use:

```sh
node dist/cli.js configure-codex --project --path /absolute/path/to/your/repository --dry-run
node dist/cli.js configure-codex --project --path /absolute/path/to/your/repository
```

Reload your client configuration using its normal workflow and verify that all eight tools appear. Actual Codex desktop registration has not yet been validated in this project. The plugin manifests are scaffolds and are not required evidence of a working MCP connection.

Other stdio MCP clients can launch the server directly:

```sh
node /path/to/cdx-vibe/dist/cli.js serve --stdio
```

The client owns stdin/stdout; server stdout contains protocol frames. This command is not an interactive task prompt.

## Start a review or edit

Invoke `vibe_review_start` through your MCP client with input such as:

```json
{
  "task": "Review the authentication module and report correctness issues.",
  "cwd": "/absolute/canonical/path/to/your/repository",
  "backend": "programmatic"
}
```

For an edit, call `vibe_edit_start`:

```json
{
  "task": "Fix the reported input validation bug and explain the change.",
  "cwd": "/absolute/canonical/path/to/your/repository",
  "base_ref": "HEAD",
  "backend": "programmatic",
  "allow_shell": false
}
```

Save the returned run ID. Poll `vibe_status` with `run_id`; use event sequence numbers as `after_seq` for subsequent polls. Fetch `vibe_result` with the same ID after completion. Edit artifacts include a patch, diff statistics, and changed-file paths. Inspect the patch and apply it yourself if appropriate; the supervisor does not modify the original checkout. The edit starts from the chosen Git base, not an automatic copy of source working-tree changes.

Call `vibe_cancel` to stop work or `vibe_close` to close the run. `cleanup_worktree: true` requests safe worktree removal; leave it false if you need to inspect the worker files. Cleanup is refused when exports are stale or residual data cannot be safely accounted for.

## ACP follow-up and input

ACP is opt-in: set `backend = "acp"` in config or request `"backend": "acp"` on a start tool. It adds live-session continuation and permission/input responses. Call `vibe_continue` with `run_id` and `message` when the run can accept a follow-up. For a waiting request, inspect `vibe_status` and answer its current `request_id` with `vibe_respond`; permission options must be offered IDs and satisfy policy. Expired requests cannot be reused.

The default programmatic backend has no continuation or interactive response channel. ACP session loading after a restart is conditional; the supervisor never automatically resubmits the original task. See [functionality](docs/functionality.md) for lifecycle and tool details.

## Inspect saved runs

```sh
node dist/cli.js runs list
node dist/cli.js runs show <run-id>
node dist/cli.js runs tail <run-id>
node dist/cli.js runs cleanup <run-id>
```

Replace `<run-id>` with the returned UUID. These commands are not a second live supervisor: stop the server before manager-based cleanup because storage ownership is exclusive. Run records and private histories may contain source content despite filtering; keep the data directory private.

## Build and install a local package

```sh
npm run verify:release
VIBE_SUPERVISOR_TEST_NPM_CACHE=/absolute/path/to/populated/npm-cache npm run package:rc
```

Packaging includes verification and an offline installation/MCP smoke test. It needs a populated npm cache and writes the tarball, SPDX inventory, acceptance report, and `SHA256SUMS` under `release/`. On the validated macOS machine:

```sh
cd release
shasum -a 256 -c SHA256SUMS
```

For a separate local installation prefix:

```sh
npm install --prefix /absolute/path/to/local-prefix /absolute/path/to/vibe-supervisor-0.9.0-rc.1.tgz
/absolute/path/to/local-prefix/node_modules/.bin/vibe-supervisor --version
```

That installation needs dependencies available through npm or its cache. Use `--offline` with a populated cache if network access is unavailable. Run the installed executable's `init` and `configure-codex` commands to register the installed path rather than the source build.

## Troubleshooting and limits

| Symptom | Next action |
|---|---|
| Workspace denied/invalid | Check the canonical path, allowlist, symlink boundary, and Git repository requirement for edits. |
| Unsupported Vibe/runtime | Check exact version 2.25.8 and the executable's Python installation; do not bypass the pinned shim. |
| Authentication failure | Configure credentials through Vibe's supported mechanism; never include a key in a task or MCP argument. |
| Permission denied | Inspect the correlated action; shell, unexpected tools, sensitive paths, and unsafe requests are intentionally denied. |
| Run cannot continue | Use ACP for live follow-up; verify the saved session can be loaded. Do not blindly replay an uncertain task. |
| Data directory already owned | Find and stop the existing supervisor normally; do not delete a live owner lock. |
| Worktree cleanup refused | Inspect residual files and current exported patch before retrying; preserve valuable work. |
| Tools absent in Codex | Check the generated config and executable paths, then inspect client startup diagnostics. Desktop integration remains unverified. |

Application permissions do not provide an operating-system sandbox or network firewall. Permitted file content can be sent to the model provider. Hosted inference, real hosted ACP soak, authenticated tool inventory, macOS Intel, and clean-account installation remain unverified. Read [security](docs/security.md), [compatibility](docs/compatibility.md), and [acceptance](docs/acceptance.md) before expanding use.
