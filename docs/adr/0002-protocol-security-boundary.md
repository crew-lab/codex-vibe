# ADR 0002: strict MCP boundary and isolated work

The supervisor exposes exactly five MCP tools over stdio: review start, edit start, status, result, and close. Input schemas reject unknown fields. Shell, network, user-selected backend, interactive permission/input response, continuation, and task replay are outside the supported protocol.

Review uses a canonical allowlisted source workspace and read/search tools. Edit uses a named Git base and a supervisor-created detached worktree with read/search/write/edit tools. The server exports a patch for coordinator review; it does not apply or publish worker changes.

Each owning server/storage instance accepts one active run. The slot is reserved before asynchronous launch. A competing start fails without creating a queue record. An interrupted run is stored as failed on restart; startup does not launch a worker or use saved PID data to signal a process. Separate explicitly isolated connections can own separate instances.

Private HOME/VIBE_HOME, explicit child environment filtering, project discovery isolation, pinned Vibe compatibility checks, bounded event/artifact output, owner locking, process watchdogs, and fresh-export cleanup checks remain required. The application controls are not a kernel sandbox. See [security](../security.md), [functionality](../functionality.md), and [compatibility](../compatibility.md).
