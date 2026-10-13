# Current handoff

Updated 2026-10-13. This document alone defines current priorities. [docs/history/](docs/history/) keeps only what the current work uses: the rc.28 brief, runbook and evidence template, the acceptance log, the latest reviews, the 2.26.1 compatibility audit, the install notes and the 1.0 article draft. Everything older (earlier handoffs, plans, phase evidence, rc.2 to rc.17 test records) was removed from the tree on 2026-10-12 and is in Git history at `c510513`.

## What this is

A local MCP stdio server that lets Codex delegate one bounded code review or one isolated edit at a time to Mistral Vibe 2.26.1. Codex sees five tools: `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result` and `vibe_close`. A review may only read and search an allowlisted workspace; an edit runs in a supervisor-created detached Git worktree and comes back as a patch, never applied, committed or pushed. Shell and network tools are off. This is an application policy boundary, not an OS sandbox. Supported: macOS Apple silicon, Node 20.19 or later, Vibe 2.26.1 exactly.

| Area | Code |
| --- | --- |
| MCP server and tool schemas | `src/mcp/` |
| Run lifecycle, one active slot, deadline, watchdog, retention, owner lock, policy reread and readiness receipts, saved-run routing after `--isolated` reconnect | `src/core/`, `src/config/policy.ts` |
| Vibe adapter and pinned launcher (private homes, filtered environment and tools, persistence shim, turn-limit corroboration) | `src/backends/` |
| Worktrees, private-index export, verified cleanup | `src/git/worktree.ts` |
| Paths, child environment, redaction | `src/security/` |
| Configuration and `--isolated` session homes | `src/config/` |
| CLI: `setup`, `allow`, `doctor`, `serve`, `runs` | `src/cli.ts`, `src/cli/`, `src/diagnostics/doctor.ts` |
| Release and coordinator scripts (not shipped) | `scripts/` |
| Coordinator skill (shipped) | `skills/vibe-supervisor` |

Behaviour: [docs/functionality.md](docs/functionality.md); interface: [docs/reference.md](docs/reference.md); boundary: [docs/security.md](docs/security.md); Vibe assumptions and gates: [docs/compatibility.md](docs/compatibility.md); errors: [docs/errors.md](docs/errors.md) (generated); machine-readable gates: `docs/acceptance.json`. AGENTS.md lists the boundaries that must not change.

## Status

**Candidate: `0.9.0-rc.28`**, installed on the macOS Apple-silicon target and exercised through native Codex. Runtime source is `bef09855cd8104b979b962462ae9d87062ed8a9d`. The primary target checkout is an older dirty tree; preserve it and use a clean source copy for integration.

Preparing-machine verification passed (629 tests, 2 skipped, Python tests, lint, typecheck, build, secret scan, SBOM and offline package smoke). The target rebuilt that unchanged revision offline, verified installed bytes and obtained native review/edit readiness. Exact target archive SHA256 is `9179a091830e548d9ebd3c13bd6f12997f22a86bda6964d827c23e1a55773bbf`; do not confuse it with the preparing-machine archive.

Hosted target evidence: all five fixture matrix cases passed without retries or repairs. These cover useful normal reviews, a correct isolated edit verified in a disposable export, and both expected incomplete turn-limit outcomes. A separate real-project review proves authenticated inference and read-only lifecycle but its findings failed acceptance; downstream Luna work does not change that failure.

Desktop active-disconnect case 6 is INCONCLUSIVE: the worker reached end_turn before interruption. It was closed and its dirty worktree retained. Official-client disconnect case 7 is NOT RUN. One authorized allowance remains; no automatic retry of case 6 is allowed. Usage/cost is UNKNOWN. **rc.28 remains a prerelease, not stable v1.0.**

See [target acceptance](docs/history/reviews/rc28-target-test-2026-10-13/STATUS.md), its redacted run records, exact fixture assignments and checksum manifest. Private project source and search-console evidence are not published here.

The coordinator tools added by the target, `scripts/v1-fixture-verify.mjs` and `scripts/v1-disconnect-observer.mjs`, are tested by the normal vitest suite.

Registration uses the explicit selected config with --isolated. Group/world-writable configs fail closed; native handshake/readiness, not CLI version, identify the active desktop connection.

