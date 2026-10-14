# Current handoff

Updated 2026-10-14. This document alone defines current priorities. [docs/history/](docs/history/) keeps what the current work uses:

- **rc.2:** the [target brief](docs/history/rc2-target-brief.md), the [rc.2 cold review](docs/history/reviews/rc2-cold-review-2026-10-14.md), and the [rc.1 cold review](docs/history/reviews/rc1-cold-review-2026-10-14.md) with its [tool-path answer](docs/history/reviews/tool-inventory-answer-2026-10-14.md).
- **Usefulness:** the [usefulness log](docs/history/usefulness-log.md).
- **Direction:** the [Unified Harness audit](docs/history/unified-harness-audit-2026-10-14.md), the [outreach drafts](docs/history/outreach-drafts.md) for the owner to post, the [strategy](docs/history/strategy-2026-10-13.md), the [competitive landscape](docs/history/competitive-landscape-2026-10-13.md), the [ecosystem notes](docs/history/ecosystem-2026-10-13.md), and the [1.0 article draft](docs/history/article/draft-1.0.md), now filled from recorded evidence and waiting for the owner's read.
- **Earlier evidence:** the rc.28 and 1.0.0 records.

Target-machine evidence for 1.0.1 lives in [docs/reviews/](docs/reviews/), with machine paths and the site project's name replaced by placeholders ([REDACTION.md](docs/reviews/REDACTION.md)). Everything older than 2026-10-12 is in Git history at `c510513`.

## Release identity and acceptance

**Active candidate: `1.0.1-rc.2` (source, not yet built).** It acts on the [rc.1 cold review](docs/history/reviews/rc1-cold-review-2026-10-14.md) and the [tool-path answer](docs/history/reviews/tool-inventory-answer-2026-10-14.md): tools outside the profile are refused at invocation, three more Vibe sources are pinned, Vibe skills are disabled, an unsafe diagnostics file no longer fails a run, cancelled tool calls are recorded, and `docs/reviews/` is out of the package. `verify:release` passed on Node 24 and exactly 20.19.0 on the preparing machine. Its gates are open in `docs/acceptance.json`; the [rc.2 target brief](docs/history/rc2-target-brief.md) fills them and needs three separate authorizations (build and install, the no-inference profile check, two hosted runs). The rc.1 record below is history.

**Previous candidate: `1.0.1-rc.1`.** Its frozen archive SHA256 is `2442e35579d30dbc9b28bab4abaddfbb0a7c1e782055ba83cc4187ca24946b98`. Runtime differs from 1.0.0; the accepted evidence below is candidate-specific. Native readiness, effective tool use, accepted review/edit cases, bounded turn-limit behavior, exact Node-floor verification and an independently observed official-client disconnect are recorded in the [hosted report](docs/reviews/rc1-hosted-2026-10-14/REPORT.md). All seven authorized starts are used and closed, with zero retries. Original case 2 FAIL and case 6 raw helper FAIL remain preserved; separate review accepts the latter's runtime lifecycle observation. Costs remain UNKNOWN.

The reviewed runtime/source is consolidated with dated evidence. A clean integration rehearsal reproduced 118 runtime files byte-for-byte and reversed the complete 22-file source delta to its baseline. [Integration report](docs/reviews/rc1-integration-2026-10-14/REPORT.md). The frozen archive was not rebuilt; current source acceptance documents are a later supplement to its packaging-time snapshot.

**Stable 1.0.1 remains blocked on fresh-account acceptance and release requirements.** The owner requested a [prepared account-test packet](docs/reviews/rc1-integration-2026-10-14/FRESH-ACCOUNT.md) and will perform it later. Its same-account rehearsal is not the account gate. [Transfer receipt](docs/reviews/rc1-integration-2026-10-14/fresh-account-kit-receipt.json). Further hosted usage needs a new exact allowance; no automatic retry, account creation or credential copying is permitted. The cause of the older no-edit run remains UNKNOWN.

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

1. **rc.2 on the target**, per its [brief](docs/history/rc2-target-brief.md). It needs three separate owner authorizations:
   - build and install rc.2, and switch the registration;
   - the installed-Vibe profile check, which uses no provider and no inference. It confirms the three new pins, refusal at invocation, and that skills are disabled.
   - two hosted runs, one review and one edit.

   A profile-check failure is a launcher fix on the preparing machine and a new candidate. No hosted allowance remains.
2. **Fresh standard macOS account installation** of the same rc.2 archive. The owner runs it with the [prepared packet](docs/reviews/rc1-integration-2026-10-14/FRESH-ACCOUNT.md).
3. **Stable 1.0.1:** promote and tag only after every gate in `docs/acceptance.json` passes on the exact rc.2 archive, with the owner's publish authorization. A version or archive change needs its own confirmation. Do not replace or retag existing releases.
4. **Owner actions that unblock tooling:**
   - Add the `workflow` scope to the push token in the Keychain (`crew-lab-codex-vibe-github-token`), then push `claude/ci-checks` and watch its first run.
   - Delete the 17 merged or superseded remote branches with the prepared command. An agent's attempt was blocked as destructive. Keep `claude/session-pruning`; `codex/project-agents-isolation` and `codex/skill-cleanup-update` hold unmerged work and are the owner's or the target agent's call.
