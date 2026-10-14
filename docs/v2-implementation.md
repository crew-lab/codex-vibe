# Supervisor 2.0 implementation checkpoint

This is an implementation checkpoint, not a release or acceptance report. The goal is the full approved Supervisor 2.0 plan. Work is isolated on `codex/unified-harness-v2`, based on main `d9d9dae`. The primary dirty checkout and installed runtimes are preserved.

## Approved decisions

- Start 2.0 now, independently of unfinished 1.0.1 acceptance.
- Vibe 2.26.1 exactly; `mistral-medium-3.5`, reasoning `high`.
- Supervisor-owned stdio search: `list_files` and line-oriented JavaScript-regex `grep`; no worker shell, external network, or inherited MCP servers.
- Prohibited tools may be model-visible, but execution is refused. Native reads and edit writes require per-invocation client approval.
- Vibe may write a private temporary store. No reasoning or raw frames in Supervisor persistence; clean temporary directories only after verified termination. Deletion is not secure erasure.
- Optional `limits.max_session_tokens` and `limits.max_estimated_cost_usd`, disabled when omitted. These are sampled ceilings with possible in-flight overshoot.
- New backend uses existing five MCP operations, detached edit worktrees, snapshots, receipts, owner locks, limits and protected cleanup.

## Implemented foundation

