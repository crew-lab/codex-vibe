# Functionality

Codex Vibe exposes a local Model Context Protocol (MCP) server that delegates code review and editing tasks to Mistral Vibe. The supervisor manages workspace access, worker processes, run state, and result artifacts. A client starts a run, waits for it inside a tool call, and retrieves the outcome.

## Review and editing

**Review runs** read an allowed workspace using Vibe's `read_file` and `grep` tools. They produce a public response and recorded events. The supervisor compares the source workspace before and after the run. A change during a review does not fail the run: it adds a warning to the result that findings may not match the current files, and artifacts are still written. The review profile does not enable editing, shell, or network tools. Optional `context_files` identify approved context paths for the task.

The programmatic backend does not put the task on the Vibe command line. The supervisor writes it to an owner-only (0600) `task-prompt.txt` in the private run directory and passes only that path to the launcher shim in `VIBE_SUPERVISOR_PROMPT_FILE`. The shim removes the variable, verifies the file (absolute path inside the run directory, regular non-symlink file owned by the user, no group or world access, at most 4 MiB, UTF-8), deletes it, and supplies `--prompt` to Vibe through its in-process `sys.argv`, so the task is not visible in `ps`. Any failed check aborts the launch. ACP sends the task over the protocol and is unchanged. The real Vibe run of this path is unverified; the task is still held in process memory and in Vibe's own redacted session records.

**Edit runs** require a Git repository. The supervisor creates a detached worktree from `base_ref` (default: `HEAD`) and enables `read_file`, `grep`, `write_file`, and `edit` there. The worker edits that worktree, leaving the source checkout unchanged. Exported changes are relative to the chosen base; callers should not assume uncommitted source changes are copied into the worker.

Edits produce a patch for inspection. The supervisor does not apply patches to the source checkout, commit changes, merge branches, or push to a remote. `allow_shell: true` is rejected because a certified operating-system sandbox is not available.

## MCP tools

The server runs over stdio, with protocol frames on stdout and diagnostics on stderr. Tool inputs use strict schemas: unknown fields are rejected. Run IDs are UUIDs returned by the start tools.

| Tool | Function and principal inputs |
|---|---|
| `vibe_review_start` | Start a review with `task` and `cwd`; optionally provide `context_files`, `backend`, `max_turns`, `timeout_seconds`, and `wait_seconds`. |
| `vibe_edit_start` | Start an edit with `task` and `cwd`; optionally provide `base_ref`, `backend`, `max_turns`, `timeout_seconds`, and `wait_seconds`. Keep `allow_shell` false. |
| `vibe_status` | Read state and bounded events for `run_id`. Use `after_seq` to fetch subsequent events, `max_events` (default 10) to limit the response, and `wait_seconds` (0 to 300) to block until an event, state change, pending request, or a state needing action. |
| `vibe_continue` | Send a follow-up `message` to a run whose ACP session supports continuation. |
| `vibe_respond` | Answer the current `request_id`: select an offered `option_id` for a permission request, or accept, decline, or cancel an elicitation request. |
| `vibe_result` | Retrieve the summary and artifact references for `run_id`; `detail` is `compact` (default) or `full`; optionally set `include_transcript`. |
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

3. Save the returned run ID. Without `wait_seconds` a start returns at once; with it (for example 120 to 300) the start call waits until the run needs action and then includes the compact result if the run has finished. Otherwise call `vibe_status` with `wait_seconds` repeatedly instead of polling turn by turn.
4. For an ACP run waiting for permission or input, inspect the current request before calling `vibe_respond`. Unknown, expired, or unsafe responses fail closed.
5. Fetch `vibe_result` (compact by default) when work completes, fails, or is cancelled. Inspect the summary, warnings, and any available edit patch.
6. Close the run. Worktree removal is optional and is refused if the saved patch no longer matches the worktree or residual files cannot be safely accounted for.

## Run lifecycle and recovery

Runs enter a queue, start a worker, and advance through backend initialization to execution. ACP runs may pause in `waiting_permission` or `waiting_input`. Normal outcomes are `completed`, `failed`, or `cancelled`; closing releases worker resources and records `closed`.

The default capacity is two active runs and eight queued runs. Configured turn counts, deadlines, output limits, and idle lifetime bound work. The `timeout_seconds` deadline counts from the moment a run launches, not from when it was queued; queued runs have no deadline timer. State, sequenced events, and public transcripts are persisted in private run directories. A data-directory owner lock prevents two supervisors from managing the same storage concurrently.

After a restart, the supervisor reads saved records. ACP recovery uses `session/load` only when the backend advertises support and saved paths and profiles pass validation. Replayed updates are suppressed during loading. The original task is never automatically resubmitted, and pending permission/input requests are not restored. A recovered session needs explicit continuation.

After an ACP turn completes, its session stays live for `worker_idle_ttl_seconds`, and at most `max_concurrent_runs` completed sessions are kept live at once; the least recently completed idle session is closed first (recorded as an `idle_evicted` or `idle_expired` event) while the run stays `completed`. Completed runs found after a restart are not reloaded at startup; `vibe_continue` lazily reloads the saved session, which needs a free run slot. Closing or cancelling a run never turns a completed run into `failed` because of the backend process exiting afterwards. A backend-reported state change that is invalid for the run's current state is ignored and recorded as a `diagnostic` warning event with `reason` `ignored_backend_state_transition`, the reported and current states, and a redacted, bounded message. Programmatic runs cannot resume an interactive session; saved records remain available for inspection.

A review snapshots the source workspace at launch to detect changes. If the snapshot cannot be taken (more than 200,000 files, more than 2 GB, or an unreadable entry), the review still proceeds and the result carries a warning that review integrity was not checked. Every path that moves a run to `failed` (backend-reported failure, artifact finalization failure, deadline, output limits, launch errors) releases the worker process and session handle once; a failed run never keeps a live worker.

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

Compact results (the default) include state, a public summary, up to 50 changed-file paths with a total, warnings, a diff stat, the patch inline when it is at most 4000 bytes, and artifact `name` and `path`. `detail: "full"` adds workspace paths and, per artifact, the SHA-256 digest, byte count, and media type.

- All finalized runs can expose a public `transcript.md` and sequenced `events.ndjson`.
- Edit runs additionally export `diff.patch`, `diff.stat`, and `changed-files.json`, including supported binary and untracked changes.
- MCP response size (`max_mcp_result_chars`, default 8000, and `mcp_result_format`) and transcript/event/artifact limits keep returned and retained data bounded. A failed or unfinished run may have incomplete artifacts.
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
| `configure-codex --user --dry-run` | Preview the user MCP configuration entry, which includes `tool_timeout_sec = 600` so long waits are not cut off. Omit `--dry-run` to write it with a backup; `--project` selects project scope. |
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
