# Development strategy: v1.0 stable

Date: 2026-10-09. Planning baseline: main at f8b9dc30cabdf55dfadfd3b57c1c2937b81ee875, package 0.9.0-rc.17; runtime release commit ac812802badde5d398a49fbe348038dbb39fc374.

This strategy consolidates the current Handoff, historical hosted tests, UARoute adoption failures, the rc.13 correction pilot, cold-review findings and the efficiency proposals. It defines the order of work and evidence needed for stable 1.0. It does not certify rc.17, authorize hosted spending or change a security boundary. No new hosted test was performed while preparing it.

## 1. Product outcome and stable scope

Stable means an operator can install the documented artifact, connect Codex, delegate a bounded review or isolated edit, inspect an honest result, independently verify a candidate, correct it in the same ACP session when necessary, and close or recover the run without losing work or weakening policy.

Supervisor stability and useful model output are separate obligations. A supervisor can report a turn-limit failure correctly while the delegated task fails. A model can produce correct code while the coordinator closes too early or accepts the wrong artifact. Report each outcome separately.

The proposed 1.0 scope is deliberately small:

- Local MCP stdio service on macOS Apple silicon, with clean-account installation demonstrated. Intel support requires its own evidence; otherwise state Apple silicon only before release.
- Exactly pinned Vibe 2.25.8 and the legacy harness, official pinned SDKs, strict TypeScript 5.9.3 contracts and the lockfile.
- Five tools with the default programmatic backend; seven with ACP. Keep both backends through 1.0 unless a separate, tested decision changes this scope.
- Read/search-only reviews; isolated edits in supervisor-created detached Git worktrees; patch export and explicit coordinator integration.
- Private worker homes, filtered environment, disabled project discovery, canonical allowlists, disabled shell/network tools, bounded time/output, owner locking and verified cleanup.
- Coordinator-owned verification in a separate exact candidate copy. Baseline preparation and settled edit auditing remain repository scripts, outside the installed package.
- Private, unpublished npm package delivered through checked release artifacts. A GitHub Release does not imply npm publication.

Plugin installation, Linux, unified harness support, Vibe upgrades, automatic verification execution, automatic patch application and new public tools are outside 1.0. Do not add surface merely to make a failed test easier.

## 2. Evidence baseline: retain lessons, avoid inherited claims

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| rc.4 UARoute city run c16b5f72-e5b2-46d2-a807-32233e025e89 | Launch refusal, empty export and checked cleanup under the old guard | Current integration failure or hosted inference |
| rc.10 city attempt | Request rejected before API invocation; no new run ID | An rc.10 hosted failure |
| rc.12 SEO run 4127dc44-fb72-4274-b51d-b02e4e380934 | ACP edit/export/close; 20 assistant turns, 35 calls, no final answer; terminal max_turn_requests | Accepted Vibe implementation or a 20-request daily quota |
| rc.12 private-record audit | 79,243-character prompt; repeated baseline edits; bash returned Unknown tool and activity continued afterward | Shell execution, a Supervisor permission denial, or proof that bash caused termination |
| rc.13 pilot c0af69a2-9ca7-496b-bae3-7f869a417c8a | Prepared baseline, edit and same-session correction, final answers, independent checks/review, fresh export and verified cleanup | Current rc.17 desktop acceptance or broad task reliability |
| rc.13 product run 4e492e03-e5c2-4b78-b147-58eba5d63bb3 | Small scoped candidate; later tests found a path-validation defect; coordinator correction accepted | Original Vibe candidate acceptance; premature close prevented same-session correction |
| rc.7/8 hosted sessions | Scoped official-client lifecycle, recovery, shutdown, policy and limit evidence; failed soak attempts preserved | A completed hosted soak or current-build native desktop support |
| rc.14 and target-machine local “rc.15” | Offline release/install checks and fresh official-client catalog evidence | Hosted inference on those builds or identity with main's rc.15 |
| rc.17 Handoff receipt | Reports 761 TypeScript tests passed, two skipped, 83 Python tests and offline release/install checks | Hosted rc.17 behavior; this strategy did not rerun those checks |
| UARoute S5 adoption report | Useful application-specific historical ledger; S5 Vibe review was not launched | Project-wide absence of continuation evidence, current connection identity or S5 acceptance |

