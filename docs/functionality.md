# Functionality

Codex Vibe exposes a local Model Context Protocol (MCP) server that delegates code review and editing tasks to Mistral Vibe. The supervisor manages workspace access, worker processes, run state, and result artifacts. A client starts a run, polls its progress, and retrieves the outcome.

## Review and editing

**Review runs** read an allowed workspace using Vibe's `read_file` and `grep` tools. They produce a public response and recorded events. The supervisor checks workspace integrity; the review profile does not enable editing, shell, or network tools. Optional `context_files` identify approved context paths for the task.

**Edit runs** require a Git repository. The supervisor creates a detached worktree from `base_ref` (default: `HEAD`) and enables `read_file`, `grep`, `write_file`, and `edit` there. The worker edits that worktree, leaving the source checkout unchanged. Exported changes are relative to the chosen base; callers should not assume uncommitted source changes are copied into the worker.

Edits produce a patch for inspection. The supervisor does not apply patches to the source checkout, commit changes, merge branches, or push to a remote. `allow_shell: true` is rejected because a certified operating-system sandbox is not available.

## MCP tools

The server runs over stdio, with protocol frames on stdout and diagnostics on stderr. Tool inputs use strict schemas: unknown fields are rejected. Run IDs are UUIDs returned by the start tools.

| Tool | Function and principal inputs |
|---|---|
| `vibe_review_start` | Start a review with `task` and `cwd`; optionally provide `context_files`, `backend`, `max_turns`, and `timeout_seconds`. |
| `vibe_edit_start` | Start an edit with `task` and `cwd`; optionally provide `base_ref`, `backend`, `max_turns`, and `timeout_seconds`. Keep `allow_shell` false. |
| `vibe_status` | Read state and bounded events for `run_id`. Use `after_seq` to fetch subsequent events and `max_events` to limit the response. |
| `vibe_continue` | Send a follow-up `message` to a run whose ACP session supports continuation. |
| `vibe_respond` | Answer the current `request_id`: select an offered `option_id` for a permission request, or accept, decline, or cancel an elicitation request. |
| `vibe_result` | Retrieve the summary and artifact references for `run_id`; select `detail` and optionally `include_transcript`. |
| `vibe_cancel` | Request cancellation and terminate the managed worker. |
| `vibe_close` | Close a run; optionally request verified worktree removal with `cleanup_worktree`. |

See [protocol.md](protocol.md) and `src/mcp/schemas.ts` for the protocol and exact input constraints.

## Typical workflow

1. Configure the workspace allowlist, build the project, and start the MCP server.
2. Call a start tool. For example, this is a review tool's input:

   ```json
   {
     "task": "Review the authentication module for correctness and report findings.",
     "cwd": "/absolute/path/to/allowed/repository",
     "backend": "programmatic"
   }
   ```

3. Save the returned run ID and poll `vibe_status`. Starting a run does not wait for the delegated task to finish.
4. For an ACP run waiting for permission or input, inspect the current request before calling `vibe_respond`. Unknown, expired, or unsafe responses fail closed.
5. Fetch `vibe_result` when work completes, fails, or is cancelled. Inspect the summary, warnings, and any available edit patch.
6. Close the run. Worktree removal is optional and is refused if the saved patch no longer matches the worktree or residual files cannot be safely accounted for.

## Run lifecycle and recovery

Runs enter a queue, start a worker, and advance through backend initialization to execution. ACP runs may pause in `waiting_permission` or `waiting_input`. Normal outcomes are `completed`, `failed`, or `cancelled`; closing releases worker resources and records `closed`.

The default capacity is two active runs and eight queued runs. Configured turn counts, deadlines, output limits, and idle lifetime bound work. State, sequenced events, and public transcripts are persisted in private run directories. A data-directory owner lock prevents two supervisors from managing the same storage concurrently.

After a restart, the supervisor reads saved records. ACP recovery uses `session/load` only when the backend advertises support and saved paths and profiles pass validation. Replayed updates are suppressed during loading. The original task is never automatically resubmitted, and pending permission/input requests are not restored. A recovered session needs explicit continuation. Programmatic runs cannot resume an interactive session; saved records remain available for inspection.

## Backends

| Capability | Programmatic (default) | ACP (opt-in) |
|---|---|---|
| Review and isolated edits | Yes | Yes |
| Public response and event capture | Yes | Yes |
| Follow-up in the same session | No | Yes, when the session is available |
| Interactive permission/input responses | No | Yes, subject to supervisor policy |
| Session loading after restart | No | Conditional on advertised support and validated saved state |

Both adapters are pinned to Mistral Vibe **2.25.8** and use a private launch profile and runtime shim. Unsupported versions fail closed. ACP negotiates protocol version 1 and verifies the requested mode and workspace trust state. Selecting a backend does not establish provider authentication or guarantee successful model inference.

## Results and retained data

Results include state, a public summary, changed-file paths, warnings, and artifact references where available. Each artifact reference includes its path, SHA-256 digest, byte count, and media type.

- All finalized runs can expose a public `transcript.md` and sequenced `events.ndjson`.
- Edit runs additionally export `diff.patch`, `diff.stat`, and `changed-files.json`, including supported binary and untracked changes.
- MCP response size and transcript/event/artifact limits keep returned and retained data bounded. A failed or unfinished run may have incomplete artifacts.
- Known secret patterns are redacted and reasoning/thought fields are excluded from persisted public output. Filtering does not guarantee detection of every secret format.
- Retention defaults to seven days with failed runs preserved. Private Vibe histories are retained for recovery and handled by supervisor cleanup.

## Local CLI

After `npm ci` and `npm run build`, invoke commands as `node dist/cli.js <command>`.

| Command | Purpose |
|---|---|
| `init` | Create a private starter configuration. |
| `config validate [path]` | Check a TOML configuration. |
| `doctor --json` | Report local prerequisites without a hosted model request. |
| `serve --stdio` | Run the MCP server. |
| `configure-codex --user --dry-run` | Preview the user MCP configuration entry. Omit `--dry-run` to write it with a backup; `--project` selects project scope. |
| `test-acp` | Check ACP initialization and compatibility without sending a model prompt. |
| `runs list` | List saved runs. |
| `runs show <run-id>` | Inspect a saved run. |
| `runs tail <run-id>` | Read saved run events. |
| `runs cleanup [run-id]` | Request safe cleanup of eligible saved data. |
| `--version` | Print the supervisor version. |

Set `allowed_workspace_roots` to canonical directories before starting work; the initial allowlist is empty. Configuration also controls executable paths, backend selection, concurrency, limits, retention, and the data directory. See [configuration.md](configuration.md) and [the example TOML](../examples/config.toml).

## Boundaries and release status

The supervisor enforces application-level permissions, environment filtering, workspace validation, private homes, and bounded process termination. These controls do not provide a kernel sandbox or network firewall. Shell and network tools are disabled; enabled local file tools can send permitted source content to the configured model provider.

This is a local release candidate. Automated protocol fixtures, unit/integration tests, packaging smoke tests, and local compatibility probes have passed. Hosted inference, authenticated real-session tool inventory, a real hosted ACP soak, and Codex desktop integration remain unverified. Plugin manifests are scaffolds rather than evidence of successful installation.

For details, read [security.md](security.md), [compatibility.md](compatibility.md), [acceptance.md](acceptance.md), and [plugin-scaffold.md](plugin-scaffold.md).
