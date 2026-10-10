# Security model

The supervisor applies workspace, process, persistence, and output controls around Vibe. These controls are **not an operating-system sandbox**. A worker runs with the local account's process permissions, and allowed workspace content is sent to Mistral. Treat delegation as code execution with your account's access.

## Workspace and tool scope

- The canonical workspace allowlist is explicit and starts empty. Invalid, unsafe, glob-containing, symlinked, and out-of-root paths fail closed.
- Reviews have only `read_file` and `grep`; edits add `write_file` and `edit` in a detached supervisor-created Git worktree. Shell, network, connector, MCP, custom tools, and project-provided agents are unavailable.
- Project configuration discovery is disabled after the pinned Vibe source hash and property signatures are validated. `.vibe`, unsafe `.agents`, and unsafe `.vibeignore` inputs are refused.
- Edit cleanup checks the expected run-owned canonical path, source/base Git registration, a fresh export matching the saved artifact, and a pristine worktree. Dirty or uncertain worktrees remain with an explicit path and reason for review. Saved metadata or PIDs alone do not authorize deletion or process termination.

## Process, configuration, and persistence

Every run uses private `HOME` and `VIBE_HOME`, a child environment assembled from an explicit allowlist, and supervisor-written prompt-file handoff. Task text is not placed in OS-visible arguments. User/project tools, hooks, skills, MCP servers, and trust records are not inherited.

Vibe is pinned to exactly 2.26.1 through the enforced `--legacy-harness` path. The launcher validates the version and source signatures for project-discovery and persistence hooks before launch. Drift fails closed. The source audit is limited to the installed macOS distribution with CPython 3.12; it does not certify other OS/interpreter builds, hosted inference, authenticated effective inventory, or native clients. The launcher disables raw logging, filters reasoning/private fields, and redacts recognized or known credentials before persistence. Credential filtering is best effort and cannot guarantee sanitization of every possible third-party diagnostic.

Process ownership is released only after backend close verifies termination. A failed or timed-out close keeps the live handle, active slot, worktree and owner lock for inspection and bounded retries through that handle. Shutdown has no fixed overall exit guarantee while any owned worker remains unresolved. The supervisor never signals a PID from saved state.

On macOS, the launcher can resolve the existing Vibe Keychain credential into the private child environment. The secret is removed from the supervisor-only handoff before Vibe starts. It remains available to Vibe's provider client. No credential belongs in task text, source files, logs, reports, or artifacts.

Events, transcripts, results, and artifacts have bounded sizes and private permissions. Writes are atomic where supported. Child workers have bounded deadlines/output and a watchdog for parent death. Owner locking prevents a second manager from claiming the same storage. A restart makes interrupted one-shot runs inspectable and failed; it never loads a session, replays the task, restores a grant, or signals a saved PID.

The supervisor streams output through bounded redaction and recursively removes reasoning/private fields from persisted JSON. Patch content is not rewritten because that would corrupt diffs; export refuses high-confidence credential patterns in added lines and preserves the worktree for inspection. These checks are defense in depth, not a guarantee against unknown secret formats.

## Protocol and logs

The MCP interface is stdio with strict schemas and exactly five tools. It has no interactive grants, continuation, or pending-input protocol. Standard output is reserved for MCP frames; diagnostics go to standard error. Never persist raw provider logs or reasoning.

## Verification limits

No local test, fake Vibe process, initialization probe, or doctor result proves hosted inference, authenticated effective tool inventory, native Codex behavior, or clean-account installation. Candidate-specific status is in [compatibility](compatibility.md#unverified-gates). Historical evidence is version-bound and retained under `history/`.

## Development dependency advisories

The current lockfile pins Vitest 4.0.18 and its development dependency tree. GitHub advisories [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp) and [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) include this Vitest version in their affected ranges. The first concerns the Vitest UI/API or Windows UI/browser mode; the second concerns an exposed mocker plugin on a Vite HMR WebSocket. This repository's release command uses `vitest run`, does not start the UI/browser mode, and does not use Vitest as a runtime dependency. This narrows the known exposure for the documented workflow; it does not remove the advisories or replace a current online dependency audit. The offline npm audit cache did not contain advisory metadata, so its empty result is not evidence of a clean audit. No dependency upgrade is included in this candidate.