5. **Article:** the owner reads [the draft](docs/history/article/draft-1.0.md) and confirms or drops two claims that have no recorded source: the allowlist incident in item 2 and the fetch-before-fix rule in item 8. Publish after 1.0.1 with the AI-assisted label.

Done on 2026-10-14:
- the rc.1 cold review, and its tool-path question answered from the v2.26.1 tag source after verifying it against the pinned hashes;
- the 1.0.1 documentation items: what is not isolated, receipt reuse, owner-lock recovery, no-resend guidance, and connection identity without a handshake;
- the usefulness log, and the edit template's "Must reject or preserve" line;
- `docs/reviews/` excluded from the package;
- public evidence redacted;
- the rc.2 source, independently reviewed, with `verify:release` passing on Node 24 and exactly 20.19.0.

## After 1.0

In order. Each runtime change is a new candidate with one hosted observation per operation; documentation-only items need none.

**1.0.1 leftovers.**
- After a target check, note Codex tool search (the five tools may load on demand, and the readiness call proves they are callable) and `required = true` in the install notes.
- From the rc.2 review, for a later candidate: the pre-existing `lstat`-then-read window in `describeArtifact`, and whether a cancelled tool's cleanup can run after `cancelled` is recorded.

**2.0, the app-server engine (owner decisions 2026-10-14).** The supervisor's next engine is a client of Vibe's `vibe-app-server` JSON-RPC protocol, which Vibe's ADRs 0009 and 0016 make the boundary every surface uses. It replaces patching Vibe's Python internals.
- **Version policy:** an exact Vibe pin, with a new candidate and a short target check for every Vibe release.
- **Legacy path:** removed at 2.0.0. 1.0.x continues on a `release/1.0` branch, cut from the `v1.0.1` tag, with security fixes only until Mistral removes `--legacy-harness`.
- **Scope:** the five MCP tools and every boundary stay; an ADR records the scope change. The client owns the approval decision, denying by default, and rebuilds usage and cost from `session/statsUpdated` and `runtime/read`, because `vibe-app-server` writes no run export; this replaces the old 1.1 export item. Subagents, background processes, managed shell, skills, MCP, session logging and telemetry are set through `VIBE_*` process environment, not the session request; thinking is set through `config/model/write`.

Steps:
1. A protocol audit from source.
2. A design note and the ADR, with three owner choices the [Unified Harness audit](docs/history/unified-harness-audit-2026-10-14.md) forces:
   - the review profile, since there is no `grep` builtin;
   - whether a review may list write tools that are always refused, since `enabled_tools` gates execution and not the catalogue;
   - how reasoning is kept off disk.
3. Implementation on a branch, against a scripted fake app server only.
4. Target acceptance, then 2.0.0.

Nothing on main's shipped files changes before 1.0.1 is tagged. No Vibe is installed or run on the preparing machine.

**Runtime fixes ready or small.** Session pruning for `--isolated` and a run lookup that tolerates a bad sibling or more than 128 sessions: ready on branch `claude/session-pruning` (GitHub `bdc3ca4`, based on rc.28; needs a rebase onto the rc.2 runtime), not merged because it changes runtime code after the tested build. The config fingerprint using `os.homedir()` instead of `HOME`; the `setup` restart message naming the registered path; the MCP SDK's 4-second SIGKILL after stdin closes, which can cut a slow edit shutdown short (recovered by design on the next start); owner-lock liveness from an OS-released lock instead of PID and elapsed time.

**Later.** The MCP tasks extension (`tasks/get` polling) once clients use it by default; it is the shape of our start, status and result tools. Byte-reproducible release archives across machines. Tooling waiting on the push token's `workflow` scope:
- `claude/ci-checks`, committed locally as `8904c13` and replacing `claude/ci-node-floor`. It adds:
  - a fast Linux job: lint, types, the generated error reference, whitespace outside evidence, and the secret scan;
  - workflow lint;
  - `verify:release` on macOS with Node 20.19.0 and 24;
  - dependency review on pull requests;
  - read-only permissions, actions pinned by commit, and Dependabot to keep them current.
- `claude/release-workflow`: a tag-triggered release.

## Working rules

- Never install, run or test Vibe on the preparing machine, including the installed-Vibe fixture. Questions about Vibe's code are answered from its tagged source, after checking it against the launcher's pinned hashes. Hosted and installed-Vibe evidence comes from the target machine only, with the owner's authorization and budget.
- Evidence uses the placeholders in [REDACTION.md](docs/reviews/REDACTION.md) from the start; the repository is public.
- Version numbers and runtime code change on main; the target machine records evidence and changes no code.
- Push with `make push` (main) or `make push-branch BRANCH=<name>`. Before a release candidate, `VIBE_SUPERVISOR_TEST_NPM_CACHE=<populated cache> npm run package:rc`.
- Keep credentials and private session histories out of every committed file.

## Fixed scope and safeguards

Exactly five one-shot MCP tools; no ACP, continuation, recovery replay, queue, automatic patch application, worker shell or network, or new platform scope. Reviews are read-only; edits use isolated detached worktrees. Retain canonical allowlists, private child homes, filtered environments, redaction, bounded deadlines and output, owner locks and verified cleanup. Missing evidence remains unknown; 1.0.0 acceptance is limited to the recorded macOS Apple-silicon and pinned Vibe contracts. No other platform or universal answer-quality guarantee is made.
