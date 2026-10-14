# Security model

The supervisor applies workspace, process, persistence, and output controls around Vibe. These controls are **not an operating-system sandbox**. A worker runs with the local account's process permissions, and allowed workspace content is sent to Mistral. Treat delegation as code execution with your account's access.

## Workspace and tool scope

- The canonical workspace allowlist is explicit and starts empty. Invalid, unsafe, glob-containing, symlinked, and out-of-root paths fail closed.
- The selected configuration file is the only policy authority. It is reread and validated (regular file up to 1 MiB, no symlink, no symlinked parents, owned by the current user, not group- or world-writable, strict schema, unique in-scope roots) before each readiness check and start. Failure denies; a root whose directory no longer exists is dropped from the effective allowlist and denies only itself, while a symlinked or over-broad root still invalidates the file; nothing falls back to an earlier read, a session snapshot or defaults. Roots come only from that owner-controlled file, never from task input, project files, worker output or a readiness receipt. Boot-bound settings are never adopted mid-connection; a change blocks starts with `VSUP_RESTART_REQUIRED`.
- A removed root denies later starts. An already admitted run is not mutated or killed by the change and ends normally. Its worktree cleanup is admitted by the canonical root recorded at admission, and still requires the run-owned path, Git registration, a fresh export equal to the saved artifact and a pristine worktree; nothing else is relaxed.
- Readiness receipts are HMAC-SHA-256 tokens under a random per-process key with a 10-minute expiry. They bind instance, policy revision, operation, canonical workspace and edit base; an admitted edit's worktree is created at the checked commit, and only narrow admission: a start still rereads and revalidates everything. A receipt grants no access, is not user authorization and says nothing about provider authentication. It is not single-use: within its 10 minutes it can admit more than one start, each of which still rereads and revalidates; check readiness again before each start.
- Reviews have only `read_file` and `grep`; edits add `write_file` and `edit` in a detached supervisor-created Git worktree. Shell, network, connector, MCP, custom tools, and project-provided agents are unavailable.
- Project configuration discovery is disabled after the pinned Vibe source hash and property signatures are validated. `.vibe`, unsafe `.agents`, and unsafe `.vibeignore` inputs are refused.
- Edit cleanup checks the expected run-owned canonical path, source/base Git registration, a fresh export matching the saved artifact, and a pristine worktree. Dirty or uncertain worktrees remain with an explicit path and reason for review. Saved metadata or PIDs alone do not authorize deletion or process termination.

## What is not isolated

- The worker runs as your user. Within the allowlisted workspace it reads what you can read, and an edit writes inside its worktree with your permissions. Nothing stops the Vibe process at the kernel level; the limits above are enforced by the supervisor and the pinned launcher.
- Everything the worker reads is sent to Mistral, including files you did not mean to share if they are inside the workspace.
- Vibe's provider client receives the credential it needs. The supervisor keeps it out of tasks, logs and artifacts, not out of Vibe.
- A review of untrusted input means the task names files whose content you do not control: a dependency, a pull request from someone else, generated output. That content can try to steer the worker. Treat the answer as data from that source, verify it, and never let it decide what the coordinator runs, merges or trusts. The tool limits make such a review safe to run; they do not make its answer true.

## Process, configuration, and persistence

Every run uses private `HOME` and `VIBE_HOME`, a child environment assembled from an explicit allowlist, and supervisor-written prompt-file handoff. Task text is not placed in OS-visible arguments. User/project tools, hooks, skills, MCP servers, and trust records are not inherited.

Vibe is pinned to exactly 2.26.1 through the enforced `--legacy-harness` path. The launcher validates source signatures for project discovery, persistence, and effective tool inventory before launch. The effective inventory must match the exact profile or startup fails closed, and any tool outside the profile is refused again when it is invoked, so a path that skips the inventory still cannot run it. The sources of the tool-schema builder, the tool-call resolver and `ToolManager.get` are pinned too. Vibe skills, including the built-in ones, are disabled. Optional tool invocation diagnostics are enabled only when `VIBE_SUPERVISOR_DIAGNOSTICS=1` is present in the supervisor environment; they retain approved tool names and bounded outcomes without arguments or results. Drift fails closed. The source audit is limited to the installed macOS distribution with CPython 3.12; offline inventory and file-tool fixtures do not certify hosted inference, authenticated effective inventory, or native clients. The launcher disables raw logging, filters reasoning/private fields, and redacts recognized or known credentials before persistence. Credential filtering is best effort and cannot guarantee sanitization of every possible third-party diagnostic.

Process ownership is released only after backend close verifies termination. A failed or timed-out close keeps the live handle, active slot, worktree and owner lock for inspection and bounded retries through that handle. Shutdown has no fixed overall exit guarantee while any owned worker remains unresolved. The supervisor never signals a PID from saved state.

An isolated server can route status, result and close by UUID across sibling session directories only within its selected private `mcp-sessions` namespace. It validates the namespace and target paths, rejects duplicate matches, and acquires the target directory's owner lock before manager recovery. A live owner or unsafe/ambiguous path fails closed. The temporary manager receives the active server's boot settings and selected policy source; the route does not read historical config snapshots to expand workspace access.

On macOS, the launcher can resolve the existing Vibe Keychain credential into the private child environment. The secret is removed from the supervisor-only handoff before Vibe starts. It remains available to Vibe's provider client. No credential belongs in task text, source files, logs, reports, or artifacts.

Events, transcripts, results, and artifacts have bounded sizes and private permissions. Writes are atomic where supported. Child workers have bounded deadlines/output and a watchdog for parent death. Owner locking prevents a second manager from claiming the same storage. A restart makes interrupted one-shot runs inspectable and failed; it never loads a session, replays the task, restores a grant, or signals a saved PID.

The supervisor streams output through bounded redaction and recursively removes reasoning/private fields from persisted JSON. Patch content is not rewritten because that would corrupt diffs; export refuses high-confidence credential patterns in added lines and preserves the worktree for inspection. These checks are defense in depth, not a guarantee against unknown secret formats.

## Protocol and logs

The MCP interface is stdio with strict schemas and exactly five tools. It has no interactive grants, continuation, or pending-input protocol. Standard output is reserved for MCP frames; diagnostics go to standard error. Never persist raw provider logs or reasoning.

## Verification limits

No local test, fake Vibe process, initialization probe, or doctor result proves hosted inference, authenticated effective tool inventory, native Codex behavior, or clean-account installation. Release status is in [compatibility](compatibility.md#acceptance-of-100). Historical evidence is version-bound and retained under `history/`.

## Development dependency advisories

The current lockfile pins Vitest 4.0.18 and its development dependency tree. GitHub advisories [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp) and [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) include this Vitest version in their affected ranges. The first concerns the Vitest UI/API or Windows UI/browser mode; the second concerns an exposed mocker plugin on a Vite HMR WebSocket. This repository's release command uses `vitest run`, does not start the UI/browser mode, and does not use Vitest as a runtime dependency. This narrows the known exposure for the documented workflow; it does not remove the advisories or replace a current online dependency audit. The offline npm audit cache did not contain advisory metadata, so its empty result is not evidence of a clean audit. No dependency upgrade is included in 1.0.0.
