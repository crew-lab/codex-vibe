# Vibe 2.26.0 source comparison — 2026-10-08

Static comparison of the published macOS arm64 wheels of mistral-vibe 2.25.8 (sha256 `9b2a3f9c1078e8cf2bd0a2cd860336b3ad8039894ecf423994588be4545d73ea`) and 2.26.0 (sha256 `bc8d3ec765d844be7b51ec0247296042113784b8b6925aac5e445cec69409a27`), downloaded from PyPI, hash-checked, unpacked and read. Nothing was installed or executed; no hosted run was made. Paths below are inside the wheels.

## Result

No supervisor assumption is broken by 2.26.0 on static reading. Only dist-info, `_bin/vibe-rs` and Python files differ; no Python file was removed.

- `--legacy-harness` still exists (`vibe/cli/entrypoint.py:134-140`, `vibe/acp/entrypoint.py:44`, `vibe/app_server/stdio.py:89`) and with it no unified host is built (`vibe/app_server/_runtime.py:1195-1229`). It is now documented as a temporary escape hatch kept until the legacy runtime is removed. The unified harness is the unconditional default (`vibe/_experimental_harness.py:101-137`) and a missing unified runtime aborts startup instead of falling back.
- Byte-identical: `vibe/cli/programmatic.py`, `vibe/core/session/session_logger.py` (the shim's three patched methods), `vibe/core/agents/models.py` and `manager.py` (Plan and Accept Edits), `vibe/core/tools/utils.py`, `builtins/read_file.py`, `builtins/grep.py` (resolver and the recursive grant), `vibe/core/config/layers/environment.py`, `vibe/utils/keyring.py` (Keychain services).
- Unchanged in substance: CLI flags `--prompt`, `--max-turns`, `--output`, `--agent`; console scripts; Python >= 3.12; ACP protocol 1, `loadSession: true`, stop-reason mapping (`vibe/acp/agent.py:819-851`), permission option kinds; the turn-limit marker text (`vibe/core/middleware.py:57`) and the programmatic exit 1 on stderr (`vibe/cli/cli.py:220`).
- Changed in ways that touch the profile: `session_logging.generate_titles` defaults to true but is limited to the `cli` and `desktop` entrypoints (`vibe/app_server/_runtime.py:260-267`), so ACP and programmatic runs should not trigger it; `auto_compact_threshold` now compacts at 80 % of a model's context window by default, which can change turn and token use on long runs; `VIBE_HOME` resolution moved to `vibe/utils/vibe_home.py` with the same behaviour; `ToolManager` gained a `default_permission` argument whose default keeps existing callers unchanged.
- Not determined statically: whether streaming output and ACP replay are byte-for-byte equivalent after the `vibe/app_server/` refactor (about 50 files changed), and when the legacy runtime will be removed.

## What supporting 2.26.0 would take

Change the pin in `src/backends/pinned.ts` and the shim's `EXPECTED_VERSION`, update the compatibility documentation, optionally set `VIBE_SESSION_LOGGING__GENERATE_TITLES=false` in the profile and have `compat:probe` assert that `--legacy-harness` is accepted, then repeat on the target machine: `compat:probe`, the installed-resolver tests, the launcher logger fixture, and hosted runs covering the turn-limit marker, permission callbacks, `session/load` replay, the effective tool inventory and compaction.

Recommendation: keep 2.25.8 for 1.0, whose remaining gates are already scoped to it, and bump to 2.26.0 as a follow-up release. The legacy runtime that 1.0 forces is now explicitly temporary, so a later Vibe release will need the unified-harness validation recorded as R3.
