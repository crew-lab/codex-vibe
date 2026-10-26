# Reference

The supervisor uses MCP over stdio. Standard output carries protocol frames; diagnostics go to standard error. Tool schemas reject unknown fields, including `backend`, `allow_shell`, and `vibe_respond` fields. The server always registers exactly five tools. Each start requires a private dispatch grant's `authorization_id` and unique `attempt_id`; obtain these with `task authorize` before calling a start tool. See [behavior](functionality.md), [security](security.md), and [errors](errors.md).

## Tools

Exactly five tools are registered:

| Tool | Purpose |
|---|---|
| `vibe_review_start` | Start one read-only review in an allowed workspace. |
| `vibe_edit_start` | Start one edit from an explicit Git base in a detached supervisor worktree. |
| `vibe_status` | With `run_id`: read state and bounded events, including the compact result when settled. With `workspace` and `operation`: check readiness on this connection without starting a run. |
| `vibe_result` | Read the compact/full record and optionally its transcript. |
| `vibe_close` | Cancel live work, close the run, and optionally request verified worktree cleanup. |

Each owning server/storage instance has one active run slot. A concurrent start is rejected immediately. The slot is released only after backend close verifies termination. A `vibe_close` response with `worker_termination_unverified: true` means the handle and slot remain owned, the run is still inspectable and its worktree is retained; do not report that the process is closed or start another run on that slot. A settled result is not independently accepted until the coordinator reviews it. On restart, an interrupted run is marked failed and never resumed or replayed.

All schemas are strict. `run_id` is a UUID v4. Unless noted, required fields have no default.

| Tool | Field | Type and bounds | Default |
|---|---|---|---|
| `vibe_review_start` | `task` | string, 1–100,000 characters | required |
| | `authorization_id` | UUID v4 for a live private dispatch grant, bound to this request and one start | required |
| | `attempt_id` | UUID v4 unique to this dispatch attempt | required |
| | `cwd` | absolute workspace path, 1–4096 characters, inside an allowed root | required |
| | `context_files` | up to 50 paths, each 1–4096 characters | `[]` |
| | `output` | `text`, or `findings` to ask for a JSON findings block that the supervisor validates and saves as `artifacts/findings.json` (exportable with `runs sarif`) | `text` |
| | `max_turns` | integer 1–50 | `limits.max_turns_review` |
| | `timeout_seconds` | integer 30–7200 | `limits.review_timeout_seconds` |
| | `wait_seconds` | integer 0–300 | `0` |
| | `readiness_receipt` | string, 1–2048 characters, from a workspace check on this connection | none |
| `vibe_edit_start` | `acceptance_contract` | optional strict versioned path/text/hash contract and required validation IDs; see [acceptance](workflow-acceptance.md) | none |
| `vibe_edit_start` | `authorization_id`, `attempt_id` | UUID v4 grant and unique dispatch attempt, as for review | required |
| `vibe_edit_start` | `prepared_inputs` | optional `{ directory, manifest_sha256 }` binding; requires an acceptance contract and is verified against the current policy, base, copied inventory and output paths before provider launch | none |
| | `task`, `cwd` | as above; `cwd` must be the Git repository root | required |
| | `base_ref` | existing Git ref, 1–512 characters | `HEAD` |
| | `max_turns`, `timeout_seconds`, `wait_seconds`, `readiness_receipt` | same bounds as review | configured defaults, then `0` for wait, no receipt |
| `vibe_status` | `expected_candidate` | optional SHA-256 distribution identity, workspace mode only | none |
| | `run_id` | UUID v4; pass exactly one of `run_id` or `workspace` | none |
| | `after_seq` | integer ≥0 (run mode) | `0` |
| | `max_events` | integer 0–100 (run mode) | `10` |
| | `wait_seconds` | integer 0–300 (run mode) | `0` |
| | `workspace` | absolute path, 1–4096 characters (readiness mode) | none |
| | `operation` | `review` or `edit`; required with `workspace` | none |
| | `base_ref` | Git ref, 1–512 characters; only with `operation: edit` | `HEAD` for edit |
| `vibe_result` | `run_id` | UUID v4 | required |
| | `detail` | `compact` or `full` | `compact` |
| | `include_transcript` | boolean | `false` |
| `vibe_close` | `assessment` | optional strict append-only coordinator decision bound to contract/patch hashes and validations | none |
| | `run_id` | UUID v4 | required |
| | `cleanup_worktree` | boolean | `false` |