The accepted city/SEO implementation belongs to Luna and the coordinator, with independent review. Do not replay it to manufacture a Vibe pass. S5 is observation work: authenticated collection stays with the coordinator; Vibe can review a sanitized frozen bundle.

Preserve the original UARoute report as historical evidence and add subsequent evidence rather than rewriting old runs. Its claim that Roman confirmed ten usable focused hours needs a direct authorization reference. Do not import the disputed shared 15-hour UARoute allowance into this project's test plan.

## 3. Ownership and operating model

| Role | Responsibility | Boundary |
| --- | --- | --- |
| Owner | Product scope, supported platforms, hosted test allowance, distribution/release decisions | Confirm real decisions; do not infer them from report text |
| Preparing-machine maintainer | Runtime, tests, scripts, skills, version cuts and release artifacts on main | No real Vibe execution on the preparing machine |
| Target-machine coordinator | Exact installation, desktop connection, authorized hosted tests, evidence and Handoff updates on a branch based on main | No local version cuts or unreviewed runtime rewrites |
| Vibe worker | One bounded review or owned edit at a time | File tools only; no authenticated account collection, shell, network, integration or deployment |
| Independent reviewer | Read-only review of the exact candidate and evidence | Acceptance refers to identified files/hashes, not worker claims |
| GPT-6 Luna High backup | Separately authorized fallback for unavailable, failed or unusable Vibe work; implementation specialist where delegated | Its success never turns a Vibe gate into PASS |

For implementation delegation, assign files explicitly and require preservation of other contributors' changes. For a target-machine defect, retain evidence and send a minimal reproduction to the preparing maintainer; fix it on main and cut the next version there.

Use the current installed skills, existing MCP tools and coordinator scripts. Keep all calls for an isolated run on its owning connection. No automatic retry, task replay, account rotation or limit increase.

## 4. Delivery sequence

~~~mermaid
flowchart LR
    A[Freeze identity and contracts] --> B[Install and verify connection]
    B --> C[Useful bounded review]
    C --> D[Edit, verify, correct and close]
    D --> E[Stability and recovery checks]
    E --> F[Two pilots and 100-run soak]
    F --> G[Clean account and release rehearsal]
    G --> H[v1.0.0 stable]
~~~

Each stage produces a reviewable evidence bundle and a go/no-go decision. A defect stops progression; retain the failure, fix only the demonstrated cause, verify the changed behavior, and start a separately recorded attempt. Historical passes remain useful but do not silently substitute for current-build evidence.

### Stage A — identity and contract reconciliation

**Owner:** preparing maintainer and coordinator. **Deliverable:** installation receipt, current gate ledger and clarified Phase D expectations.

1. Identify the release by version, immutable source commit and archive SHA-256. The local skills-refresh “rc.15” and main's simplified rc.15 are different builds. Version alone is insufficient.
2. Locate the actual rc.17 archive: release artifacts are ignored by Git and are not transferred by fetch. Verify the complete SHA256SUMS set. Handoff reports archive hash 5e25afc6ab0c292e6db2abf5ebaccd92b2fe957c283a34c3d0156a29e235b1b0; treat that as a published receipt until the target verifies the bytes. If unavailable, use the prescribed offline packaging path and identify the rebuilt artifact separately.
3. Reconcile Handoff, compatibility gates and acceptance.json. Add current evidence without promoting old scope. Use PASS, FAIL, PARTIAL, UNVERIFIED and explicitly decided out-of-scope statuses.
4. Clarify D22: stopped owned workers and released locks are required; a recoverable edit may retain its owned worktree. Removal is required after verified close/cleanup, not automatically on disconnect.
5. Clarify D25: a controlled fixture must demonstrate same-session edit correction; a product candidate that is correct initially must not be forced to acquire a defect. Preserve both acceptance and correction coverage.
6. Replace global “every run held” claims with version-bound observations. Separate automated rc.17 coverage from rc.13 hosted evidence.
7. Re-triage the cold review against the exact candidate before hosted acceptance. Fix reproduced boundary/lifecycle blockers on main; track other findings with explicit status and scope. Do not begin a large test campaign on a knowingly blocked candidate.

