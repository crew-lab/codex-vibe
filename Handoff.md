# Current handoff

Updated 2026-10-16. Status only: what the source, the archives and the installations are, what remains and who does it, what is open, and where the records are. The picture and the rules are in the [development strategy](docs/development-strategy.md); the sequenced work is in the [development plan](planning/development-plan.md); the boundaries are in [AGENTS.md](AGENTS.md).

## Package/kit identity repair — 2026-10-15

The target packet built from `8b288b8` passed release verification (88 files, 1,292 tests) and the offline smoke, but independent archive inspection rejected its preparation kit before installation or conformance. npm 10.8.2 ran `prepare` while packing, rebuilding `dist` without its SBOM; packaging then regenerated the external SBOM before hashing the candidate. The kit therefore identified different bytes. The failed packet and its original identities remain preserved separately; no existing receipt was changed.

The repair branch `codex/package-kit-identity` retains unpublished version 2.0.1. Packaging now captures identity immediately after packing and verifies the actual archive through an offline, lifecycle-disabled private installation before announcing success. It compares candidate identity, version, conformance script and kit checksums, includes kit files in delivery checksums, and removes the verification installation afterward. External SBOM generation and the identity algorithm remain intact. Frozen source `44dc6f8` passed full `package:rc` under Node 20.19.0/npm 10.8.2 (89 files, 1,296 tests), installed smoke and mandatory final archive verification. A separate main-chat offline installation also passed. Corrected archive SHA-256 `7978719c0010c8bad27ff9982ee930b392040b5f5339cb1493467d5dae2bae4e`; actual candidate/kit identity `8b1b7dd556ea985e27f9886b31d2fea7952861c831f2b24e22f273a64dba93a4`. The candidate runtime digest is unchanged; its previously incorrect kit binding is repaired.

Side-by-side installation, reviewed 783-file Vibe pin and doctor passed. Exactly one matched no-inference preparation check passed with verified cleanup, no subject network requests and a validated refusing observer; experiments-specific attribution stays unverified. All prior roots/settings are preserved, with only the named Supervisor repository added. After PASS, registration dry run was reviewed, private backups retained and only Supervisor registration/skill-link entries switched to persistent Node 20.19.0 and this candidate. SDK readiness and five-tool catalog pass. Native readiness was pending desktop reconnect at packaging time and was subsequently verified on 2026-10-16 (see the dated addendum below); SDK success alone was not treated as native proof. No hosted run, merge, push or publication occurred. [Repair evidence](research/evidence/package-kit-identity-2026-10-15/REPORT.md) records exact identities and remaining gates. The source freeze above identifies the packaged source; the later evidence commit does not rebuild or relabel the archive.

### Native reconnect verified — 2026-10-16

The native desktop connection now reports Supervisor 2.0.1 and the expected candidate `8b1b7dd556ea985e27f9886b31d2fea7952861c831f2b24e22f273a64dba93a4`. Preparation PASS, workspace/dispatch eligible, free slot, no blockers, no restart required and the exact five-tool connected catalog were verified without starting a run. This supersedes the earlier pending-native status below and in the frozen evidence; those historical records remain intact. [Native readiness addendum](research/evidence/package-kit-identity-2026-10-15/NATIVE-READINESS-2026-10-16.md). Zero hosted starts; hosted and clean-account gates remain open.

### Hosted acceptance stopped — 2026-10-16

One of three authorized hosted starts was used. The review completed/end_turn with read-only integrity, two executed reads and cleanup verified, but the actual final answer reversed both required negative-number cases. Independent fixture execution confirmed the error. Coordinator rejected the review; edit and disconnect were not started, and no retry/fallback occurred. Nested permission probe was NOT EXERCISED (a reported missing function is not a denied-write event). Reasoning lexical counts grew but cannot establish generated reasoning. The post-close report exports execution as unknown despite native completed; that reporting finding is preserved separately. Hosted gates remain unverified. [Hosted evidence and stop report](research/evidence/hosted-2.0.1-2026-10-16/REPORT.md). Runtime-reported usage: 14,442 tokens, three model calls, USD 0.022023 estimated; underlying model and turn count unavailable. The native slot is free; no worker process or private runtime directory remains.

### Second hosted start reported — 2026-10-16

