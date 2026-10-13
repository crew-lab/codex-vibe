# Current handoff

Updated 2026-10-13. This document alone defines current priorities. [docs/history/](docs/history/) keeps only what the current work uses: the rc.28 brief, runbook, evidence template and target evidence, the acceptance log, the latest reviews, the 2.26.1 compatibility audit, the install notes, the [competitive landscape](docs/history/competitive-landscape-2026-10-13.md), the [ecosystem notes](docs/history/ecosystem-2026-10-13.md) on Vibe, MCP and Codex, the [strategy](docs/history/strategy-2026-10-13.md) after rc.28 (owner's wins, community, propagation, case study), the [case 7 brief](docs/history/case7-disconnect-brief.md) and the 1.0 article draft. Everything older was removed from the tree on 2026-10-12 and is in Git history at `c510513`.

## Release identity and acceptance

**1.0.0 is published:** [GitHub release](https://github.com/crew-lab/codex-vibe/releases/tag/v1.0.0). PR #6 merged; both current-head CI checks passed; all six downloaded release assets and tag/source identity verified. Its exact tested archive SHA256 is `4e91e90bb7cb48c4411e1dc02820e91abddd690fc430f15a65ad6a9f3bd1c610`; frozen source snapshot `f0f317e10d5d021f171ed38f5a85bb8e2354f12d`. The archive is not rebuilt after confirmation. Main records later acceptance evidence separately; the package's generated acceptance report describes packaging-time state and the external release supplement records the later PASS.

Owner decisions 2026-10-13: one independently observed official-client disconnect satisfies the gate; release a genuine 1.0.0 version bump with unchanged runtime and native readiness plus one review and one edit confirmation. Case 7 PASSED (56c3920b-6758-4751-8b57-f58b2803942e), then closed with pristine-worktree removal. Desktop case 6 remains INCONCLUSIVE and is not presented as a pass.

1.0.0 native readiness and both hosted confirmations PASSED. Review f8f9c56f-0ffb-4b5f-b338-a125ba7f310e; edit 377bc531-70e9-4dd4-b10e-4de8c2a03253 passed nine independent checks and six worker tests without repairs. Both closed; the dirty edit worktree was safely retained. Two separately scoped real-project usefulness reviews also PASSED (11 parser/URL cases and five array-isolation cases); they do not erase the earlier failed broad review or establish general model accuracy.

Evidence: [release supplement](docs/history/reviews/v1-confirmation-2026-10-13/release-evidence.json), [target report](docs/history/reviews/v1-confirmation-2026-10-13/REPORT.md), and `docs/acceptance.json`. All four latest hosted allowances are consumed; no further run is authorized. Usage/cost remains UNKNOWN. Clean-account installation is deferred to 1.0.1.

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

## Current priorities

1. Completed: published the exact archive from the frozen source snapshot with SBOM, packaging-time acceptance report, checksums and dated release supplement. All six downloaded assets verified; tag identifies f0f317e. See the dated publication receipt. Never replace it with an untested rebuild.
2. Keep private rc.28 as rollback. The installed 1.0.0 package and its native connection are already verified; publication requires no extra hosted run.
3. Continue usefulness evaluation only with separately authorized scope/budget. Task templates are in the shipped skill; no automatic retries or silent Luna substitution.
4. After 1.0, follow the existing ordered roadmap below: operational documentation and clean-account install; Vibe export for measured usage; then Unified Harness compatibility. Each runtime change is a new candidate.

## After 1.0

In order. Each runtime change is a new candidate with one hosted observation per operation; documentation-only items need none.

**1.0.1, documentation and operations.** The clean macOS account install. Template changes from the usefulness log in step 4. Wording from the reviews and the [competitive landscape](docs/history/competitive-landscape-2026-10-13.md): receipt reuse, failed-run retention, a "what is not isolated" section in `docs/security.md`, stale-lock recovery as crash recovery and how an operator unlocks, "do not resend the same prompt" after a deterministic failure in `docs/errors.md`, and a named way to describe reviews of untrusted input. From the [ecosystem notes](docs/history/ecosystem-2026-10-13.md): reword the "handshake version" check for stateless MCP, and after a target check note Codex tool search (the five tools may load on demand; the readiness call is the proof they are callable) and `required = true`.

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

Exactly five one-shot MCP tools; no ACP, continuation, recovery replay, queue, automatic patch application, worker shell or network, or new platform scope. Reviews are read-only; edits use isolated detached worktrees. Retain canonical allowlists, private child homes, filtered environments, redaction, bounded deadlines and output, owner locks and verified cleanup. Missing evidence remains unknown; 1.0.0 acceptance is limited to the recorded macOS Apple-silicon and pinned Vibe contracts. No other platform or universal answer-quality guarantee is made.