These clarifications preserve required behavior; any actual removal or narrowing of an existing release gate requires an explicit owner decision recorded before execution.

### Stage B — install and verify the actual connection

**Owner:** target coordinator. **Coverage:** D0–D4, D14–D16 installation/client portions.

Install into a new private prefix; retain the previous runtime and evidence. Inspect existing configuration before writing, preserve allowlists and unrelated settings, and back up changes. Migrate auto to the selected programmatic or ACP backend; remove only the deprecated keys identified by validation. The new CLI is setup, allow, doctor, serve and runs.

Record a rollback procedure for the executable/MCP entry, skill links and prior compatible configuration/data home. Do not point an older runtime at newer saved state without validating compatibility, or delete current evidence to make rollback appear clean.

Record archive/source identity, installed executable path, Node/Vibe paths and versions, configuration migration and installed skill hashes. Read the refreshed skills. Doctor proves local prerequisites, not authentication or hosted inference.

Reconnect the desktop and verify the actual server handshake/version and catalog. A fresh official-client connection is a separate observation, not desktop proof. An old run's supervisor_version identifies its creator, not necessarily the current process. After dispatch, bind new-run creator metadata to the installation receipt. If the version cannot be established, record unknown and resolve it before accepting the test.

**Exit:** exact installation identified, required configuration checks pass, expected five/seven tools observed for each supported profile, prior state preserved.

### Stage C — useful bounded read-only review

**Owner:** coordinator and Vibe. **Coverage:** D5–D7 and current desktop review visibility.

First use a small tracked synthetic fixture with a known correctness defect and independent oracle, plus a clean control. The [updated UARoute S5 evidence](history/reviews/uaroute-s5-adoption-update-2026-10-09.md) records a completed rc.12 review under an expected rc.15 installation; do not repeat that finished review merely to obtain a newer version label. Vibe missed a P2 combined-query/channel-total ambiguity subsequently corrected and accepted by Luna. Choose a new narrow review scope and freeze the supplied files/hashes; compute those hashes independently rather than crediting the worker's echo of them.

Provide a concise objective, available file tools, exact readable paths, acceptance questions and final-answer requirement. Set the authorized cumulative turn/time ceilings before launch; prompt guidance cannot guarantee reserved turns. Use bounded waits and cursors, accounting for client deadlines.

Verify that findings identify real triggers and consequences in the inspected scope. A style preference, implementation plan or request for edit mode is not a correctness finding. A legitimate “no defect found” answer is acceptable for a clean scope; never require a finding count.

**Exit:** end_turn and actual final answer, independently assessed usefulness, correct integrity status, visible desktop result and supported close. This review does not demonstrate editing, patch export or edit-worktree removal.

### Stage D — complete edit acceptance before close

**Owner:** coordinator, Vibe and independent reviewer. **Coverage:** D8, D9 and D25.

First demonstrate correction using a controlled small fixture; then use one new, narrow product increment. Keep initial implementation, independent verification and correction within the agreed cumulative ceiling.

1. Prepare an immutable reviewed baseline. Dirty/untracked source changes are absent from a detached checkout unless explicitly included. Use the baseline script with dry-run and hash/mode-bound selected overlays; verify worker starting bytes. Never ask Vibe to reconstruct a baseline from pasted patches.
2. Delegate one owned increment, preferably one to three small files. The coordinator retains the full contract; the worker gets only the relevant behavior and cases.
3. Assess the candidate from its export and changed files. end_turn plus a final answer means ready for assessment, not accepted.
4. Apply the patch only in a separate exact verifier copy. Run meaningful acceptance/regression checks there; dependencies, build output and caches stay outside the Vibe worktree.
5. Keep the session open during independent tests and read-only review. Send a focused correction from concrete findings while budget remains; after an edit-match failure require a reread, and reassess after a second repeated failure.
6. Obtain the corrected fresh export and verify exact bytes, scope, new files, residual inventory and original source invariants.
7. Integrate only an accepted candidate under existing authorization. Close with cleanup_worktree only after fresh export verification; check worktree_removed and independent path absence. Retain a refused cleanup with its reason, without forced deletion.

