# vibe-supervisor 2.1.0 release notes (draft)

Draft for the GitHub release, written 2026-10-19 from main before the target sitting. Every `[UPDATE AT PUBLISH]` is filled from the merged `docs/acceptance.json` and the target evidence; a gate is called passed only when it is `VERIFIED` there. Delete this paragraph before publishing. The text below the line is the release body.

---

# vibe-supervisor 2.1.0

Observable and measurable runs. vibe-supervisor is a local MCP server that lets Codex delegate one bounded code review, or one isolated edit returned as a patch and never applied, to Mistral Vibe 2.26.1 exactly. It is an independent project, not affiliated with Mistral AI, OpenAI or Google. Application policy, not an OS sandbox. macOS on Apple silicon only.

## What changed since 2.0.2

- **Usage in every run record.** Prompt and completion tokens, model calls, a cost estimate marked non-authoritative, and tool-call counts (`executed`, `denied_by_handler`, `denied_by_policy`) in `meta.json`, the result and `runs list`. Optional ceilings `limits.max_tokens` and `limits.max_cost_usd` stop a run; they can overshoot by one model call.
- **Daily budgets per workspace root.** `budgets.<root>.max_cost_usd_per_day` refuses new runs and readiness once the rolling 24-hour estimate reaches the ceiling (`VSUP_BUDGET_EXCEEDED`). `runs usage` totals usage by day and root.
- **Excluded paths.** `excluded_globs`, per allowed root and anchored at it, keeps paths such as real-data fixtures, dumps or `*.tfvars` out of the review listing, Vibe's denylist and the approval handler (`path_excluded`), and the startup read-back checks the merged denylist.
- **Review findings and SARIF.** `vibe_review_start` with `output: "findings"` asks for a JSON findings block; the supervisor validates each finding against the workspace and the exclusions and saves `findings.json`. `runs sarif` converts it to SARIF 2.1.0.
- **Audit bundles.** Each run saves its approval ledger (`approvals.json`), and `runs export` includes it with the pin identity, digest-checked.
- **Measured usefulness.** `runs usefulness` reports how often decided edit runs were accepted, from the assessments recorded at close.
- **Cross-session inspection.** `runs list` also covers the isolated registration's session directories.
- **Experimental: Google Antigravity as the execution backend** (`agy 1.4.0`). Off by default; it needs `backend = "antigravity"` and `[experimental] antigravity = true`. Its tool gate is a `PreToolUse` hook that agy itself must honour, and `prepare check` runs five probes through agy to prove it. [UPDATE AT PUBLISH: "All five probes passed on the target" or "The probes have not all passed on the target: do not use it for real work"]. A USD budget cannot be enforced on it, because agy reports no cost. Running agy headless under a consumer Google sign-in may be outside Antigravity's consumer terms; prefer an API key or enterprise authentication.
- **Fixes.** Under `serve --isolated`, readiness now finds the preparation receipt in the selected configuration's directory. On macOS, a worker whose process group holds only zombies is no longer reported as `worker_termination_unverified`.

Records written by 2.0.x load unchanged. The five MCP tools, the pin, the read-back, the approval handler, the event validator and cleanup keep their 2.0 rules.

## Install

The same steps as 2.0.2 with 2.1.0 names: download `vibe-supervisor-2.1.0.tgz`, `preparation-kit-2.1.0.tar.gz` and `SHA256SUMS` from `v2.1.0` and check them; install into a new private prefix (`$HOME/.local/vibe-supervisor-2.1.0`) with `--ignore-scripts`; run `prepare check --kit "$PWD/preparation-kit-2.1.0"` once, because a 2.0.x preparation pass names other bytes; preview and write the Codex registration; check readiness with `vibe_status`. Keep the 2.0.2 prefix and the configuration backup until 2.1.0 works for you. Adding `excluded_globs` or a budget changes the policy, so run `prepare check` again after editing them.

## Exact tested artifact

- Source: commit [UPDATE AT PUBLISH] (`v2.1.0` tag).
- Archive: `vibe-supervisor-2.1.0.tgz`, SHA-256 [UPDATE AT PUBLISH], packaged on the target under Node 20.19.0 and npm 10.8.2; installed candidate [UPDATE AT PUBLISH].

## Acceptance

| Gate | Result |
|---|---|
| Release verification on Node 20.19.0, offline installed-package smoke, package and kit identity | [UPDATE AT PUBLISH] |
| No-inference conformance check against the installed Vibe 2.26.1 | [UPDATE AT PUBLISH] |
| Excluded-glob read-back; denial on a hosted review | [UPDATE AT PUBLISH] |
| Native desktop readiness on the candidate | [UPDATE AT PUBLISH] |
| Hosted review and edit: usage recorded, export with ledger and pin, close with assessment | [UPDATE AT PUBLISH; "not run, no hosted allowance" if step 3 did not happen] |
| Antigravity probes (hook invoked and deny honoured, failure modes deny, stream shape, proxy honoured, project configuration not loaded) | [UPDATE AT PUBLISH] |
| Antigravity hosted review and edit | Not run; the backend stays experimental |
| MCP-client disconnect | Passed on 2.0.1; [UPDATE AT PUBLISH: carried over or rerun] |
| Clean-account installation | Pending: postponed by the owner |
| `permission = "ask"` handler half; thinking-off effect; experiments fetch attribution; nested `run_typescript` gating | [UPDATE AT PUBLISH] |

## Limits

Worker answer quality is not guaranteed and is not a supervisor gate. Application policy, not an OS sandbox. The model-visible tool catalogue cannot be narrowed. The pin covers the installed `mistral_vibe` distribution's `RECORD` only. Token and cost ceilings can overshoot by one model call, and costs are estimates. macOS on Apple silicon, Vibe 2.26.1 exactly, Node 20.19 or later, one active run per server. The Antigravity backend is experimental.
