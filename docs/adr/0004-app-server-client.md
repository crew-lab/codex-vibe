# ADR 0004: client of the Vibe app-server

Status: accepted. Its target gates are open in [the acceptance record](../acceptance.json) and the [compatibility document](../compatibility.md#unverified-gates).

The supervisor drives Mistral Vibe as a client of `vibe-app-server`: newline-delimited JSON-RPC 2.0 over stdio, one process per run, the boundary Vibe's own surfaces use. It does not patch or import Vibe. The MCP side is five tools and unchanged by this choice. The runtime supports exactly one Vibe version, with a new candidate for each Vibe release. The protocol has no version field, so the pin is the compatibility check: the exact `serverInfo.version`, plus the installed wheel's files verified by hash.

Every other boundary stays: exactly five MCP tools, canonical allowlists, review read-only, edits in supervisor-created detached worktrees that are exported and never applied, shell and network disabled, private `HOME`/`VIBE_HOME` and a private `TMPDIR`, filtered child environment, untrusted project state, one active run, restart never replays, bounded deadlines and output, verified cleanup. This is application policy, not an OS sandbox.

The review profile gives the model `read_file` only; the supervisor puts a bounded file list in the prompt. The server cannot hide `write_file`, `edit`, the shell tool or `run_typescript` from the model, so they are listed and refused at execution: denied in configuration, every approval answered deny. The post-run source-unchanged check stays the proof that a review wrote nothing. The model sees these tools and cannot use them.

Reasoning stays off disk: session logging is off, so Vibe's store is a throwaway directory inside the run's private area; thinking is off; the supervisor closes stdin for a graceful stop and deletes the private area itself; after a supervisor crash, restart recovery deletes it before accepting work.

## Consequences

The supervisor owns the enforcement, because the server's defaults do not provide it.

- Configuration denial, then a startup read-back through `config/effective/read` and `runtime/read`; any mismatch fails before the first turn.
- An approval handler that denies unless the call is the profile's tool on an in-workspace path. The client must declare the approval callback kind or the server crashes on the first approval. The server never times out a pending approval, so the supervisor does.
- Time, turn, token and price budgets, enforced client-side; the server does not enforce price or token limits.
- Usage and cost, rebuilt from `session/statsUpdated`, `runtime/read` and Vibe's pricing formula, because the server writes no run export.
- Graceful stop by closing stdin: SIGTERM skips Vibe's cleanup.
- Drift detection: strict on what it sends, tolerant of unknown fields on read, and failing closed on any event that could hide a tool call.

The wire facts and the Vibe source they were read from are in [compatibility](../compatibility.md#source-basis). Behavior and boundaries as implemented: [functionality](../functionality.md), [security](../security.md#enforcement-points) and [compatibility](../compatibility.md).