**Exit:** independently accepted Vibe candidate, preserved baseline/source, complete export identity and verified cleanup. A coordinator production-code rewrite or premature close makes Vibe acceptance PARTIAL even if the eventual product is good. Record Luna fallback separately.

### Stage E — validate rc.17 stability and remaining lifecycle

**Owner:** preparing maintainer for deterministic regression work; target coordinator for installed/hosted evidence. **Coverage:** D6, D10–D13, D15–D17, D21–D24.

| Scenario | Required observation |
| --- | --- |
| Corrupt or missing run metadata | Expired eligible orphan records removed; valid-but-incompatible records, live ownership and unverified worktrees retained with diagnostics |
| Disconnect during blocked export | Ten-second shutdown deadline exercised; only owned worker groups stopped; owner lock released; next start truthful; any bounded Git operation accounted for |
| Undeliverable automatic policy denial | Request resolves as refusal, warning retained, no grant and no watchdog-length hang |
| Close while worktree creation is pending | No unexplained orphan; actual retained/removal outcome and retry remedy visible |
| Running/idle disconnect and restart | No automatic task replay; pending grants cleared; validated load or accurate non-resumable error; graceful restart distinguished from hard crash |
| Idle expiry/dead live session | Lazy explicit continuation preserves candidate and releases slots on failure |
| Turn/token/output/deadline/no-progress limit | Accurate saved/public state, stop reason/error and partial warning; no fabricated completion |
| Private profile and policy probes | Effective permitted file tools verified; nested paths accessible, outside/secret/reserved paths refused, project instructions not inherited |
| Review integrity | Real content changes detected; tracked touch and ignored-file stat semantics reported accurately |

Use deterministic fake peers/process fault injection for otherwise unreachable branches; label this coverage accurately. Hosted absence of permission requests does not prove callback correctness.

D21's deliberate 3-to-10 budget transition is a separately specified fixture, authorized before dispatch. It is not permission to increase limits for failed product work. A hard-crash experiment, if undertaken, must target only supervisor-owned test processes and preserve uncertain execution state.

**Exit:** current documented branches behave as specified, residue is attributed, unresolved contradictions are fixed or explicitly scoped before soak.

### Stage F — calibrated pilots and full hosted soak

**Owner:** target coordinator. **Coverage:** D18.

Run the two bounded pilot reviews first. Measure actual duration, tool calls, result quality and authoritative provider usage where available. Handoff's two-hour/USD 2–4 estimate is provisional, not an allowance or a billing promise.

Authorize a concrete run envelope: 60 programmatic reviews, 30 programmatic edits and 10 ACP jobs, with selected task set, limits, client/driver deadlines and a finite total wall deadline including cleanup reserve. Use the existing driver; incomplete coverage is INCOMPLETE, never PASS.

Pass requires all planned runs and required continuation/reload/mid-turn-close scenarios, zero unexpected failures, zero unhandled permission requests, no leaked owned workers or unexplained worktrees, bounded artifacts and retention behavior. Preserve the existing truthful-truncation threshold at no more than 10% overall and in every kind/backend bucket. Missing final answers remain truncated, not completed product tasks.

Keep task-compliance and useful-output findings separate from the lifecycle soak verdict. An arbitrary instructed read-count miss need not fail the supervisor soak; a correctness failure must still appear in the quality report. A 100-run pass is bounded evidence, not a universal reliability guarantee.

Stop on an unexpected failure, retain the attempt and diagnose it before another run. Do not classify VSUP_NO_PROGRESS as a pass or automatically retry it.

### Stage G — clean account and release rehearsal

**Owner:** target coordinator and owner. **Coverage:** D20 and distribution gate.

Demonstrate D0–D5 on a fresh macOS account using the actual release instructions and artifact, with normal private authentication. Complete current-build desktop concurrency/adoption and long-wait checks where still missing.