- Bounded JSON-RPC transport: split UTF-8 frames, correlation, duplicate callback-id rejection, queue/frame/byte limits, timeouts, response-after-ack hook, raw error exclusion.
- Usage accounting with validated counters, fresh-session baseline, cached-token pricing, non-authoritative USD and sticky ceiling stop reasons.
- Strict configuration, policy fingerprints and restart-required handling for ceilings and `paths.vibe_app_server`.
- Persisted schemas and parsers accept `app-server` identity and optional ceilings, including fractional costs.
- Read-only workspace search with sensitive/reserved/generated exclusions, symlink/traversal refusal, file-identity checks, signed run/snapshot-bound cursors, explicit incomplete results and a terminated regex worker.
- Official MCP stdio service exposing exactly the two search tools, sanitized errors, parent/deadline watcher and stdin-close shutdown.
- Supervisor-owned session profile with private HOME/VIBE_HOME/TMPDIR, disabled foreign integrations, an explicit search launch and native permissions `ask` with empty path allowlists.
- Startup read-back validators for session/harness/root identity, exact executable integrations, active agent, high reasoning, disabled features, permission bypass, tools and private session logging.
- Compatibility manifest independently derived from the official macOS ARM wheel SHA-256 `515d8b5b10a5a2b10eb4628294d30ca90a27e9314f4d8aaea7514b733179ee36`, with four critical files matching the tagged-source audit. Node verifies all 776 wheel files, the complete runtime namespace inventory and 89 unconditional dependency versions before launch. Reference: [pinned PyPI metadata](https://pypi.org/pypi/mistral-vibe/2.26.1/json).
- Public-entrypoint Python bootstrap, isolated/no-site flags, private bytecode prefix, second file-hash check, extracted bounded credential lookup and parent/deadline watchdog. It does not patch Vibe internals.

The full adapter and independent fake server now exist, and RunManager selects app-server by default. Setup/Doctor and early storage guards are integrated; release assets and legacy removal remain incomplete. Package and lockfile root metadata now identify `2.0.0-rc.1`, with unchanged dependency pins. [ADR 0004](adr/0004-app-server-client.md) records the approved engine and persistence decisions. A successful test of these modules does not establish installed-harness or hosted behavior.

Approval correction: unified callbacks now correlate to explicitly linked running effects, preserving session/turn/argument checks and refusing missing links or terminal effects. The independent wire fixture emits the actual running shape. All 28 focused policy/adapter tests, typecheck, lint and whitespace passed again after the candidate metadata/ADR update. The version check exposed the stale plugin scaffold version; it was synchronized to `2.0.0-rc.1`, and all six version/link tests passed. This does not establish plugin installation.

Latest continuation: corrected history retrieval to bounded backward pagination, assembling pages chronologically before auditing effects. An independent older-page unsafe-effect scenario now proves that earlier execution cannot be omitted from the terminal audit; repeated cursors fail. Session callback arrays are validated even during reconciliation. Startup responses preserve actual terminal outcomes instead of labeling every settled run completed. Typecheck, lint and 47 selected tests passed; after the terminal-state correction, typecheck, lint, all 11 adapter integration tests and whitespace checks passed again.

Verification on 14 October: the full Node suite passed 701 tests, with the two existing installed-Vibe cases skipped. After the subsequent transport-close, legacy-ceiling guard and search-environment changes, lint, typecheck, build and all 51 foundation tests passed again. The search integration starts the compiled service through the official MCP client and deliberately supplies a fake inherited provider-key sentinel; the owned `/usr/bin/env -i` launcher removes it before Node starts. This checks the owned launch mechanism, not Vibe's installed discovery/invocation paths. Whitespace checks and semantic equality of the minimally changed JSON schemas passed. No new hosted run, installed unified-harness acceptance, private installation or registration change has occurred.

The subsequent seven compatibility-verifier tests and six Python bootstrap tests passed. Actual installed runtime comparison passed all 776 file hashes and 89 dependency versions, and the isolated CPython 3.12 `--check-only` bootstrap verified the 776 files without importing Vibe or reading provider credentials. This is static compatibility evidence; it does not establish a server handshake, effective tool inventory, model inference, native readiness or actual approval behavior.

The normal Python verification command now includes the standalone bootstrap tests; all 101 Python tests passed. Latest lint, typecheck, build and whitespace checks passed. No processes or Vibe runs are left pending from these checks. The next implementation action is callback/effect correlation and the full app-server run adapter, followed by default-engine wiring and its independent fake-server integration suite.

## Source findings used in implementation

Storage continuation: isolated startup now checks template/session run identities before adopting a session or replacing its configuration, then repeats the selected-session check under its owner lock. Legacy or unverifiable run metadata and symlinked storage roots fail closed. Routing fixtures now use app-server records and the restart test confirms no original task replay or saved-PID signaling. Added programmatic/ACP rejection cases preserve both metadata and the old session config byte-for-byte. Typecheck, lint, whitespace and all 23 routing/recovery tests passed after the final lock-scoped preflight change. Legacy-source acceptance remains separate.

CLI integration continuation: setup now discovers `paths.vibe_app_server`; Doctor resolves the app-server and verifies trusted wheel/dependency identity without executing the candidate or importing Vibe. Reference/compatibility docs distinguish this static check from live session controls. Config default-directory expectations now cover the separate app-server namespace. Typecheck, lint, whitespace and all 56 config/setup/Doctor tests passed. Full suite session 7163 finished with exit 1: 717 passed, 21 failed, two skipped across 76 files. Log: `/private/tmp/codex-vibe-v2-current-tests.log`. Its two setup failures predate corrected expectations. Remaining default-engine fixture/readiness failures require porting and diagnosis; do not claim full verification. No test process remains pending from this session.

- Installed `ProtocolModel` serializes typed keys by camelCase aliases. Native effect inputs use `filePath`, `oldString`, `newString`, and related public names, not the draft's `file_path` wire assumption.
- Vibe's `resolve_path_permission` returns ALWAYS for an explicit file allowlist before its configured `ask` fallback. New native allowlists are empty; authorization belongs to the callback.
- Supervisor search's public names are `supervisor_search_grep` and `supervisor_search_list_files`; Rust programmatic routes are `mcp_supervisor_search.grep` and `mcp_supervisor_search.list_files` at the pinned source.
- The public callback carries `callback.callbackId`, `sessionId`, `turnId`, `detail.effect`, offered `choices` and optional `relatedEntryId`; reply first with `{callbackId, accepted}`, then send `callback/result`. Decision output is an invocation-only approve/deny, never a persistent grant.
- Permission contexts may allow private scratchpad paths before configured file denials. The unified ToolManager's actual context and nested paths must be covered by installed conformance; do not certify the configuration validator alone as preventive proof.

## Remaining implementation

1. Independent fake app server and scenarios from the pinned public protocol.
2. Validated callback/effect correlation, offered choices, five-second deny deadline, effect history updates, unknown-entry failures and bounded paginated gap reconciliation.
3. Integrate the verified compatibility manifest and standalone public-entrypoint bootstrap into the run adapter. Wire the private original-home credential handoff and remove it before Vibe imports; ensure compiled packaging contains the manifest/bootstrap and excludes test sources. No expected hash manifest generated from an installation and automatically trusted.
4. Complete `SupervisorBackend` adapter: initialize, fresh session, read-back, model write/read-back, baseline accounting, one turn, sanitized message output, outcome mapping and interrupt/EOF/verified group termination. All cancellation and late-event ordering must retain RunManager's settlement guarantees.
5. Wire the new engine into RunManager, CLI/doctor/readiness and isolated routing. Separate 2.0 storage; refuse legacy storage reuse; no legacy-engine fallback or replay.
6. Update version to 2.0.0-rc.1, lockfile metadata, assets, acceptance/SBOM/packaging scripts, docs and ADRs. Remove legacy engine and monkeypatch assets from the final 2.0 package after adapter integration passes; preserve standalone bootstrap helpers.
7. Meaningful integration tests for startup drift, native/nested approval denials, malformed input, gaps, ceilings, cancellation during initialization, wedged/parentless workers, raw reasoning exclusion, storage residue and exact edit export/cleanup.
8. Verify release on Node 24 and exactly 20.19.0, offline package/smoke, freeze one archive with source identity and checksum. Prepare candidate-specific installation, rollback, conformance and acceptance kit.

## Acceptance still required

Real installation/registration needs separate authorization. Installed conformance uses a deterministic local mock provider without real credentials or hosted inference, and checks actual direct/nested gates and project canaries. Then native readiness and a separately authorized three-start batch: search-dependent review, independently verified edit, active disconnect. Stop on the first failure; no automatic retries. Fresh-account installation and stable publication remain owner-authorized gates.

Report useful-answer acceptance, elapsed/startup/first-response timing, usage, estimated cost and cleanup. No performance improvement claim without comparable measurements. If installed controls cannot prevent prohibited execution or contain private state, activation is blocked; do not relax policy to make tests pass.
