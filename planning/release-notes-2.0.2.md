# vibe-supervisor 2.0.2

Run reporting fixes found during the 2.0.1 target sitting. vibe-supervisor is a local MCP server that lets Codex delegate one bounded code review, or one isolated edit returned as a patch and never applied, to Mistral Vibe 2.26.1 exactly. It is an independent project, not affiliated with Mistral AI or OpenAI. Application policy, not an OS sandbox. macOS on Apple silicon only.

## What changed since 2.0.1

- **Closed runs keep their outcome.** The run record keeps `execution_state` (`completed`, `failed` or `cancelled`) after `vibe_close`, and `started_at` from the first time the run is observed running, so `runs export` no longer reports `execution.state` `unknown` and no start time for a completed run. Restart recovery records `failed` in both. Records written by 2.0.1 still report `unknown`.
- **Structured reasoning counts.** Each turn ends with a count-only `reasoning_observation` diagnostic: `streamed_entries`, `history_entries` and `history_audited`, kept by `runs export --include events`. No content is kept; zero means none observed, not that no reasoning was generated.
- **Documentation.** The target acceptance probe names `tools.file_system.write_file`; worker answer quality is stated as a limit.

Launch, the pin, the configuration read-back, the approval handler, the event validator, cleanup, packaging and the conformance script are unchanged.

## Install

The same steps as 2.0.1 with 2.0.2 names: download `vibe-supervisor-2.0.2.tgz`, `preparation-kit-2.0.2.tar.gz` and `SHA256SUMS` from `v2.0.2` and check them; install into a new private prefix (`$HOME/.local/vibe-supervisor-2.0.2`) with `--ignore-scripts`; run `prepare check --kit "$PWD/preparation-kit-2.0.2"` once, because the 2.0.1 preparation pass names other bytes; preview and write the Codex registration; check readiness with `vibe_status`. Keep the 2.0.1 prefix and the configuration backup until 2.0.2 works for you.

## Exact tested artifact

- Source: commit `[UPDATE AT PUBLISH]` (this release's tag).
- Archive: `vibe-supervisor-2.0.2.tgz`, SHA-256 `[UPDATE AT PUBLISH]`, packaged on the target under Node 20.19.0; installed candidate `[UPDATE AT PUBLISH]`.

## Acceptance

Gates to record on the 2.0.2 archive before publishing, none of which needs a hosted start:

| Gate | Result |
|---|---|
| Release verification on Node 20.19.0, offline installed-package smoke, package and kit identity | `[UPDATE AT PUBLISH]` |
| No-inference conformance check against the installed Vibe 2.26.1 | `[UPDATE AT PUBLISH]` |
| Installed SDK readiness; native desktop readiness | `[UPDATE AT PUBLISH]` |
| Hosted review and hosted edit | Documented limitation carried from 2.0.1 (owner decision); no 2.0.2 change touches it |
| MCP-client disconnect | `[UPDATE AT PUBLISH]`: recorded on 2.0.1, proposed as the basis for 2.0.2 |
| Execution provenance on a hosted run | Optional, with a new owner allowance; covered by tests |
| Clean-account installation | `[UPDATE AT PUBLISH]` |
| `permission = "ask"` per-tool fields; thinking-off effect; experiments fetch attribution; nested `run_typescript` gating | Open or not exercised, as for 2.0.1 |

## Limits

The same as 2.0.1: worker answer quality is not guaranteed and is not a supervisor gate; application policy, not an OS sandbox; the model-visible tool catalogue cannot be narrowed; the pin covers the installed `mistral_vibe` distribution's `RECORD` only; token and cost ceilings can overshoot by one model call; macOS on Apple silicon, Vibe 2.26.1 exactly, Node 20.19 or later, one active run per server.
