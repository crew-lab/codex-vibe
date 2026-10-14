# ADR 0004: Supervisor 2.0 app-server engine

Status: implementation in progress. Target: `2.0.0-rc.1`, exactly Vibe 2.26.1, macOS Apple silicon. This decision supersedes the legacy runtime design for the 2.0 candidate; it does not certify target acceptance.

## Decision

Drive Vibe through its public `vibe-app-server` JSON-RPC stdio entrypoint, one fresh process and session per run. Keep the five Supervisor MCP operations, canonical workspace allowlists, detached edit worktrees, export without application, one active slot, owner locking, bounded deadlines/output and verified cleanup.

The Supervisor verifies trusted release-file hashes and dependency versions before loading Vibe. Its isolated Python bootstrap handles private environment, bounded credential lookup and process ownership without modifying Vibe internals. Every session must pass configuration/runtime read-back before the task is sent. Any compatibility drift fails closed.

Native file calls require a per-invocation approval linked to a live effect by ID, session, turn and exact arguments. Unified effects remain `running` while approval is pending; they do not need a fabricated `blocked` state. Callback choices must offer approve and deny; persistent grants are never selected. Terminal effect history is audited, including older pages obtained by backward pagination.

Reviews retain read/search capability through a Supervisor-owned stdio MCP service exposing only bounded `grep` and `list_files`. Edits additionally allow native writes and edits only inside the owned worktree. Shell and network tools are denied. Foreign MCP servers, hooks, agents, skills, connectors, subagents and background processes are disabled. Prohibited builtins may remain model-visible: catalogue visibility is distinct from permission to execute.

Use `mistral-medium-3.5` with high reasoning. Vibe may write reasoning and tool output into a private temporary store. Supervisor artifacts omit reasoning and raw frames. Clean the private store only after verified process termination; deletion is not secure erasure. Disabling logging alone is not prevention of disk writes.

Token and estimated USD ceilings are optional client-side sampled controls. In-flight inference may overshoot. Usage and prices come from validated public stats; estimates are not provider billing receipts. Session identity changes require renewed control validation and accounting continuity, never task replay or restored pending grants.

## Storage and shutdown

Use a separate app-server default data directory. Refuse foreign or unverifiable engine records before isolated configuration adoption. Existing legacy records remain preserved. Restart settles uncertain work without replay and never signals a PID merely because it appears in saved metadata.

Interrupt, close stdin for graceful cleanup, then terminate only owned processes if needed. Verify owned search children before deleting private directories. Retain unverified residue for inspection. These are application controls, not an OS sandbox.

## Release evidence

Independent fake-server tests establish Supervisor protocol behavior only. Installed conformance with a local mock provider, exact native connection readiness, separately authorized hosted review/edit/disconnect and human fresh-account installation remain distinct gates. Freeze the candidate artifact before target acceptance and publish only with applicable authorization.

Implementation checkpoint: [Supervisor 2.0](../v2-implementation.md).