Review and merge the release workflow before tagging; verify available GitHub permissions without exposing tokens. Rehearse artifact creation with the populated offline cache, checksum validation, SBOM, deterministic acceptance and installed-package smoke. A rehearsal must not publish a stable tag prematurely.

Freeze the final release source. If version metadata changes after rc testing, rerun offline packaging/install checks and a bounded desktop acceptance confirmation on the exact final artifact. Runtime, dependency, policy or driver changes require the affected gates to be rerun; do not carry evidence across unexplained changes.

**Exit:** clean-account pass, supported scope documented, no open blocker, final artifact identified, workflow ready. Tag and GitHub publication require explicit release authorization; inspect the attached assets after publication.

## 5. Backlog and decisions before feature work

| Priority | Work | Acceptance / decision |
| --- | --- | --- |
| P0 | Installation identity and deprecated-key migration | Exact artifact, skills and connected version agree; rollback keeps earlier evidence |
| P0 | Reconcile Handoff, compatibility and machine-readable gate status | Each current claim links to scoped evidence; old passes retained with their versions |
| P0 | D25 desktop acceptance and controlled correction | Exact candidate independently accepted before close, with no coordinator production rewrite |
| P0 | rc.17 stability branches and D22 worktree expectations | Deterministic regressions plus target observations; retained recovery artifacts distinguished from leaks |
| P0 | Re-triage cold-review F7–F15 on current source | Each finding has reproduction/status, impact, fix or explicit limitation; do not inherit its old severity blindly |
| P0 | Full D18 and clean-account release gates | Complete current-build evidence, not partial samples |
| P0 | Workflow, platform and callback scope decisions | Written decisions before tagging; release assets actually verified afterward |
| After stable | Compact diagnostics from existing sanitized audits | Add fields only when current reports cannot answer a real question |
| After stable | Remove unused dependency / consolidate internal contracts | Demonstrated simplification with focused regression and package checks |
| After stable | ACP-only decision, timer consolidation and test regrouping | Evidence for all required ACP scenarios and a reviewed migration plan |
| Later | Other Vibe versions, unified harness, Linux and plugin installation | Separate source/compatibility/security/installation acceptance |

Cold-review focus: F7 state races, F8 reject-option classification, F9 elicitation schema consistency, F10 broad manual roots, F11 creation/close race, F12 wire-output limits, F13 shutdown, F14 unused dependency and F15 persisted cleanup paths. rc.17 implements a remedy for F13; automated coverage does not close its target-machine gate. Earlier F1–F6 fixes are recorded in rc.10 and remain regression requirements.

Any reproduced violation of fail-closed permissions, supervisor-owned cleanup paths, saved/public state agreement, bounded shutdown or source preservation blocks stable release. Narrow usability limitations may be documented only with clear scope and an explicit release decision.

Permission/elicitation callbacks cannot be made “naturally hosted” by enabling forbidden tools. Require deterministic correlation, option-kind/refusal and schema tests. Choose either a legitimate hosted callback fixture without widening policy, or an explicit 1.0 limitation while retaining fail-closed tests. Do not silently count fake peers as hosted callbacks.

For Intel, choose tested support or Apple-silicon-only release scope. Stay pinned to Vibe 2.25.8 through 1.0; an upgrade needs renewed version/source/signature, profile, protocol and hosted acceptance.

## 6. Evidence and measurements

Use four verdict columns for every meaningful run:

| Dimension | Question |
| --- | --- |
| Supervisor | Were state, bounds, permissions, persistence, export and resource lifecycle correct? |
| Worker | Did Vibe obey the task constraints and produce a usable, independently correct result? |
| Coordinator | Were preparation, verification, correction, integration and close performed correctly? |
| Product / report | Was the exact candidate accepted against its contract? |

Maintain an installation receipt and one dated record per attempt. Minimum fields:

