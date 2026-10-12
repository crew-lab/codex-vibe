# Current handoff

Updated 2026-10-12. This document alone defines current priorities. [docs/history/](docs/history/) keeps only what the current work uses: the rc.28 brief, runbook and evidence template, the acceptance log, the latest reviews, the 2.26.1 compatibility audit, the install notes and the 1.0 article draft. Everything older (earlier handoffs, plans, phase evidence, rc.2 to rc.17 test records) was removed from the tree on 2026-10-12 and is in Git history at `c510513`.

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

**Candidate: `0.9.0-rc.28`**, built on the preparing machine, not yet installed or run on the target machine. What changed since the last installed build (rc.23) is in [CHANGELOG.md](CHANGELOG.md): authoritative per-start policy reread and no-inference readiness with signed receipts (rc.24), accurate error codes and JSON error replies (rc.25), a reliable test suite and shutdown/settle fixes (rc.26), edits that fit large repositories and an export that cannot miss same-second edits (rc.27), and export and cleanup that see every change regardless of `core.ignoreStat`, assume-unchanged or skip-worktree (rc.28).

Verification on the preparing machine, fake backends only: `package:rc` passed (629 tests, 2 skipped; Python tests; lint, typecheck, build; acceptance; secret scan; SBOM; offline installed-package smoke test), and ten consecutive full suite runs on a clean clone passed. Exact Node 20.19.0 passed `verify:release` locally (on rc.24's source). Two cold reviews and a readiness assessment are in `docs/history/reviews/` (`rc24-…`, `rc27-…`, `v1-readiness-assessment-…`); their remaining items are listed under After 1.0 below.

Hosted evidence: Vibe 2.26.1 ran inference once, on rc.22 (run `cb51c05f`, `end_turn`). Nothing after rc.22 has run with inference; that is what the target-machine sitting closes.

Artifacts: `/Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/release/0.9.0-rc.28/` on the preparing machine (Git-ignored); check with `shasum -a 256 -c SHA256SUMS`:

```text
vibe-supervisor-0.9.0-rc.28.tgz  sha256 61ca4ee91067e2bbf8a7dbf2f14baf3f3667a661c8c587d4fd9b02323fe7e6cd
sbom.spdx.json                   sha256 13b6a16f2b6cc88f568452fb08a305911e7569605d0178ff986429c61e277ac0
acceptance.json                  sha256 1afa534349c75bd4ada07271ada71ec2fd8541f585cd482b878cefcb65510c5e
```

Upgrading from rc.23: a group- or world-writable config is refused (set it to 0600), and the Codex registration needs a reconnect to load the new code.

## 1.0 gates (owner decision 2026-10-12)

Required, all on the exact rc.28 artifact: native readiness on the Codex desktop connection; five hosted runs (review, edit, review to the turn limit, edit to the turn limit, review), each started with a readiness receipt; one real active disconnect; provider authentication (recorded by the first hosted run). Not required: the clean-account install (1.0.1), CI on exactly Node 20.19.0 (passed locally), and the live-allowlist and boot-key observations (covered by deterministic tests).

## Next steps

1. **Owner:** publish rc.28 as a tagged GitHub prerelease. Neither `gh` account on the preparing machine can create releases on `crew-lab/codex-vibe`; only the Keychain token behind `make push` can push. Tags currently stop at rc.22.
2. **Target machine**, following the [brief](docs/history/rc28-target-brief.md) and the [runbook](docs/history/rc28-target-runbook.md): install rc.28 next to rc.23 (authorized), reconnect Codex, run readiness, then the five hosted runs and the disconnect (separately authorized budget). Stop at the first failure; no retry, raised limits, account rotation or Luna substitution; change no code.
3. **Record** the evidence in `docs/history/reviews/rc28-target-test-<date>/` and `docs/history/acceptance.md`, and fill the `[EVIDENCE: …]` placeholders on branch `claude/v1.0.0` (on GitHub; version, changelog, README, compatibility and acceptance for 1.0.0, no code change). Push it with `make push-branch BRANCH=claude/v1.0.0`.
4. **Go or no-go (owner).** If the sitting passed with no code change: `verify:release` and `package:rc` on `claude/v1.0.0`, merge into main, `make push`, tag `v1.0.0` and publish the release. Any code change after the hosted runs means a new candidate and repeating them. Finish the launch article from [draft-1.0.md](docs/history/article/draft-1.0.md) with the real numbers.

## After 1.0

- Clean macOS account install (1.0.1).
- Pruning of `--isolated` session directories and a router that tolerates one bad sibling or more than 128 sessions: in preparation on local branch `claude/session-pruning`, not merged.
- From the reviews: receipt reuse wording; `runs cleanup` and failed-run retention wording; the config fingerprint using `os.homedir()` instead of `HOME`; the `setup` restart message naming the registered path; the MCP SDK's 4-second SIGKILL after stdin closes, which can cut a slow edit shutdown short (recovered by design on the next start).
- Tooling waiting on the push token's `workflow` scope: `claude/release-workflow` (tag-triggered release) and `claude/ci-node-floor` (CI on exact Node 20.19.0 and 24).

## Working rules

- Never run a real Vibe on the preparing machine. Hosted evidence comes from the target machine only, with the owner's authorization and budget.
- Version numbers and runtime code change on main; the target machine records evidence and changes no code.
- Push with `make push` (main) or `make push-branch BRANCH=<name>`. Before a release candidate, `VIBE_SUPERVISOR_TEST_NPM_CACHE=<populated cache> npm run package:rc`.
- Keep credentials and private session histories out of every committed file.

## Fixed scope and safeguards

Exactly five one-shot MCP tools; no ACP, continuation, recovery replay, queue, automatic patch application, worker shell or network, or new platform scope. Reviews are read-only; edits use isolated detached worktrees. Retain canonical allowlists, private child homes, filtered environments, redaction, bounded deadlines and output, owner locks and verified cleanup. Missing evidence remains unknown; rc.28 is not certified stable 1.0.
