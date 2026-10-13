# Ecosystem notes (2026-10-13)

What changed around vibe-supervisor in the last weeks, read from each project's own sources on 2026-10-13, and what each change means for us. Nothing here was run. Companion to the [competitive landscape](competitive-landscape-2026-10-13.md).

## Mistral Vibe

2.26.1 (2026-10-09) is still the latest release and the pinned version. Read at tag `v2.26.1`: `vibe/cli/entrypoint.py`, `vibe/_experimental_harness.py`, `vibe/app_server/run_export.py`, README and CHANGELOG.

- **The legacy harness is scheduled for removal.** Since 2.26.0 the Unified Harness is the unconditional default and a missing runtime is a startup error rather than a fallback. The source describes `--legacy-harness` as a "temporary escape hatch, kept until the legacy runtime is removed" and `--experimental-harness` as "kept only until the legacy harness cutover removes it". The supervisor forces `--legacy-harness` and validates the legacy engine's source signatures. The 2.26.1 pin keeps working as long as 2.26.1 is installable (`uv tool install mistral-vibe==2.26.1`), but no later Vibe can be adopted without an adapter for the Unified Harness and a new compatibility audit: project discovery, persistence, the permission predicate and the tool allow/deny environment. The Unified Harness adds `enable_subagents`, `enable_background_processes` and managed shell tools, which such an adapter must turn off.
- **Programmatic mode has a contract we do not use yet.** `--output-dir DIR` writes `export.json` on every exit with the Vibe version, effective config, `usage` (input, output, cached and total tokens), `cost_usd`, `steps`, `warnings`, stop reason and outcome, plus a copy of the session journal. `--time-limit SECONDS` interrupts the run, writes the export and exits 3; SIGTERM does the same. `--prompt-file PATH` reads the prompt from a file. Exit codes are 1 for a usage or config error, 2 for an infrastructure failure and 3 for a limit or refusal; outcomes include `turn_limit`, `token_limit`, `price_limit`, `deadline` and `refusal`. This answers the usage question in the landscape: Vibe reports usage and cost per run in `export.json`, and the supervisor records UNKNOWN because it never asks. The README says only the legacy runtime reports a refusal as `refusal`, so the export is written on the legacy path too; whether `usage` is filled there needs one observation.
- `vibe -p` no longer offers the `cron` tool, and the bundled local Devstral model is gone.

## Model Context Protocol

The current revision is 2026-07-28, replacing 2025-11-25. The pinned SDK (`@modelcontextprotocol/server` and `core` 2.3.0) implements both; the server registers five tools over stdio through `serveStdio`, and nothing in the revision changes its behaviour. What it means for wording and later design:

- Stateless: there is no `initialize` handshake; each request carries the protocol version and client capabilities in `_meta`, and `server/discover` is the version and capability probe. "Verify the live MCP handshake version" in our docs becomes "check `server/discover` or make a readiness call" once Codex speaks the new revision to us. Third-party write-ups report opt-in support per server in Codex since 0.147; the official config reference lists no such key.
- Tasks are an extension (`tasks/get` polling, `tasks/update` for input), which is the shape of our start, status and result tools. Not worth adopting before clients use it by default.
- Multi round-trip requests replace server-initiated elicitation; we have none. Roots, sampling and logging are deprecated; we use none. `tools/list` should be deterministic, which ours is, and list results carry `ttlMs` and `cacheScope`, which the SDK fills.

## Codex

0.162.0 (2026-10-08), 0.162.1 (2026-10-09) and 0.163.0 alphas on 2026-10-13. From the release notes and the config reference:

- "Add tools for creating and listing managed Git worktrees from trusted local projects." Codex-native worktrees hold Codex's own work; the supervisor's worktree isolates the worker and returns a patch, a different job. A coordinator could use a Codex worktree as the separate verification copy the skill asks for.
- "opt-in ranked tool search in Code Mode", and the config reference knows `tool_search` and `tool_search_always_defer_mcp_tools`: MCP tool definitions can be loaded on demand instead of listed up front. Read the skill's "exact five-tool catalog" as "the five tools are callable on this connection"; the readiness call proves that. Verify on the target with tool search enabled before saying more.
- `[mcp_servers.<id>]` supports `required`, `enabled`, `enabled_tools`, `disabled_tools`, `default_tools_approval_mode`, `tool_timeout_sec` (default 60 s) and `startup_timeout_sec` (default 10 s). `setup` writes command, args and the two timeouts. `required = true` is the Vibe-mandatory testing mode from the connection strategy, still unverified on the desktop.
- Remote compaction for long threads: a readiness receipt lives 10 minutes, so a compacted thread checks readiness again, which the skill already says.

## What this changes for us

1. Ship 1.0 on the verified rc.28 runtime, pinned to 2.26.1. Nothing above is a reason to wait.
2. The first runtime change after 1.0: pass `--output-dir` and `--time-limit`, read `export.json` for usage, cost and outcome, and corroborate the stop reason from it rather than from markers alone. One hosted observation per operation on that candidate.
3. The 1.1 theme is a Unified Harness adapter with the same boundaries, started before Mistral removes the legacy runtime. Until it exists the pin stays exactly 2.26.1.
4. Docs: reword the handshake check for stateless MCP; after a target check, note tool search and `required` in the install notes.

Sources: `github.com/mistralai/mistral-vibe` at `v2.26.1` (files named above, CHANGELOG.md, README.md); `modelcontextprotocol.io/specification/2026-07-28/changelog`; `github.com/openai/codex/releases`; `learn.chatgpt.com/docs/config-file/config-reference`.