- Source commit, package/archive hash, executable path, connected server identity, new-run creator version, pinned Vibe version, backend/client and skill hashes.
- Run ID, objective, owned scope, baseline/bundle hashes and agreed turn/time/output limits.
- UTC timestamps, local planning timezone, elapsed runtime, focused effort if actually tracked, and cleanup reserve.
- Structured stop reason, final-answer presence, warnings/error, assistant turns, unique calls, failed updates and unique failed calls. Unknown counts stay unknown.
- Correction rounds, candidate/export hashes, independent checks/reviewer decision, source preservation and actual integration status.
- Close outcome, ownership-scoped process/lock inventory, removed worktree or explicit retention reason, and unexercised scenarios.
- Monetary usage only from an identified authoritative source; estimates labeled with basis. Prompt bytes/calls are proxies, not tokens or savings.

Retain native histories privately. Committed reports contain sanitized counts/classes and public findings, not raw tool arguments, commands/replacement bodies, reasoning, secrets or customer data.

Measure time to first event, settled result, export and shutdown; coordinator calls, unchanged polls, response bytes and baseline preparation effort. Compare efficiency only across comparable accepted outcomes. Do not promise a savings percentage from one pilot.

Compatibility.md remains the canonical release-gate list, acceptance.json the structured ledger, and history/ the dated evidence. Handoff provides current orientation and the next action; this strategy provides priority and rationale. Synchronize all four when a gate changes.

## 7. Definition of v1.0 stable

Stable release requires the following. Satisfy items 1–7 and workflow readiness before authorizing the tag; verify published assets afterward as part of final release acceptance:

1. The final shipped artifact and supported environment are unambiguously identified, with required offline verification and installation smoke passing.
2. Handoff's required D0–D18 and D21–D25 coverage passes on the candidate or a documented final-artifact validation, plus clean-account D20. D19 remains optional. Any approved scope exception is explicit; no silent gate removal.
3. The actual desktop workflow demonstrates useful review, independently accepted isolated editing and controlled same-session correction, followed by verified cleanup.
4. Recovery preserves owned candidate evidence without replay or restored grants; shutdown is bounded and residue explained.
5. The full 100-run hosted soak satisfies its declared thresholds and scenario coverage.
6. Open cold-review findings are resolved or assessed against explicit supported limitations, with no boundary/lifecycle blocker deferred.
7. Installed skills, README, configuration/schema, functionality, compatibility, Handoff, acceptance and release receipts agree.
8. Release workflow is reviewed and ready; the owner authorizes the stable tag/publication, and its actual assets are verified afterward.

Keep 1.0 frozen to the tested surface. After release, triage incidents from sanitized run evidence, issue focused patch releases, preserve rollback compatibility and rerun affected gates. Consider ACP-only simplification after scenario coverage and a migration decision, rather than treating ten ACP soak jobs alone as evidence for dropping the backend used by the other ninety jobs.

## 8. Immediate next work package

The next execution task is **rc.17 target-machine installation and bounded desktop acceptance**, not another broad UARoute implementation or an immediate full soak.

Deliver an exact installation receipt; resolve removed configuration keys; confirm the desktop connection and installed skills; perform one bounded correctness review; demonstrate a controlled edit/correction and one narrow product acceptance; then report the four verdicts and verified cleanup. Stop progression at the first failure and return the smallest supported reproduction.

Record the actual hosted allowance and task limits before dispatch. No historical hours or monetary estimate supplies authorization. This strategy-writing task itself launches no hosted inference, changes no global configuration and publishes no release.

## Sources and provenance

