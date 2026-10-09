# Project `.agents` isolation

Date: 2026-10-09. Base: `8da1c7d` (rc.10). Implementation branch: `codex/project-agents-isolation`, the then-local uncommitted candidate `0.9.0-rc.11`. The primary checkout and UARoots changes are preserved; at the time of this rc.11 evaluation, commit, push and publication were not authorized.

## Boundary and source inspection

Installed Vibe 2.25.8's `vibe/core/config/harness_files/_harness_manager.py` was read before changing the guard. Both entrypoints initialize user/project sources. Session workspace roots can enter `project_roots` independently of cwd trust, so relying only on untrusted state is insufficient. Config layers use `project_source_enabled`; project agents/tools/plugins/skills/hooks/prompts and automatic AGENTS.md injection use `project_roots`.

The production shim now verifies normalized module-source SHA-256 `43fc21e2d1a7359ac896ab41e902d927d363ba4ef8f989909af8bcca4b82cbac` and both property signatures, then sets project-source eligibility false and project roots empty on the class. Existing instances, direct constructions and dataclass session copies share the patched boundary. This runs before backend import and credential lookup. Drift or unavailable source fails closed. No source directory is deleted, masked or copied to bypass policy. Root `.vibe` remains refused; only a real non-symlink `.agents` directory is admitted, and its file-tool denials and grep exclusions remain.

## Verification

- Targeted lifecycle/installed-profile checks: 22 tests passed. Both installed-Vibe modes used network-disabled fixtures without credentials, with project instruction/skill canaries, trusted-cwd and extra-root/session-copy cases; private supervisor profiles and file boundaries were retained.
- Python checks: 83 tests passed, including source/signature drift, unavailable source, no partial mutation, both entrypoint startup order, and refusal before credential/backend execution.
- Full release/package checks: passed (`npm run package:rc` with a populated offline cache). Lint, typecheck, build, 738 TypeScript tests (2 skipped), 83 Python checks, deterministic acceptance, secret scan, SBOM, and offline installed-package CLI/MCP checks passed. The first package attempt found a stale generated errors document; it was regenerated and the full verification passed.
- Real UARoots hosted check: passed through a fresh official MCP client connected to installed rc.11, with the seven ACP tools and strict edit schema. Run `8c5becee-ef0a-49d2-a21d-2d212e9531b6` accepted the existing real `.agents` directory, completed with `end_turn`, returned package facts `uaroute` / `1.0.0`, reported verified integrity and no write tool, and was closed. Saved native-history audit counted one `read_file`, zero `grep`, zero unexpected calls and a final answer. No edit worktree was created. The original driver incorrectly checked the generic summary rather than the transcript; its failure is preserved alongside the corrected saved-artifact audit, without repeating inference.

## Installation and evidence

Installed locally under `/Users/roman/.local/share/vibe-supervisor/rc11`; the CLI alias, two skill links and the single Codex MCP registration now point to rc.11. Prior rc.4/rc.10 installations and the registration backup are retained. The original Supervisor configuration and its five allowed roots were preserved; the new private template uses ACP. Doctor passed, including pinned Vibe 2.25.8 and ACP initialization. A previously loaded chat still needs MCP reconnection or a new session to use the updated registration; the fresh client above independently proves the installed version, not desktop reload.

Package, logs, installation metadata, the source patch and filtered hosted evidence are retained in `/Users/roman/.local/share/vibe-supervisor/rc11/installation-evidence-2026-10-09`. Native histories stay in the private runtime home and are not copied into this report.

## Remaining limits

The application policy is not an OS sandbox. This feature does not certify a 100-run soak, native desktop reload, permission/elicitation callbacks, clean-account installation, Intel, or another Vibe version. Earlier failed runs and approval refusals remain failures; future evidence must identify the changed candidate and actual connection.

## Subsequent delivery update

This rc.11 report remains historical evidence. rc.14 is now installed; the subsequent hosted pilot, product correction and release checks are recorded in [the adoption evaluation](rc13-worker-adoption-2026-10-09.md). The user subsequently authorized committing and pushing the combined delivery branch. Earlier rc.11 measurements are not relabeled as rc.14 results.
