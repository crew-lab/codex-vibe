# vibe-supervisor

A local MCP server that lets Codex delegate code reviews and isolated edits to Mistral Vibe. Reviews are read-only. Edits run in a detached Git worktree and come back as a patch that you apply yourself.

This is an application-level policy boundary, **not an operating-system sandbox**: it validates workspaces, filters the worker's environment and tools and bounds its output, but a delegated run still executes with your account's permissions and permitted file content goes to Mistral. The package is a private, unpublished release candidate (MIT licensed).

## Prerequisites

1. macOS, Node.js 20.19 or newer, npm and Git.
2. Mistral Vibe, pinned to exactly 2.25.8 (any other version is refused):

   ```sh
   uv tool install mistral-vibe==2.25.8
   ```

3. Sign in once: run `vibe` in a terminal and finish the browser login. No Studio API key is needed.

## Install

From a GitHub Release (see the [releases page](https://github.com/crew-lab/codex-vibe/releases)), download the tarball and `SHA256SUMS` into one directory, then:

```sh
shasum -a 256 -c SHA256SUMS
npm install -g ./vibe-supervisor-<version>.tgz
vibe-supervisor --version
```

From a source checkout (a Git URL install is not supported):

```sh
npm ci
npm link
```

`npm ci` builds `dist/` through the `prepare` script.

## Set up

```sh
vibe-supervisor setup --workspace /absolute/path/to/your/repository
```

`setup` creates the private config if it is missing, adds the canonical workspace to the allowlist (existing entries are never broadened), records `vibe` and `vibe-acp` from your PATH, runs `doctor` and prints only the checks that are not PASS, then shows the Codex MCP entry. It writes `~/.codex/config.toml` only after you confirm, or with `--yes`; without a terminal and without `--yes` it only prints. Use `--codex project` for a project-scoped entry and `--isolated` when several Codex clients must run at once (see [How it works](docs/functionality.md#independent-clients)).

Add another repository later with `vibe-supervisor allow <dir>`. Check the installation at any time with `vibe-supervisor doctor`; it makes no model request.

Restart Codex so it starts the server, then check that the Vibe tools are listed.

## Use it

Give the coordinator the absolute repository path, a concrete task and acceptance criteria.

First review:

> Use Vibe to review `/absolute/path/to/repo` for correctness bugs in the authentication module. Read only. Report findings with file and line, and tell me if the review stopped early.

First edit:

> Use Vibe to fix the input validation bug in `/absolute/path/to/repo/src/validate.ts` in an isolated worktree from `HEAD`. Show me the patch and run the tests yourself before I apply anything.

The coordinator starts the run with `wait_seconds`, calls `vibe_status` with `wait_seconds` until the result appears, then calls `vibe_close`. A result contains:

- `state` and `stop_reason`: a `completed` run whose `stop_reason` is not `end_turn` stopped early and may be partial.
- `summary`, `warnings` and, for reviews, `integrity`: whether the source workspace changed during the review.
- For edits, `changed_files`, `diff_stat` and the patch (inline when small, otherwise at `patch_path`).
- `next_action`, a one-sentence instruction for the next call.

Patches are never applied, committed, merged or pushed automatically. Worker shell and network tools are disabled, so the coordinator runs verification. An edit starts from the chosen Git base; uncommitted changes in your checkout are not copied into the worktree. Details are in the [reference](docs/reference.md) and the [error codes](docs/errors.md).

## Skills

Two coordinator skills ship in `skills/`: `vibe-supervisor` (the default start, wait, read, close loop) and `vibe-acp` (corrections with `vibe_continue` on the ACP backend). To make them discoverable to Codex, link them into the user skills directory; this changes user-global discovery, so review it first:

```sh
skills_dir="$HOME/.agents/skills"
mkdir -p "$skills_dir"
ln -s "$(npm root -g)/vibe-supervisor/skills/vibe-supervisor" "$skills_dir/vibe-supervisor"
ln -s "$(npm root -g)/vibe-supervisor/skills/vibe-acp" "$skills_dir/vibe-acp"
```

From a clone, link `skills/vibe-supervisor` and `skills/vibe-acp` from the repository root instead. Do not create `.agents/` or `.vibe/` inside a delegated workspace: the supervisor refuses workspaces that contain them.

## Troubleshooting

| Symptom | Next action |
|---|---|
| `doctor` reports an unsupported or missing Vibe | Install exactly 2.25.8 with `uv tool install mistral-vibe==2.25.8`, or set `[paths]` in the config. |
| `VSUP_WORKSPACE_INVALID` | The path must exist, be a real directory and sit under an allowed root: `vibe-supervisor allow <dir>`. |
| `VSUP_AUTH_REQUIRED` | Run `vibe` in a terminal and sign in again; never put a key in a task. |
| Tools absent in Codex | Restart Codex; check `[mcp_servers.vibe-supervisor]` in `~/.codex/config.toml` and the client's startup log. |
| `VSUP_INVALID_STATE` naming a lock | Another supervisor owns the data directory. Stop it, or register with `--isolated`; never delete a live lock. |
| `vibe_continue` or `vibe_respond` missing | They exist only when `backend` is `acp` or `auto` in the config. |
| Run ended early | Read `stop_reason` and `warnings`; raise `max_turns` or `timeout_seconds`, or narrow the task. |
| Worktree not removed on close | The patch no longer matches the worktree or residual files exist; inspect `worktree_retained_reason`. |

Every code has a remedy in [docs/errors.md](docs/errors.md).

## Security

The supervisor accepts only canonical workspaces under an explicit allowlist (empty by default), gives each run a private `HOME` and `VIBE_HOME` and a filtered environment, enables only read and search for reviews, keeps shell and network tools off with no switch to turn them on, redacts what it persists and bounds time and output. Review every patch before applying it. See [docs/security.md](docs/security.md) and [SECURITY.md](SECURITY.md).

## Status and plugin scaffold

Desktop registration and hosted review and edit runs are verified on macOS arm64. Hosted ACP lifecycle, soak, Intel, clean-account installation and plugin installation are not; the single list is in [docs/compatibility.md](docs/compatibility.md#unverified-gates). `.codex-plugin/` and `.mcp.json` in the repository are a scaffold only and are not part of the package.

## Documentation

- [Reference](docs/reference.md): tools, fields, results, configuration keys and CLI.
- [How it works](docs/functionality.md): lifecycle, recovery, storage and isolation.
- [Error codes](docs/errors.md), [security](docs/security.md), [compatibility](docs/compatibility.md), [changelog](CHANGELOG.md).
- [Contributor instructions](https://github.com/crew-lab/codex-vibe/blob/main/AGENTS.md) and [implementation handoff](https://github.com/crew-lab/codex-vibe/blob/main/Handoff.md) in the repository.