- [Current Handoff](../Handoff.md), [README](../README.md), [changelog](../CHANGELOG.md), [functionality](functionality.md), [reference](reference.md), [security](security.md), [compatibility](compatibility.md) and [acceptance ledger](acceptance.json).
- [rc.12 SEO audit](https://github.com/crew-lab/codex-vibe/blob/f8b9dc30cabdf55dfadfd3b57c1c2937b81ee875/docs/history/reviews/rc12-seo-worker-adoption-2026-10-09.md), [rc.13/14 adoption evaluation](https://github.com/crew-lab/codex-vibe/blob/f8b9dc30cabdf55dfadfd3b57c1c2937b81ee875/docs/history/reviews/rc13-worker-adoption-2026-10-09.md), [adoption plan](https://github.com/crew-lab/codex-vibe/blob/f8b9dc30cabdf55dfadfd3b57c1c2937b81ee875/docs/history/vibe-worker-adoption-plan-2026-10-09.md) and [skills installation receipt](https://github.com/crew-lab/codex-vibe/blob/f8b9dc30cabdf55dfadfd3b57c1c2937b81ee875/docs/history/reviews/rc15-skills-refresh-2026-10-09.md).
- [Cold review](https://github.com/crew-lab/codex-vibe/blob/f8b9dc30cabdf55dfadfd3b57c1c2937b81ee875/docs/history/reviews/1.0-cold-review-2026-10-08.md), [historical Handoff and Phase D results](https://github.com/crew-lab/codex-vibe/blob/f8b9dc30cabdf55dfadfd3b57c1c2937b81ee875/docs/history/handoff-rc15-2026-10-09.md), [silent-stall analysis](https://github.com/crew-lab/codex-vibe/blob/f8b9dc30cabdf55dfadfd3b57c1c2937b81ee875/docs/history/reviews/vibe-2.25.8-silent-stall-analysis-2026-10-08.md) and [coordinator scripts](https://github.com/crew-lab/codex-vibe/blob/f8b9dc30cabdf55dfadfd3b57c1c2937b81ee875/scripts/README.md). Historical evidence and scripts are source-only; these immutable source links also work from the installed package, which excludes those directories.
- Additional local input: the UARoute adoption report at docs/Operations/POC/vibe-adoption-report-2026-10-09.md in the separate UARoots repository, read in this conversation. Historical observations are qualified above; it is not copied into this package.
- Earlier dirty-checkout proposals: docs/reviews/efficiency-roadmap.md and docs/reviews/deployment-acp-lessons-2026-10-08.md. Their reliability, bounded waiting, compact results, session preservation and measurement ideas are incorporated where applicable. They are historical proposals, not current runtime specifications.

Verification of this strategy is documentation-only: local links and whitespace are checked separately. No fresh release, hosted, soak or platform PASS is claimed by this document.

## Preparation follow-up: 2026-10-09

The [follow-up record](history/reviews/rc17-preparation-followup-2026-10-09.md) reconciles the later UARoute security evidence. Native rc.17 bounded read-only review was observed, with an independently confirmed finding and supported close. The old stale-connection attempts stay historical; each new gate must still establish its own run identity.

The next implementation increment adds stable sanitized preparation diagnostics and actual dry-run/create regressions. Default sensitive-file refusal remains; explicit hash-bound root `.env.example` support requires restrictive content checks and preserves runtime tool/allowlist boundaries. Scripts remain coordinator source tools, outside the installed npm package.

After preparation checks pass: controlled native edit and deliberate same-session correction, exact separate verification and independent review while open, fresh export and verified cleanup; then one narrow product change. Product acceptance, fixture correction and full reliability are separate gates. Do not jump to soak or repeat accepted UARoute changes to manufacture worker success.

The two authorized native follow-up runs passed their bounded scopes: controlled edit plus deliberate same-session correction, then a narrow coordinator-tool product edit with an actual regression-driven correction. Both exact candidates were independently reviewed before supported cleanup; original sources remained unchanged. This closes those specific adoption blockers, not the full Phase D/recovery/soak/platform gate set. The next hosted work is targeted remaining lifecycle acceptance after current-source cold-review triage.

## Lifecycle triage follow-up: 2026-10-09

The preparation branch was merged into remote main at `9191338`. [Current triage](history/reviews/lifecycle-triage-2026-10-09.md) reproduces four prerequisites: F8 typed denial selection, F7 response-state race, F15 saved-worktree identity validation and F11 late-creation accounting. Fix and independently review those before the [bounded recovery pilots](lifecycle-recovery-test-plan.md). F9 schema alignment precedes elicitation acceptance; F10/F12 require explicit supported-policy/accounting decisions. F13 has passing offline shutdown regressions, not a native recovery certification. F14 remains nonblocking maintenance.

The immediate work package is these focused runtime fixes and regressions, followed by verified packaging/installation and the declared recovery pilots. No new hosted runs or full soak started during triage. Existing offline suites passed 34 tests; they do not erase uncovered failures. Earlier installation/edit sequencing above is historical context; the preparation follow-up completed its narrow native scopes.