## 1.0 gates (owner decision 2026-10-12)

Required, all on the exact rc.28 artifact: native readiness on the Codex desktop connection; five hosted runs (review, edit, review to the turn limit, edit to the turn limit, review), each started with a readiness receipt; one real active disconnect; provider authentication (recorded by the first hosted run). Status after the 2026-10-13 sitting: native readiness, the five hosted runs and provider authentication are VERIFIED (`docs/acceptance.json`); the active disconnect is INCONCLUSIVE. Not required: the clean-account install (1.0.1), CI on exactly Node 20.19.0, and the live-allowlist and boot-key observations (covered by deterministic tests). Open owner decision: whether the disconnect gate needs one real disconnect (as decided on 2026-10-12) or both a desktop and an official-client observation (as `docs/acceptance.json` and next step 2 read).

## Next steps

1. **Published:** [rc.28 prerelease](https://github.com/crew-lab/codex-vibe/releases/tag/v0.9.0-rc.28) at runtime source `bef09855cd8104b979b962462ae9d87062ed8a9d`, with package, SBOM, generated acceptance report, checksums and dated target supplement. Downloaded package identity matches the tested archive. See target evidence release-verification.json. The separate evidence/tooling commit is not the tested runtime source.
2. Reconcile the active-disconnect contract: acceptance metadata calls for desktop and official-client observations; retain both until an explicit owner decision changes the gate. The desktop attempt consumed its allowance without proving interruption. No retry is authorized by the one remaining official-client allowance.
3. Finish independently observed active-disconnect acceptance with an explicit bounded task, live ownership/process-group observer and evidence of a running worker before disconnect. Stop on first unexpected failure; do not replay tasks.
4. Done 2026-10-13: under exactly Node 20.19.0, a clean clone of `7c7ba0e` (runtime source identical to rc.28) passed the full `verify:release` on the preparing machine (629 tests, 72 Python tests, and the 13 coordinator-tool tests then run separately).
5. Owner decision on 1.0 identity: the archives built from the same source on the two machines differ (`61ca4ee9…` here, `9179a091…` on the target), so packaging is not byte-reproducible, and the prepared branch `claude/v1.0.0` changes the version and docs, which makes new package bytes. Options: release the exact tested rc.28 archive as 1.0.0 evidence by policy (version string stays 0.9.0-rc.28), or bump to 1.0.0 and re-run a small confirmation subset on the new archive.
6. Only then decide the final v1 source/package identity, exact-artifact validation and publication. Version/doc changes create new package bytes; do not automatically transfer hosted PASS to a new archive. No stable tag or release before required gates and owner go/no-go.

## After 1.0

- Clean macOS account install (1.0.1).
- Pruning of `--isolated` session directories and a router that tolerates one bad sibling or more than 128 sessions: ready on branch `claude/session-pruning` (on GitHub, `bdc3ca4`, based on rc.28; needs a rebase before merging).
- From the reviews: receipt reuse wording; `runs cleanup` and failed-run retention wording; the config fingerprint using `os.homedir()` instead of `HOME`; the `setup` restart message naming the registered path; the MCP SDK's 4-second SIGKILL after stdin closes, which can cut a slow edit shutdown short (recovered by design on the next start).
- Tooling waiting on the push token's `workflow` scope: `claude/release-workflow` (tag-triggered release) and `claude/ci-node-floor` (CI on exact Node 20.19.0 and 24).

## Working rules

- Never run a real Vibe on the preparing machine. Hosted evidence comes from the target machine only, with the owner's authorization and budget.
- Version numbers and runtime code change on main; the target machine records evidence and changes no code.
- Push with `make push` (main) or `make push-branch BRANCH=<name>`. Before a release candidate, `VIBE_SUPERVISOR_TEST_NPM_CACHE=<populated cache> npm run package:rc`.
- Keep credentials and private session histories out of every committed file.

## Fixed scope and safeguards

Exactly five one-shot MCP tools; no ACP, continuation, recovery replay, queue, automatic patch application, worker shell or network, or new platform scope. Reviews are read-only; edits use isolated detached worktrees. Retain canonical allowlists, private child homes, filtered environments, redaction, bounded deadlines and output, owner locks and verified cleanup. Missing evidence remains unknown; rc.28 is not certified stable 1.0.