A failed tool call sets `isError` and returns one JSON text block, `{"error": {code, message, remediation, retryable, details?}}`, redacted and bounded like a result; branch on `code`, `retryable` and `details`. See [errors](errors.md).

Start calls can wait until the run needs coordinator attention. For longer work, use cursor-based status calls and pass `next_after_seq` as the next `after_seq`; waits are bounded to 300 seconds. A completed run can carry a non-`end_turn` stop reason and partial-result warning: `turn_limit`, `token_limit`, `price_limit` or `refusal`. A cancelled run reports `cancelled`. Read the stop reason before trusting its summary. Tool events (`tool_call`, `tool_denied`) and the reasons behind them are described in [behavior](functionality.md#events).

## Workspace readiness

`vibe_status` with `workspace` and `operation` asks the connected server whether it would admit that start now. It creates no run, record, worktree or model call and does not launch Vibe. It rereads the selected configuration and runs the same admission validators as a start: canonical allowlisted workspace, Git repository root for an edit, no project `.vibe` or unsafe `.agents`, no glob characters. An edit check also resolves `base_ref` to a commit. Fields:

| Field | Meaning |
|---|---|
| `server_version`, `server_instance_id` | The serving process's release and a random per-process identity. Unlike `supervisor_version` in run output, which names the release that created a saved run, these describe this connection. |
| `workspace_eligible`, `eligible` | Workspace admission is separate from complete start eligibility; preparation or expected-candidate drift can block an eligible workspace. |
| `candidate`, `preparation` | Connected distribution identity and matching conformance evidence (`passed`, `failed`, `missing`, `stale`); runtime pin is checked again at dispatch. |
| `policy_path`, `policy_revision` | The selected configuration file and the semantic SHA-256 of what it holds now; `null` revision when it cannot be read. |
| `restart_required`, `boot_drift` | Whether boot-bound settings in the file differ from the ones this server started with, and which keys. |
| `session_id` | The private `--isolated` session directory name, or `null`. |
| `operation`, `requested_workspace`, `workspace` | The request and its canonical path, `null` when rejected. |
| `base_ref`, `base_commit` | Edit checks only: the ref and the commit it resolves to now. |
| `eligible`, `blockers` | Whether a start would be admitted, and every reason it would not, each with `code`, `message`, `remediation`, `retryable` and, when present, `details` (for example `unavailable_root` or `boot_drift`). |
| `active_slot.busy` | Whether this instance already has an active run. |
| `runtime` | Resolution of the `vibe-app-server` executable (`paths.app_server`, else the directory of `paths.vibe`): `executable_found`, `resolved_executable`, `pinned_version`. Vibe is not launched and the installed files are not hashed, so `version_verified` is always `false`; the exact pinned version and the pin manifest are enforced when a run starts, and `doctor` runs the pin check on demand. |
| `readiness_receipt`, `receipt_expires_at` | Present only when eligible. An opaque token, valid for 10 minutes on this server instance. |

Passing `readiness_receipt` to the matching start binds it to the check: the start is rejected before any run is created with `VSUP_READINESS_RECEIPT_INVALID` when the receipt is malformed, altered, expired, issued by another instance, or bound to a different policy revision, operation, canonical workspace or `base_ref`, or when, for an edit, the ref no longer resolves (`base_ref_unresolved`) or resolves to another commit (`base_commit`). An admitted edit's worktree is created at exactly the commit that was checked, so a ref that moves afterwards cannot change what the worker sees; without a receipt the ref is resolved once, when the worktree is created, and that commit is used throughout. `details.reason` names which. A receipt is not authorization for the task and does not prove provider availability or authentication. Without a readiness receipt, start still rereads configuration and requires matching preparation PASS; a readiness receipt and private preparation evidence are separate mechanisms. Either way a start still claims the slot, rereads and validates, so a slot taken after the check is rejected with `VSUP_LIMIT_EXCEEDED`.

## Results and artifacts

Compact results include state, stop reason, summary, warnings, error, next action, and review integrity or edit changes. Edits include changed paths, diff statistics, and an exact exported patch. Small patches may be inline; larger patches are returned by private artifact path. Full results add artifact digests, sizes and media types, usage, workspace paths, and transcript when requested. Replies are bounded by `limits.max_mcp_result_chars`.

Review integrity is `verified`, `changed`, or `unverified`. Inspect `changed_paths` and `reason` before relying on a review that changed during execution or could not be fully snapshotted. For edits, inspect the fresh patch and changed/residual files before close. Cleanup reports `worktree_removed` and, when cleanup is refused, a retained reason. The snapshot behind review integrity hashes every Git-visible file and stats everything else except `.git`, within caps of 200,000 files and 2 GiB; past a cap integrity is `unverified`, and large ignored trees such as `node_modules` cost stat time at launch and settle.

`vibe-supervisor runs cleanup` without a run id removes expired runs and lists `retained_worktrees` (`run_id`, `state`, `path`, `manual_command`) and `unverified_worktrees`. A retained worktree stays registered in the source repository; if it was pruned or deleted by hand, verified cleanup refuses it. Run `manual_command` (`git -C <source> worktree remove <path>`) or `git worktree prune` yourself after saving the exported patch. Worktree creation, patch export and cleanup are bounded at 5 minutes (other Git queries 30 s), and the patch at `limits.max_artifact_bytes`. `limits.max_event_bytes` bounds the raw worker stdout stream; `limits.max_transcript_bytes` bounds only the transcript.

### Usage, ceilings and tool-call counts

Every run record (`meta.json`, `runs list`, `runs show`) and full result carries the numbers the supervisor already computes. A field that is absent was never measured because the run ended first; `null` means Vibe's statistics reported no value. Nothing is filled in with zero.

| Field | Meaning |
|---|---|
| `usage.tokens_used` | Tokens used by the run, prompt plus completion, counted from the session statistics the run started with. |
| `usage.prompt_tokens`, `usage.completion_tokens` | Prompt and completion tokens, carried across a compaction or context clear. |
| `usage.cached_tokens`, `usage.model_calls` | Cached prompt tokens and the number of model calls; `null` when the statistics carry none. |
| `usage.context_size` | The model's context size when Vibe reports it. |
| `usage.cost` | `{ amount, currency, authoritative: false }`: an estimate from the token counts and the prices Vibe reports, never a bill. `usage.cost_source` is `runtime-stats-prices`. |
| `usage.tool_calls` | `executed`, `denied_by_handler` and `denied_by_policy`: the supervisor's own audited outcomes, the ones that become `tool_call` and `tool_denied` events (the two denials are the two `outcome` values of `tool_denied`). They are not Vibe's per-tool statistics, which are the worker's claims and are not read. |
| `limits.max_tokens`, `limits.max_cost_usd` | The ceilings in force for that run, saved only when configured (see [Configuration](#configuration)). |
| `limits.max_model_calls` | The model-call backstop the supervisor enforces: `max_turns` plus 5. Always saved. |
| `excluded_globs` | The exclusions applied to that run as `[{ root, globs }]`, one entry per allowed root that contains the workspace, each anchored at that root; `[]` when none; see [Excluded paths](#excluded-paths). |
| `pin` | `vibe_version`, `manifest_sha256` and `record_sha256` of the pin that passed at launch; see [compatibility](compatibility.md#the-pin-and-its-manifest). Absent for a run whose pin identity was not reported. |

`usage` is written only once Vibe has reported statistics, so a run that failed at startup has none. Records written before these fields existed still load and simply lack them.

## Configuration

The configuration is strict TOML. The starter allowlist is empty. Keys the supervisor does not define, including concurrency, idle-session TTL and ACP paths, are errors, and a file without `paths.vibe_pin_manifest` is refused for runs with `VSUP_CONFIG_INVALID`. `setup` adds the default path (`vibe-pin-manifest.json` next to the config) when it creates a config or resolves executables and says to write the manifest with `pin-manifest` before the first run.

| Key | Meaning |
|---|---|
| `version` | Required schema version `1`. |
| `backend` | Optional `"app-server"` (default) or `"antigravity"`. `"antigravity"` is accepted only with `experimental.antigravity = true`. Boot-bound. |
| `vibe_version` | Optional exact app-server version. Only `"3.0.2"` is accepted and it is the default; older and other explicit values are rejected. Boot-bound. |
| `experimental.antigravity` | Optional boolean, default `false`. Opts in to the experimental Antigravity backend ([ADR 0008](adr/0008-antigravity-execution-backend.md)); without it `backend = "antigravity"` is rejected. The backend is not for production until its [target probes](target-acceptance.md#antigravity-backend-probes) pass; see [security](security.md#antigravity-backend-experimental). |
| `allowed_workspace_roots` | Up to 100 absolute or home-relative canonical workspace roots. Defaults to empty. |
| `excluded_globs` | Optional table from an `allowed_workspace_roots` entry, written exactly as listed there, to up to 100 workspace-relative globs that no run admitted under that root may read or write. Narrows access only; see [Excluded paths](#excluded-paths). Defaults to none. |
| `budgets` | Optional table from an `allowed_workspace_roots` entry, written exactly as listed there, configuring per-root daily spending ceilings (`max_cost_usd_per_day`). See [Workspace budgets](#workspace-budgets). Defaults to none. |
| `retention.days` | Bounded artifact retention age. Retention removes closed and cancelled runs older than the cutoff when no worktree is retained, and closes then removes completed runs after at least a day. A failed run that was never closed is never pruned by age; close it with `vibe_close` to make it eligible. |
| `limits.review_timeout_seconds`, `limits.edit_timeout_seconds` | Default run deadlines. |
| `limits.max_turns_review`, `limits.max_turns_edit` | Default one-shot turn limits, 1–50. |
| `limits.max_event_bytes`, `limits.max_transcript_bytes`, `limits.max_artifact_bytes` | Bounded persisted output sizes. |
| `limits.worker_progress_timeout_seconds` | No-progress watchdog, `0` disables or 60–7200 seconds. |
| `limits.max_mcp_result_chars` | Maximum serialized MCP response size. |
| `limits.max_tokens` | Optional ceiling on tokens used by one run, prompt plus completion, counted from the session statistics the run started with. Integer 1 to 1,000,000,000. Unset means no token ceiling. |
| `limits.max_cost_usd` | Optional ceiling on the estimated cost of one run in US dollars (a positive number up to 1,000,000), computed from the token counts and the per-million prices Vibe reports. Unset means no cost ceiling. When Vibe reports no price for the active model while this ceiling is set, the run fails closed (`VSUP_BACKEND_ERROR`, `details.reason: price_unavailable`), before the first turn if the price is already missing at startup, because the ceiling could not be enforced. |
| `paths.vibe` | Absolute executable path or bare command resolved through `PATH`. `vibe-app-server` is looked up in the same directory. |
| `paths.app_server` | Optional absolute path or bare command for `vibe-app-server`, when it is not next to `paths.vibe`. |
| `paths.vibe_pin_manifest` | **Required for runs.** The repair commands (`pin-manifest`, `allow`, `doctor`, `runs`) and `serve` still read a file without it; see [the CLI](#cli). Absolute path of the pin manifest written by `vibe-supervisor pin-manifest` for the installed Vibe. A run is refused until the installed files match it; see [compatibility](compatibility.md#the-pin-and-its-manifest). |
| `paths.antigravity` | Optional executable name or absolute path for the Antigravity CLI when `backend = "antigravity"`. Defaults to `"agy"`. Boot-bound. |

`limits.max_tokens` and `limits.max_cost_usd` are enforced by the supervisor, because the Vibe server does not enforce price or token limits. The supervisor checks them at each statistics update and interrupts the turn after the one that crosses them, so a run can overshoot by one model call; the run then settles `completed` with `stop_reason` `token_limit` or `price_limit` and a warning that the result may be incomplete. `limits.max_turns_*` are passed to Vibe as its iteration limit and backstopped by the supervisor when the model-call count exceeds the limit by a small margin.

The exact defaults and bounds are in [`schemas/config.schema.json`](../schemas/config.schema.json). An explicit `--config` takes precedence over `VIBE_SUPERVISOR_HOME`, then the platform default. An explicit invalid or missing file fails without fallback. The default data roots are `~/Library/Application Support/VibeSupervisor-oneshot` (macOS), `%APPDATA%/VibeSupervisor-oneshot` (Windows), and `${XDG_DATA_HOME:-~/.local/share}/vibe-supervisor-oneshot` (Linux). `VIBE_SUPERVISOR_HOME` is an explicit override. With `--isolated`, per-connection storage remains below the selected config parent. The selected path is kept for the whole connection; the `config.toml` copied into a session directory is an audit record of the file at connect time and is never read as policy.

### Excluded paths

`excluded_globs` adds paths to the fixed denylist of reserved and secret files (`.git`, `.vibe`, `.agents`, `.vibeignore`, `.env*`, keys and certificates). Use it for fixtures with real data, dumps and `*.tfvars` that must never reach the worker.

```toml
allowed_workspace_roots = ["~/src/project"]

[excluded_globs]
"~/src/project" = ["*.tfvars", "fixtures/private/**", "dumps/*.sql"]
```

- **Keys.** Each key must equal an entry of `allowed_workspace_roots`, as written (`~/src/project` is not `/Users/me/src/project`). Any other key is `VSUP_CONFIG_INVALID` with the field path, so an exclusion can never imply access; to remove a root, remove its exclusions entry too. A root listed twice, as written or after expanding `~`, is also `VSUP_CONFIG_INVALID`, so one root never has two exclusion lists.
- **Syntax.** At most 100 globs per root; each 1 to 256 characters and at most 16 `/`-separated segments, relative to the allowed root they are listed under. A segment uses ASCII letters, digits and `. _ - @ + = ,` plus `*`, which matches any characters within one segment; `**` is allowed only as a whole segment and matches any number of segments. There is no leading `/`, `~`, `.` or `..` segment, empty segment, negation, `?`, `[`, `]`, brace or backslash. Duplicates are dropped and order is kept. Matching takes time linear in the path, however many `*` a segment has.
- **Anchoring.** A glob is anchored at the allowed root it is configured under, not at the run's workspace. A path is matched by its path relative to that root: for a workspace below the root, the root-to-workspace path comes first (with root `~/src` and workspace `~/src/project`, `project/fixtures/**` excludes the workspace's `fixtures` directory); for an edit, the worktree path is first mapped back to the source repository's path. A glob with no `/` (`*.tfvars`, `dumps`) matches a file or directory name at any depth below the root, including a directory above the workspace, which then excludes the whole workspace. A glob with a `/` must match the whole root-relative path. Matching is case-insensitive.
- **Every containing root applies.** When allowed roots are nested, every root that contains the admitted workspace contributes its exclusions; a nearer root never hides a farther one's. A run applies at most 100 globs in all; a start whose containing roots contribute more is refused with `VSUP_CONFIG_INVALID`. A root with exclusions that cannot be canonicalized, other than one that no longer exists, refuses the start with `VSUP_CONFIG_INVALID` instead of dropping its globs, because whether it contains the workspace cannot be told; and a `context_files` entry that matches an exclusion is refused with `VSUP_WORKSPACE_INVALID`.
- **A directory glob needs `/**` for its contents.** For a review a glob such as `secrets` becomes the denylist entries `<root>/secrets` and `<root>/**/secrets`, and a glob with `/` becomes `<root>/<glob>`, with the configured root. For an edit the entries are rebased on the worktree: the part of the glob that remains after the root-to-repository path, so `project/fixtures/**` becomes `<worktree>/fixtures/**`, or `<worktree>/**` when the glob covers the repository itself. A name entry names the directory itself, so Vibe denies the directory but not necessarily the files below it (the fixed list likewise needs a separate `/**` entry for the contents of a reserved directory). The supervisor's handler denies everything beneath it, because it matches the name against every path segment. Write `secrets/**` so that Vibe's denylist covers the contents too.
- **Exclusions only narrow.** They are merged into the profile denylist after the fixed entries, which are never shortened or reordered; judged again by the approval handler (reason `path_excluded`, recorded as a `tool_denied` event); left out of the review's file listing; and checked by the startup read-back, so a denylist Vibe reports without a merged entry fails the run before the first turn (`readback_mismatch`).
- **Live.** An exclusion is not a boot-bound setting. A change to the file changes the `policy_revision` and applies at the next readiness check or start without a restart; a running run keeps the exclusions it was admitted with, saved in its record as `excluded_globs`, one `{ root, globs }` entry per contributing canonical root (a record written with a flat list loads it as globs under its admitted root). The fingerprint includes the exclusions, so readiness receipts and run records bind to them.

`scripts/v2-conformance-check.mjs` takes a repeatable `--excluded-glob <glob>`, validated by the same rules, so the target can observe the merged denylist in the effective configuration. Whether Vibe actually denies a call that matches a merged entry is an [unverified gate](compatibility.md#unverified-gates).

### Workspace budgets

`budgets` sets a daily cost ceiling for runs admitted under each allowed workspace root.

```toml
allowed_workspace_roots = ["~/src/project"]

[budgets."~/src/project"]
max_cost_usd_per_day = 50.0
```

- **Keys.** Each key must equal an entry of `allowed_workspace_roots`, written the same way (`~/src/project` is not `/Users/me/src/project`). Any other key is `VSUP_CONFIG_INVALID` with the field path.
- **Enforcement.** Before a new run is created or a readiness receipt is issued, the supervisor evaluates total estimated model costs across runs admitted under that root within the rolling 24-hour window (`createdAt >= now - 24h`), scanning both standard runs (`runs/`) and isolated session runs (`mcp-sessions/*/runs/`). If rolling 24h spending reaches or exceeds `max_cost_usd_per_day`, admission fails closed with `VSUP_BUDGET_EXCEEDED`, preventing run creation and reporting a blocker in `vibe_status`.
- **Live.** Like `excluded_globs`, `budgets` is a live setting. Modifying a budget ceiling takes effect on the next readiness check or start without restarting the server, and updates `policy_revision` so outstanding receipts bound to prior revisions safely expire.

### Policy authority

The selected configuration file is the only policy source. A running server rereads and validates it before every workspace readiness check and every start, with the same checks as at startup: a regular file of at most 1 MiB, opened without following a symlink, no symlinked parent directories, owned by the current user, not writable by group or others, strict schema, and unique roots within the allowed scope; an existing root must still be a canonical real directory, so a symlinked or over-broad root makes the whole file invalid. A missing, unsafe or invalid file fails closed with `VSUP_CONFIG_INVALID`; there is no fallback to an earlier read, a session snapshot or the defaults. An allowlisted root whose directory no longer exists (deleted or unmounted) denies only itself: it is left out of the effective allowlist, a check or start for a workspace under it fails with `VSUP_WORKSPACE_INVALID` naming the unavailable root (`details.unavailable_root`), and every other root keeps working. The server notes such roots on stderr at startup.

`allowed_workspace_roots`, `excluded_globs` and `budgets` are live: an added root is admitted, a removed root is refused, a changed exclusion applies and a changed daily budget takes effect on the next check or start, without restarting Codex, and each changes the `policy_revision`. The [preparation receipt](preparation.md) binds the whole policy except the roots, so a changed exclusion or budget also makes it stale until `prepare check` runs again. Every other key is boot-bound, because the server binds it at startup: `backend`, `vibe_version`, `paths.antigravity`, `paths.vibe`, `paths.app_server` and `paths.vibe_pin_manifest` (version, backend selection, executables and pin), `retention.days` (retention schedule), `limits.max_mcp_result_chars` (tool registration), `limits.worker_progress_timeout_seconds` (watchdog of running work), `limits.max_tokens` and `limits.max_cost_usd` (budgets), and the default turn, deadline and output limits (kept together so one server never mixes two limit sets). When the file changes a boot-bound key, readiness reports `restart_required: true` with the keys in `boot_drift`, and starts fail with `VSUP_RESTART_REQUIRED` instead of adopting part of the change.

A start records the `policy_revision` it was admitted under in its run record and start reply. A running run is never changed by a later edit. When its root is removed it keeps running to its normal end, and status, result and close keep working. A start also records the canonical root that admitted it (`admitted_root`). Worktree cleanup is admitted by that frozen admission, not by the current file, so narrowing the allowlist never strands a worktree: the saved source must still be its own canonical path inside the admitted root, and every existing removal check still applies (supervisor-owned run path, Git registration, a fresh export matching the saved artifact, a pristine worktree). Dirty or uncertain worktrees are retained with their reason as before. Records written before this field existed are checked against the boot configuration's allowlist.

## CLI

- `setup` writes a template and can plan a Codex registration; it does not silently rewrite unknown settings. For a new config, or when it resolves executables, it also sets the default `paths.vibe_pin_manifest`.
- `allow <workspace>` creates a missing private config when needed, then adds that canonical workspace root. It also works on a config that lacks `paths.vibe_pin_manifest` and then prints what is missing and how to fix it. Initialize a fresh explicit `--config` path with `allow` before running doctor or serve against it.
- `doctor [--json] [--config <path>]` reports local Node, Git, config, the `vibe-app-server` pin check, and the exact `application_entrypoint` and `runtime_module` that produced the report; its `provenance` also records the `backend` in use (`app-server` or `antigravity`). With no `paths.vibe_pin_manifest`, the `vibe` check fails with the remedy (set the path, run `pin-manifest`, restart the server) instead of the command refusing to run. The pin check resolves `vibe-app-server`, reads the installed package files and compares them with the manifest. It does not launch Vibe, make a model request, or prove provider authentication; the credential is looked up only when a run starts.
- `pin-manifest [--config <path>] [--executable <path>] [--output <path>] [--force]` writes the pin manifest for the Vibe installed on this machine. Run it on the machine that runs Vibe and review that the installed build is the one you intend to supervise, because the manifest records whatever is installed now. It locates the Python environment from the `vibe-app-server` script, requires Vibe 3.0.2, and hashes the files its `RECORD` lists; it fails if a listed file is missing or a file in the covered directories is unlisted. `--executable` overrides the `vibe-app-server` path (default: `paths.app_server`, else next to `paths.vibe`). `--output` overrides `paths.vibe_pin_manifest` and must be absolute. The file is private (owner-only), and an existing file is not replaced without `--force`. A configuration without `paths.vibe_pin_manifest` is accepted, so the command can write the file the path will name. If the configuration cannot be read at all, pass both `--executable` and `--output` and it is ignored with a notice on stderr; with only `--output` the command stops rather than guess which Vibe to pin.
- `serve --stdio [--config <path>] [--isolated]` runs the MCP server. It starts without `paths.vibe_pin_manifest`; every readiness check and start then fails closed with `VSUP_CONFIG_INVALID` and the remedy, because the policy is reread strictly each time.
- `prepare check --kit <directory> --config <file>` runs the [matched no-inference check](preparation.md) once and saves private evidence; it does not start inference.
- `task authorize --request <private-json> --owner-reference <instruction-reference> --expires-at <UTC-ISO-time> --config <file>` validates one review or edit request against current policy and writes a short-lived private grant authorizing one matching start. `--expires-at` must lie within 24 hours of registration. The private JSON has the shape `{ "operation": "review"|"edit", "request": { ...start fields... } }`; `request` uses the matching start tool's fields, excluding `authorization_id` and `attempt_id`, which the command creates. For example, a review request may contain `task`, `cwd`, `context_files`, `output`, `max_turns`, `timeout_seconds`, and `wait_seconds`; an edit request may contain `task`, `cwd`, `base_ref`, `acceptance_contract`, `prepared_inputs`, `max_turns`, `timeout_seconds`, and `wait_seconds`. Omit fields that do not apply. The command prints `authorization_id`, `attempt_id`, `request_sha256`, and `expires_at`; pass the first two with the exact authorized request to the matching MCP start tool. The owner reference is a bounded instruction reference, not a substitute for the request contents.
- `validation prepare|clean` manages [owned offline validation copies](validation-workspace.md), without running general project checks.
- `runs verify|export <run-id> --out <directory>` writes [sanitized verification/report bundles](workflow-acceptance.md); optional patch/events and coordinator validation manifests retain exact bindings. The report's `execution.state` keeps the outcome after close and `timestamps.started` the first observed running time; with `--include events`, the `reasoning_observation` diagnostic keeps `streamed_entries`, `history_entries` and `history_audited`. When the run saved its approval ledger, the bundle also holds `approvals.json` (listed in `SHA256SUMS`, with a summary under `approvals` in `report.json`) and `report.json` carries the run's `pin` identity; see [workflow acceptance](workflow-acceptance.md#approval-ledger-and-pin-identity).
- `runs list|show|tail|cleanup` inspects or cleans saved runs according to ownership and fresh-export checks. A saved record carries `state`, the terminal `execution_state` once the run has settled (kept through `closing` and `closed`), and `started_at` once the run was observed running, plus the usage, limits and pin fields in [Usage, ceilings and tool-call counts](#usage-ceilings-and-tool-call-counts). `runs list` prints every record under the data root's `runs/` and under at most 128 `mcp-sessions/session-*` directories, which is where the default isolated registration keeps its runs; more than 128 session directories, a symlink or a foreign owner is refused with `VSUP_INVALID_STATE`, and an unreadable record is skipped. `runs show` and `runs tail` read only the data root's `runs/`.
- `runs usefulness [--config <path>] [--since <YYYY-MM-DD>] [--json]` measures how often settled edit runs were accepted, from the coordinator's recorded assessments; see [workflow acceptance](workflow-acceptance.md#measuring-usefulness).
- `runs sarif <run-id> [--output <file>]` exports review findings for a run as a SARIF 2.1.0 log.
- `runs usage [--config <path>] [--since <YYYY-MM-DD>] [--root <path>] [--json]` aggregates daily usage across standard and isolated session runs, reporting date, workspace root, run count, total tokens, model calls, and estimated USD cost.

Use `vibe-supervisor <command> --help` for current options. The explicit selected config and the connection already open in a desktop client are separate facts; identify the owning connection by a `vibe_status` readiness call and its `server_version`, which works whether or not the client protocol has an initialization handshake, and confirm the exact five tools are callable there.

### Codex connection isolation

`setup` registers `serve --stdio --isolated` by default. The optional `setup --isolated` flag remains accepted. Existing non-isolated registrations are updated through the normal reviewed setup flow; configuration backup and confirmation rules are unchanged. A direct non-isolated `serve` still requires exclusive storage ownership and competing connections fail closed. Isolation changes storage ownership, not workspace permissions.

Saved UUIDs remain usable through `vibe_status`, `vibe_result` and `vibe_close` when an isolated reconnect selects a different free store. Lookup covers at most 128 entries in the selected configuration’s private `mcp-sessions` namespace. It requires a unique safe record and exclusive ownership of its store; a live owner, duplicate UUID or unsafe path returns an error without replaying the task.
