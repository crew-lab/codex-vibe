# Current handoff

Updated 2026-10-13. This document alone defines current priorities. [docs/history/](docs/history/) keeps only what the current work uses: the rc.28 brief, runbook, evidence template and target evidence, the acceptance log, the latest reviews, the 2.26.1 compatibility audit, the install notes, the [competitive landscape](docs/history/competitive-landscape-2026-10-13.md), the [ecosystem notes](docs/history/ecosystem-2026-10-13.md) on Vibe, MCP and Codex, the [strategy](docs/history/strategy-2026-10-13.md) after rc.28 (owner's wins, community, propagation, case study) and the 1.0 article draft. Everything older was removed from the tree on 2026-10-12 and is in Git history at `c510513`.

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

**Candidate: `0.9.0-rc.28`, published as a GitHub [prerelease](https://github.com/crew-lab/codex-vibe/releases/tag/v0.9.0-rc.28)** from runtime source `bef09855cd8104b979b962462ae9d87062ed8a9d`, archive SHA256 `9179a091830e548d9ebd3c13bd6f12997f22a86bda6964d827c23e1a55773bbf` (built and installed on the target machine; the preparing machine's build of the same source, `61ca4ee9…`, differs, so packaging is not byte-reproducible). Later commits on main change documentation and coordinator tests only; the published runtime is unchanged.

| 1.0 gate | Result on rc.28 | Evidence |
| --- | --- | --- |
| Native readiness on the Codex desktop connection | VERIFIED 2026-10-13 | [target evidence](docs/history/reviews/rc28-target-test-2026-10-13/STATUS.md) |
| Five hosted runs with readiness receipts (review, edit, review and edit to the turn limit, review) | VERIFIED: all five passed, no retries or repairs; the edit was checked independently | same |
| Provider authentication | VERIFIED by the hosted runs | same |
| Real active disconnect | INCONCLUSIVE: desktop case 6 finished before the disconnect; official-client case 7 not run | same |
| Node 20.19.0 floor (not a gate, recorded) | PASSED on the preparing machine on `7c7ba0e`, runtime identical to rc.28 | `docs/acceptance.json` |

Also recorded: a real-project review completed safely but its findings failed acceptance; usage and cost were not reported (UNKNOWN). Machine-readable gates are in `docs/acceptance.json`; the dated log is [docs/history/acceptance.md](docs/history/acceptance.md). Not required for 1.0 (owner decision 2026-10-12): the clean-account install (1.0.1), CI on exactly Node 20.19.0, and the live-allowlist and boot-key observations.

The target's coordinator tools, `scripts/v1-fixture-verify.mjs` (independent edit verification) and `scripts/v1-disconnect-observer.mjs` (read-only live observation of ownership and process groups), are covered by the normal vitest suite and are not shipped.

**Direction (2026-10-13).** Stability is one observation and two decisions away. Usefulness is the open question: every fixture run passed, and the one real-project review completed safely but its findings were not accepted. The runtime works; the task given to Vibe is what decides whether the answer is worth reading. Two facts from the [ecosystem notes](docs/history/ecosystem-2026-10-13.md) set the direction after 1.0: Vibe's source calls the legacy harness we pin a temporary escape hatch "kept until the legacy runtime is removed", so 1.0 is the last release on this engine and the next theme is a Unified Harness adapter with the same boundaries; and Vibe 2.26.1 already reports usage and cost per run in `export.json` through `--output-dir`, which the supervisor does not pass, so the UNKNOWN usage is one flag away. Neither is a reason to delay 1.0. Of the two large competitors, neither supports Vibe or isolates the agents it runs; the product's place is one contained, checkable delegation from Codex to a different model family, not a platform. The [strategy](docs/history/strategy-2026-10-13.md) says what to do with 1.0 once it exists: publish the checklist with the tool as evidence, take the harness question to Mistral, and keep a usefulness log.

## Decisions needed from the owner

1. **Disconnect gate.** On 2026-10-12 the gate was "one real active disconnect". `docs/acceptance.json` and the target evidence keep two observations, desktop and official client. Choose one. Recommendation: one observation, official-client case 7, which is already authorized and uses the disconnect observer; the desktop variant stays covered by the deterministic rehearsal and is recorded as not observed. A task long enough to be provably running (a review with `max_turns` 12 over several files) avoids a second inconclusive case.
2. **What 1.0.0 is.** Either release the exact tested rc.28 archive as 1.0 by policy (its version string stays 0.9.0-rc.28), or bump to 1.0.0, which makes new package bytes, and re-run a short confirmation on the new archive. Hosted results do not transfer to new bytes automatically. Branch `claude/v1.0.0` (on GitHub) prepares the bump with `[EVIDENCE: …]` placeholders and would need updating to the recorded results. Recommendation: bump, because `server_version` is the first field the skill tells a coordinator to read, and a 1.0 that reports 0.9.0-rc.28 contradicts the readiness check we ask everyone to trust. Keep the diff to `package.json`, `CHANGELOG.md`, `docs/acceptance.json`, README, compatibility and this file, and confirm the new archive with native readiness plus one review and one edit with cleanup, not the full five-run matrix.

## Next steps

1. Owner decides 1 and 2 above.
2. Target machine: the active-disconnect observation with the disconnect observer and a task long enough that the worker is provably running when the client goes away. Official-client case 7 is still authorized; a desktop retry needs separate approval. Stop at the first unexpected failure; never replay.
3. Then 1.0 as decided: fill the evidence on `claude/v1.0.0` (or tag the tested archive), `verify:release` and `package:rc` if new bytes are built, merge, `make push`, tag `v1.0.0` and publish with the owner's authorization. Finish the article from [draft-1.0.md](docs/history/article/draft-1.0.md) with the real numbers.
4. Useful operations, in parallel with 3 and without code changes: write a review task template into the skill from the fixture tasks that passed (exact files to read, the question to answer, the inputs to evaluate, "no defect found" as a valid answer, findings cited by file and location, no out-of-scope advice) and an edit template (files to read first, files it may create or change, no test execution, final inventory). Then run two or three authorized real-project reviews with it and keep a usefulness log in `docs/history/` that records the task, the turns used, whether the answer was accepted and why. Usefulness evidence is separate from the acceptance gates and does not block 1.0.

## After 1.0

In order. Each runtime change is a new candidate with one hosted observation per operation; documentation-only items need none.

**1.0.1, documentation and operations.** The clean macOS account install. The review and edit task templates and the usefulness log from step 4. Wording from the reviews and the [competitive landscape](docs/history/competitive-landscape-2026-10-13.md): receipt reuse, failed-run retention, a "what is not isolated" section in `docs/security.md`, stale-lock recovery as crash recovery and how an operator unlocks, "do not resend the same prompt" after a deterministic failure in `docs/errors.md`, and a named way to describe reviews of untrusted input. From the [ecosystem notes](docs/history/ecosystem-2026-10-13.md): reword the "handshake version" check for stateless MCP, and after a target check note Codex tool search (the five tools may load on demand; the readiness call is the proof they are callable) and `required = true`.

**1.1, Vibe's own export.** Pass `--output-dir` into the run directory and `--time-limit` from the deadline, read `export.json` for `usage`, `cost_usd`, `steps`, `warnings` and the outcome, redact it before persisting, and corroborate the stop reason from the outcome rather than from markers alone. Observe once per operation on the legacy path, which the Vibe README says still writes the export. This closes the UNKNOWN usage and gives the coordinator the cost of every run.

**1.1 or 1.2, the Unified Harness adapter.** Vibe's source calls the legacy harness a temporary escape hatch kept until the legacy runtime is removed. Before that removal, build an adapter for the Unified Harness with the same boundaries: private homes, filtered environment, `enable_subagents` and `enable_background_processes` off, managed shell tools off, read-only review profile, patch-only edits, and a fresh compatibility audit of project discovery, persistence, the permission predicate and the tool allow/deny environment. Pin exactly one version again. Until the adapter exists, the pin stays 2.26.1 and later Vibe releases are refused, which is correct.

**Runtime fixes ready or small.** Session pruning for `--isolated` and a run lookup that tolerates a bad sibling or more than 128 sessions: ready on branch `claude/session-pruning` (GitHub `bdc3ca4`, based on rc.28, needs a rebase), not merged because it changes runtime code after the tested build. The config fingerprint using `os.homedir()` instead of `HOME`; the `setup` restart message naming the registered path; the MCP SDK's 4-second SIGKILL after stdin closes, which can cut a slow edit shutdown short (recovered by design on the next start); owner-lock liveness from an OS-released lock instead of PID and elapsed time.

**Later.** The MCP tasks extension (`tasks/get` polling) once clients use it by default; it is the shape of our start, status and result tools. Byte-reproducible release archives across machines. Tooling waiting on the push token's `workflow` scope: `claude/release-workflow` (tag-triggered release) and `claude/ci-node-floor` (CI on exact Node 20.19.0 and 24).

## Working rules

- Never run a real Vibe on the preparing machine. Hosted evidence comes from the target machine only, with the owner's authorization and budget.
- Version numbers and runtime code change on main; the target machine records evidence and changes no code.
- Push with `make push` (main) or `make push-branch BRANCH=<name>`. Before a release candidate, `VIBE_SUPERVISOR_TEST_NPM_CACHE=<populated cache> npm run package:rc`.
- Keep credentials and private session histories out of every committed file.

## Fixed scope and safeguards

Exactly five one-shot MCP tools; no ACP, continuation, recovery replay, queue, automatic patch application, worker shell or network, or new platform scope. Reviews are read-only; edits use isolated detached worktrees. Retain canonical allowlists, private child homes, filtered environments, redaction, bounded deadlines and output, owner locks and verified cleanup. Missing evidence remains unknown; rc.28 is a prerelease, not certified stable 1.0.