A later target-machine record (branch `explore_project_details`, commit `7f1ca6d`, not merged; see below) reports that the second authorized start was used afterwards, on source `2a49abd`: hosted edit run `6074df5d-6d51-4a44-ab1c-78fdadea76f2` completed `end_turn` in its detached worktree without a backend error and was rejected by its frozen acceptance contract, because the worker imported `strict as assert` from `node:assert` instead of `node:assert/strict` and omitted `node:test`. It also reports the post-close export fix observed in use (`state: closed` separate from `execution_state: completed`, start time and duration kept) and a structured reasoning observation (`streamed_entries=0`, `history_entries=0`, `history_audited=true`). One authorized start, the disconnect, remains unused. No evidence packet for this run is on main, so `hosted-review-edit-confirmation` stays open; both rejections are worker answer-quality failures, with supervisor isolation, permissions, events and cleanup observed working.

That branch also added an Antigravity worker backend on top of the earlier engine and recorded private machine paths; it was not merged, because a worker other than Vibe is excluded (ADR 0004 and the strategy's "Antigravity as a worker: no"), and it was deleted from GitHub on 2026-10-16.

### Owner decision — 2026-10-16: the target may fix code

The earlier rule that the target records evidence and changes no code is replaced. The target may fix code it finds broken, on a branch from main that it pushes for review; it never pushes to main or publishes, a code fix makes a new candidate whose earlier evidence does not transfer, and the coordinator reviews the branch (private-path scan, `npm run verify:release`) and merges it. This matches what happened: the target authored `44dc6f8` (the package and kit identity binding) and `2a49abd` (execution provenance and reasoning counts), which were reviewed and merged. The rule is in [AGENTS.md](AGENTS.md#code-changes-on-the-target-machine), the strategy's working rules and the [target acceptance procedure](docs/target-acceptance.md).

### Owner decision — 2026-10-16: spend the last start on the disconnect

The owner authorized the one remaining hosted start for the MCP-client disconnect only (authorization 5, gate `mcp-client-disconnect-hosted`), following the [disconnect procedure](docs/target-acceptance.md#disconnect-procedure) on the installed 2.0.1 candidate with the native readiness already verified. It is not a retry of the review or the edit, and no further hosted start is authorized. Stop at the first failure; record the client and observer outputs with the placeholders from AGENTS.md on an evidence branch and push it for review. The review and edit rejections stay recorded as worker answer-quality failures; `hosted-review-edit-confirmation` stays open.

Prompt for the target agent:

```text
Fetch main (at b275b1b or later) and read Handoff.md, section "Owner decision — 2026-10-16: spend the last start on the disconnect". Using the installed 2.0.1 candidate, re-verify native readiness, then run the one authorized hosted start as the MCP-client disconnect only, following docs/target-acceptance.md#disconnect-procedure with scripts/disconnect-client.mjs and scripts/disconnect-observer.mjs. Stop at the first failure; no retry, no other hosted start. Record the client and observer outputs with the AGENTS.md placeholders on a new evidence branch from main, check the pass criteria in the procedure (observed_running true, settled_before_disconnect false, server_exited true, state_after_reconnect "failed" with the no-replay diagnostic), update the gate mcp-client-disconnect-hosted in docs/acceptance.json, and push the branch with make push-branch for review. Do not merge to main or publish.
```

After the branch arrives, the coordinator scans it for private paths, runs `npm run verify:release`, and merges it into main.

### Local reporting and probe repair — 2026-10-16

The closed-review export defect is repaired in source: execution outcome is persisted independently of close state, and the first observed running callback records a start time that later callbacks/close preserve. Closed records written without an outcome remain unknown; inference-only durations are not fabricated. A terminal count-only `reasoning_observation` diagnostic replaces the lexical watcher, retaining structured streamed/history counts and audit coverage while leaving content/credential filtering intact. Zero counts establish none observed, not absence of provider generation. The nested probe is source-checked against pinned Vibe: `tools.file_system.write_file({path, content})`; the reported `writeFile` error did not test that path. [Prepared continuation and labeled review task](docs/hosted-continuation.md) preserves the original unused edit/disconnect allocations; a review retry needs an explicit budget decision. Local `verify:release` passed under Node 20.19.0/npm 10.8.2: lint, typecheck, build, 89 files/1,305 tests, acceptance, secret scan and SBOM. Lifecycle/privacy/projection regressions and local document links also passed. The repair is `2a49abd`, now on main, separate from the selected frozen candidate. These source changes are not installed or packaged; the selected 44dc6f8 candidate, frozen evidence and existing preparation receipt remain unchanged. No hosted start, conformance rerun, installation/switch or publication is included in this local repair.

### Repository actualized — 2026-10-16

Main's documents now agree with this evidence: `docs/acceptance.json` records the corrected archive (`7978719c…`, candidate `8b1b7dd5…`) as `frozen_archive_sha256` and `packaging_time_snapshot`, moves the package/kit identity, no-inference conformance, installed and native readiness and Node 20.19.0 floor gates to `VERIFIED` for that archive, and keeps the hosted review/edit (rejected), disconnect (pending, authorized), `permission = "ask"` (both halves observed, per-tool report not in the repository), thinking-off, experiments and nested-gating (NOT EXERCISED) gates open; `hosted_allowance_remaining` is 1, for the disconnect only. The SBOM, packaging-report and kit-file hashes of that delivery are not in the evidence on main. The run schema now lists `execution_state`. Checks: 89 files, 1,305 tests.

## Release identity

- **Source.** `vibe-supervisor` 2.0.1, unpublished. The workflow integration reached main at `6c645e3`; the target's packaging repair (`44dc6f8`) and reporting repair (`2a49abd`) are on main as well. Version remains 2.0.1 in both package manifests; Vibe remains pinned to 2.26.1. The source, distributed archive, installed candidate and connected desktop server are distinct identities and need their own evidence. Main's runtime now differs from the frozen archive, so a build of main is a new candidate.
- **Frozen archive.** Source `44dc6f8`, archive SHA-256 `7978719c0010c8bad27ff9982ee930b392040b5f5339cb1493467d5dae2bae4e`, candidate and kit identity `8b1b7dd556ea985e27f9886b31d2fea7952861c831f2b24e22f273a64dba93a4`, packaged on the target under Node 20.19.0/npm 10.8.2. It is the installed, selected candidate and the one every 2.0.1 target gate names.
- **Release status.** The owner deleted the unpublished v2.0.0 draft on 2026-10-15. The earlier published major remains untouched. 2.0.1 is not published.
- **The workflow candidate's evidence.** Source `91afad4`, frozen archive SHA-256 `d1fd22ec04e50048c052cdf013b4d235b525dffc2efb11596dd29f8253003f6a`, installed distribution identity `a3600f7632ea42a221d342734dd1b6cb17deaaf072211693a728e31c0437b053`, on macOS arm64 with Node 24.21.0 and the installed Vibe 2.26.1, 2026-10-15: release verification passed (1,260 tests in 87 files), the offline installed-package smoke passed, the no-inference conformance check passed once with a fixed fake key and no inference, installed readiness through the official SDK passed and rejected a wrong expected candidate, and the validation helper passed a real npm offline fixture. Zero hosted starts. The sanitized records are the evidence packet at commit `2e920d3`; `docs/acceptance.json` summarizes them under `evidence_builds` and the `workflow-candidate-*` entries. The packet's own README says it does not certify an integrated package, and it does not: every gate of this build is open until rerun.
- **Installations.** The corrected 2.0.1 archive is installed side-by-side and selected in desktop registration with the persistent Node 20.19.0 runtime; the previous install and private rollback backups remain. Its one no-inference preparation check and independent SDK readiness passed. The reconnected native desktop connection was verified on 2026-10-16: expected candidate, preparation PASS, eligible workspace, free slot and exact five-tool catalog. Earlier hosted website work proves nothing about this candidate.
- **Owner decisions on record:** only the latest release is supported; the push token's `workflow` scope is skipped, so verification is local; Antigravity is a client candidate only, never a worker; the bounded workspace file listing in the prompt is in; ADR 0005's managed-configuration isolation and ADR 0006's bundled skills ("Let vibe have own skills"); a Vibe implementation request already authorizes its task-scoped preparation (installing or switching the candidate, the no-inference check, adding only the named task root, settings and rollback kept), while extra hosted starts, broader roots, publication, deployment and unrelated global changes need their own yes; the main chat coordinates and verifies, Vibe implements, and GPT-6 Luna/high is the fallback only after a verified rejection of the exported bytes.

**Settled decisions** (delegated to Claude by the owner; each keeps what is built and tested):
- Error codes: `invalid_api_key` → `VSUP_AUTH_REQUIRED`; `invalid_model` → `VSUP_BACKEND_ERROR` classified as configuration; `context_too_long`, `response_too_long` and a `length` stop → `VSUP_OUTPUT_LIMIT`; `rate_limit` → `VSUP_RATE_LIMITED`.
- Pin reach: the installed Vibe package's `RECORD` files only, against the manifest generated on the target; dependencies, `.pth`, the interpreter and `__pycache__` are documented as not covered. A shipped manifest derived from the published wheel is planned for 2.1.
- Off-profile calls: a call Vibe or the handler denies is recorded and the run continues; a call that runs without the handler's approval ends the run.
- Refusal: `completed`, with a refusal warning.
- Design choices: the Node reaper, the Keychain lookup in Node and the per-candidate manifest stay.
- Readiness checks that `vibe-app-server` exists, not the full pin; the full pin runs at each run start and in `doctor`. Readiness also requires the matching preparation pass.
- Budgets: `limits.max_tokens` and `limits.max_cost_usd` stay optional and unset by default.

## Remaining

| # | Step | Who | Needs |
|---|---|---|---|
| 1 | Done: the integration is on main (`6c645e3`), followed by the plan update (`29545fd`) and the pre-packaging cleanup (`3de455e`: code comments removed, a shipped example neutralized, the unverified plugin scaffold deleted) | — | — |
| 2 | Done 2026-10-15: the owner deleted the unpublished v2.0.0 draft; 2.0.1 is the first 2.x release. The 2.0.0 commit `f2c2119` stays in main's history | — | — |
| 3 | Done 2026-10-15: 2.0.1 packaged from `9d2bbde` (after the pnpm lockfile fix) under Node 20.19.0 with a dedicated offline cache; `package:rc` passed (88 files, 1,292 tests; offline smoke). Assets in `release/2.0.1/` on the preparing machine with `SHA256SUMS`: `vibe-supervisor-2.0.1.tgz` `73c28081bfad86d1cd2b2ec16d7ba22c28a4e82b4e5f903e5c9341ff4acf4010`, `preparation-kit-2.0.1.tar.gz` `4c0fdc17d4a6e483431642fd94d28e97959a2c913e8f3549685026a9d25206ae`, `sbom.spdx.json`, `acceptance.json`. It supersedes the earlier `3de455e` package | — | — |
| 4 | Done 2026-10-15: `validation prepare` passed with a populated pnpm store on a public fixture (nvm Node 20.19.0, pnpm 9.15.4); it first exposed and then confirmed the fix for a lockfile check that blocked every pnpm 9 project (gate `validation-populated-pnpm-dependencies`, PASSED_LOCALLY) | — | — |
| 5 | Done 2026-10-15/16 on the target: packaged from git (the `8b288b8` packet rejected for the kit-identity defect; the corrected `44dc6f8` archive `7978719c…` passed `package:rc` on Node 20.19.0), installed side by side, pin and `doctor`, one `prepare check` PASS, SDK and native readiness PASS. Hosted: the review rejected on answer quality (one start); the edit reported rejected on its contract on an unmerged branch (a second start). Recorded in `docs/acceptance.json` | — | — |
| 6 | The MCP-client disconnect with the last authorized start, on the installed candidate, per the prompt above; evidence branch pushed for review | Target agent | Authorization 5, given 2026-10-16 |
| 7 | Review and merge the disconnect evidence branch: scan for private paths, `npm run verify:release`, merge; move `mcp-client-disconnect-hosted` and its compatibility row | Coordinator | Step 6 |
| 8 | Clean-account installation of the frozen archive `7978719c…` (gate `clean-account-install`) | Owner | — |
| 9 | Decide: another bounded hosted allowance for the rejected review/edit gate, or publish with that gate open and worker answer quality stated as a limit; and which bytes to publish, the tested frozen archive without `2a49abd`'s reporting fixes, or a new frozen build of main with its own preparation, readiness and hosted evidence | Owner | Steps 7 and 8 |
| 10 | Publish v2.0.1 from the tested assets (archive, kit, SBOM, packaging report, `SHA256SUMS`) with release notes adapted from [planning/release-notes-2.0.0.md](planning/release-notes-2.0.0.md), tagged at the commit the target packaged; a pre-release label if any gate is still open | Owner | Step 9 |
| 11 | Done: GitHub holds `main` only; the merged branches and local worktrees are removed | — | — |
| 12 | Decide the repository rename (`codex-vibe` → `vibe-supervisor`) and read the Mistral and OpenAI brand pages | Owner | Before the article goes out |
| 13 | Read the 2.0 article draft (`marketing/article/devto-2.0.md`) with its [editor notes](marketing/article/editor-notes.md) and [story sources](marketing/sources.md); update it for the workflow features and publish after the release with the AI-Assisted label and the `[UPDATE AT PUBLISH]` markers filled, in the marketing strategy's [order](marketing/strategy.md#6-next-actions-in-order) | Owner reads and publishes; agent fills the markers from the evidence | Step 10 |
| 14 | 2.1 per the [plan](planning/development-plan.md): what the workflow line did not already deliver, Antigravity as a verified MCP client included | Agents; owner decides the Antigravity scope reading and the wheel download | Step 10 |

**The skipped `workflow` scope.** Until it is added, no workflow file can be pushed, so the repository has no CI. To unblock: at https://github.com/settings/tokens give the push token the `workflow` scope (fine-grained: "Workflows: Read and write" on `crew-lab/codex-vibe`), update the Keychain entry `crew-lab-codex-vibe-github-token` if the value changed, then push the local CI branch rebased onto the current line and watch its first run.

## Testing on another machine

Main is one thread: every former branch, the deleted v2.0.0 draft's commit `f2c2119`, the 2.0.1 cleanup and the workflow line are in its history, and GitHub holds `main` only. On another Mac (Apple silicon, Node 20.19 or later, Git):

```bash
git clone https://github.com/crew-lab/codex-vibe.git vibe-supervisor && cd vibe-supervisor && npm ci && npm run verify:release
```

`verify:release` needs no Vibe and no network beyond `npm ci`. To package offline, fill a dedicated npm cache with the locked versions first, then package; `package:rc` also writes `release/preparation-kit-<version>/`, which belongs to that archive:

```bash
CACHE="$PWD/.npm-offline-cache" && node -e 'const l=require("./package-lock.json");const s=new Set();for(const[k,v]of Object.entries(l.packages)){if(!k||v.link||!v.version)continue;s.add((v.name||k.slice(k.lastIndexOf("node_modules/")+13))+"@"+v.version)}console.log([...s].join("\n"))' | xargs -P 8 -n 1 npm cache add --cache "$CACHE" && VIBE_SUPERVISOR_TEST_NPM_CACHE="$CACHE" npm run package:rc
```

Hosted behaviour needs Vibe 2.26.1 and follows [docs/target-acceptance.md](docs/target-acceptance.md): after `pin-manifest`, run `vibe-supervisor prepare check --kit <absolute path of the kit> --config "$CONFIG"` once, because readiness and every start need its pass. The v2.0.0 draft archive (`f2c2119`, SHA-256 `485ecce3…`) is not a useful target build: it lacks the repairs above.

Deleting the remote branches that main already contains (owner; it skips any branch that is not an ancestor of main):

```bash
git fetch --prune origin && for b in $(git for-each-ref --format='%(refname:strip=3)' refs/remotes/origin | grep -v -x -e HEAD -e main); do git merge-base --is-ancestor "origin/$b" origin/main && git push origin --delete "$b"; done
```

## Open questions

**Only the target can answer** (each fails closed; the consequences are in the [strategy](docs/development-strategy.md#verification-model), and the [procedure](docs/target-acceptance.md) records which way each goes): whether a callback's `relatedEntryId` is filled at the entry or only in `detail`; whether handler-approved effects carry `approvalType` `ask` and `approvalSource` `user`; whether `agentConfig.maxTurns` is enforced; how long Vibe keeps a callback open; whether a large legitimate `write_file` fits the 8 MiB line cap; whether thinking off stops reasoning generation; whether `experiments.enable = false` stops the experiments request (a host-only proxy observation cannot say); which history entry kinds and notification methods a hosted run produces (the one hosted review on main produced `runtime/updated` and `session/updated` as ignored methods, no unknown entry kind, handoff or turn retry; its two approved reads did not fail on `relatedEntryId` or the approval metadata). The workflow candidate's no-inference check already showed that the real server leaves nothing in `tmp` after stdin EOF and sends `runtime/updated` at startup; rerun on this build before relying on either.

**For the owner:** whether a second verified MCP client (Antigravity) is documentation plus evidence or the platform scope AGENTS.md forbids (the strategy recommends the former; 2.1 does not start without it); the repository rename; whether to post the Mistral Discussion with the protocol questions (catalogue narrowing, a search builtin, omitting reasoning, honouring budgets, a protocol version, the stable callback name), whose answers would remove work; the vendor-wheel download for the shipped manifest; the next hosted allowance.

**Known limits of this state:** Linux and Windows code paths exist without a support claim; `docs/development-strategy.md` ships inside `docs/` while pointing at unshipped files (`Handoff.md`, `planning/`, `marketing/`, `research/`), which should be settled by excluding it from `files` or moving it; the validation helper blocks project manager configuration, local dependencies and required build scripts until a reviewed profile exists.

## Evidence rules

Vibe is never installed, run or tested on the preparing machine; questions about Vibe are answered from its tagged source, checked against the hashes in [compatibility](docs/compatibility.md#source-basis). Behavior is proven only on the target machine, with the owner's authorization and budget for each step, and the target records evidence. The target may fix code it finds broken, on a branch from main that it pushes for review; it never pushes to main or publishes, a code fix makes a new candidate whose earlier evidence does not transfer, and the coordinator reviews the branch (private-path scan, `npm run verify:release`) and merges it. Evidence names the exact source, archive and installed distribution it belongs to, and never transfers to other bytes. Evidence uses the placeholders in [AGENTS.md](AGENTS.md#recording-target-evidence) from the start, because the repository is public. Missing evidence stays "unverified".

## Pointers

Shipped: [functionality](docs/functionality.md), [reference](docs/reference.md), [security](docs/security.md), [compatibility](docs/compatibility.md) (source basis, gates and diagnostic reasons), [target acceptance](docs/target-acceptance.md), [workflow acceptance](docs/workflow-acceptance.md), [preparation](docs/preparation.md), [validation workspaces](docs/validation-workspace.md), [errors](docs/errors.md) (generated), `docs/acceptance.json` (machine-readable gates), [ADR 0004](docs/adr/0004-app-server-client.md), [ADR 0005](docs/adr/0005-target-conformance-repairs.md), [ADR 0006](docs/adr/0006-bundled-vibe-skills.md), the coordinator skill `skills/vibe-supervisor`.

Source repository only, not shipped: the [development plan](planning/development-plan.md) and its [2.1 design sketches](planning/2.1-designs.md), [marketing/strategy.md](marketing/strategy.md), [marketing/interest.md](marketing/interest.md), [marketing/sources.md](marketing/sources.md), [marketing/article/](marketing/article/editor-notes.md), [research/features-2026-10-14.md](research/features-2026-10-14.md), [research/antigravity-2026-10-14.md](research/antigravity-2026-10-14.md). The workflow candidate's evidence packet is at commit `2e920d3`.

| Area | Code |
|---|---|
| MCP server and tool schemas | `src/mcp/` |
| Run lifecycle, one active slot, deadline, watchdog, retention, owner lock, policy reread and readiness receipts, saved-run routing after `--isolated` reconnect | `src/core/`, `src/config/policy.ts` |
| App-server client: backend, JSON-RPC transport, protocol subset, session configuration and read-back, managed-config endpoint, bundled skills, approval handler, event validator, usage and outcome mapping, pin check, credentials, workspace listing; the reaper | `src/backends/app-server.ts`, `src/backends/app-server/`, `src/process/reaper.ts` |
| Acceptance contracts, assessments and verification | `src/acceptance/` |
| Reports, private-file reads, model observations | `src/reporting/` |
| Preparation evidence and the dispatch gate | `src/preparation/`, `src/cli/prepare.ts` |
| Validation copies | `src/validation/`, `src/cli/validation.ts` |
| Worktrees, private-index export, verified cleanup | `src/git/worktree.ts` |
| Paths, child environment, redaction | `src/security/` |
| Configuration and `--isolated` session homes | `src/config/` |
| CLI: `setup`, `allow`, `doctor`, `pin-manifest`, `serve`, `prepare`, `validation`, `runs` | `src/cli.ts`, `src/cli/`, `src/diagnostics/doctor.ts` |
| Release, conformance and coordinator scripts (only the conformance script ships, for the kit) | `scripts/` |

## Fixed scope and safeguards

Exactly five one-shot MCP tools; one owned active slot; canonical allowlists; no ACP, continuation, recovery replay, queue, automatic patch application, worker shell or network, extra hosted starts or new platform scope. Reviews are read-only; edits use isolated detached worktrees. Bundled skills stay inside the same tool and path policy. The enforcement points and the pin are listed in the [strategy](docs/development-strategy.md#architecture-and-enforcement-points) and fixed by [AGENTS.md](AGENTS.md). Private runtime state stays private and evidence is sanitized; uncertain cleanup retains files. These are application-policy controls, not an OS sandbox. Missing evidence remains unknown: the frozen archive has its target evidence up to the hosted runs, and no other platform or universal answer-quality guarantee is made.
