# Current state — 2026-11-01

**Compatibility source change verified — 2026-11-01.** The owner authorized stable Vibe releases at or above 3.0.2 without a per-release allowlist, superseding step 9/D6 below. `vibe_version` is an optional minimum; the actual installed version is discovered and must match its manifest and startup handshake exactly. Refresh the reviewed manifest and rerun candidate preparation after a CLI update. The shared wire contract supports the legacy and current edit approval names without adding tool or path access. Source implementation and independent read-only code review are complete. `npm run verify:release` passed on Node 24.22.1: 124 test files, 1,752 tests passed and one skipped, plus lint, typecheck, build, acceptance reporting, secret scan and SBOM generation. Focused backend/preparation fixture checks passed 136 tests, including newer installed-release identity and current edit approval names; these are local fixtures, not hosted qualification. Documentation links and whitespace checks passed. RC 2.2.1 archive packaged offline from `ccfbbd6`: archive SHA-256 `2731c0b8ab76736e827d17fb370fd65f27d84f17984bfcc4b50ea884f03d66d4`, candidate `a4181ea8362939697649234aee1d6b2ae68d7b026ec021781bc168119b0c5ac6`, conformance script `9440f1379c6bfcabb78232a11042e09e329e16c787256e995e3a4b6fcc136fe8`. Target candidate preparation against Vibe 3.0.4 passed (`verdict: none-observed-control-validated`); hosted qualification is pending. See [the owner decision and approach](planning/development-strategy.md#flexible-vibe-compatibility--owner-decision-2026-11-01).

**Source and release.** v2.2.0 was published on 2026-10-27 from `cea6bed` as a pre-release through [crew-lab/codex-vibe#11](https://github.com/crew-lab/codex-vibe/pull/11); by decision D2 (2026-10-28) the owner marks it latest without the clean-account installation. `main` carries unreleased 2.2.1 work. The target's integration branch `main-agy` was consolidated into `main` on 2026-11-02 without its contract-enforcement and repair code, which waits on the owner (row 15). Archive SHA-256 `6b0a120d1ae16bb102af4bc07bfa11522684f536a3a17fce3f9f93dc70d44984`, candidate `81df8140eb49afbebfb5202bc3186c97f9ea8b57a7243d108ce376cbdcc73b90`; the kit, SBOM, qualification report and run ledger are release assets. Beyond the 2.2.0 features (`allowed_write_paths`, per-field authorization diagnostics), the release carries `919fd3c` (`task authorize` binds the server's selected Node runtime) and `45dc907` (grant storage, prepared-input and private-directory repairs, and [the local operating procedure](docs/local-operation.md)). No functional source changed after qualification.

**Qualification.** Two native hosted trials on that archive, Node 24.21.0 on macOS arm64 with an isolated exact Vibe 3.0.2: Trial A, a one-file edit, accepted on its contract and ten independent numeric cases; Trial B, a review, accepted on three evidence-backed boundaries with all 274 project-file hashes unchanged. Both workers exited, private state was removed and the slot is free; Trial A's dirty worktree is retained with its verified export; both authorized starts are consumed, with no replay or fallback. Package verification on Node 20.19.0: 109 files, 1,567 tests. The [evidence](research/evidence/v2.2.0-local-workflow-20261027/README.md) does not certify general reliability, a clean account, the newer Vibe CLI on the target's PATH (3.0.3, separate from the supervised runtime) or Antigravity. The trials did not carry the nested `run_typescript` probe, so `nested-run-typescript-shape-and-gating` stays unverified.

**Operating.** Follow [the local operating procedure](docs/local-operation.md). Preserve the qualified installation, settings and rollback.

**What remains.**

The order, each step's outcome and the recommendation for every owner decision (D1–D6) are in the [development strategy's Direction](planning/development-strategy.md#direction--2026-10-28); this table is the status.

| # | Step | Who | State |
|---|---|---|---|
| 1 | Record the 2.2.0 build and its two trials in `docs/acceptance.json`; then simplify the ledger to one observed-list per build | Coordinator agent | Done 2026-10-28 (D1): the ledger is one entry per build, 2.2.0 first with seven gates observed from the committed evidence and the rest open with a reason each; `npm run acceptance` reports the new shape |
| 2 | Mark v2.2.0 latest. The owner has no spare standard macOS account (2026-10-17), so the clean-account gate is retired as a blocker; the target's fresh-prefix install and the offline smoke stand in | Owner | D2 accepted 2026-10-28; the owner marks the release latest |
| 3 | Ten real starts through Codex on real tasks, each logged with its export and `runs usefulness` entry; the log orders the later steps | Owner uses; target agent records | D3 accepted 2026-10-28 (an allowance of about ten); two separately authorized real-use design trials are recorded in [the real-use report](research/evidence/real-use-design-20261028/README.md), both rejected; neither is retroactively charged to D3 |
| 4 | Start friction: `vibe_status` returns the exact `task authorize` command for the connected server; the skill carries the sequence; a Codex custom agent wraps it. The single-use grant is unchanged | Coordinator agent | Done 2026-10-28 on `main` (`11a58dd`, unreleased): readiness returns `task_authorize` and a request template; the skill carries the sequence; `.codex/agents/vibe-reviewer.toml` wraps it |
| 5 | The nested `run_typescript` probe rides on the next hosted review and settles `nested-run-typescript-shape-and-gating` | Target agent | Attempted on 2.2.1 review; PROBE_UNAVAILABLE, nested gate remains open |
| 6 | Search context without a new boundary: the skill has Codex search first and pass the hits as `context_files`; measured on step 3's reviews | Coordinator agent | Done 2026-10-28 on `main` (`464211e`): the skill and the `vibe-reviewer` agent search first and pass at most 8 `context_files`; the measurement waits on step 3 |
| 7 | Review search sidecar ([design](planning/2.1-designs.md#5-search-tool-for-reviews), source-checked against Vibe 3.0.2): built only if step 5 shows nested calls deniable and step 6 did not close the quality gap; it changes three AGENTS.md lines | Coordinator agent; target agent runs its hosted gate | [Design](planning/review-search-tool.md) proposed on 2026-10-28; product code deferred until steps 5 and 6 provide evidence (D4) |
| 8 | Antigravity frozen at agy 1.4.9 (D5 accepted 2026-10-28; freeze note in ADR 0008 and security): `main` carries 1.4.7–1.4.9 and the opt-in, logged `[experimental] antigravity_skip_permissions` switch. The five target probes passed on the target machine with agy 1.4.9 and evidence is committed under `research/evidence/antigravity-1.4.9-target-20261028/`. No new agy versions, flags or features; dropped in the next minor if unused | Target agent | Frozen; 5 probes verified on target, evidence committed (`ec91006`), gates settled in `docs/acceptance.json`, and pushed to `origin/main-agy` (`de4f8d3`) |
| 9 | Flexible Vibe versions: accept stable releases at or above 3.0.2 using installed metadata, an exact installed-file manifest and runtime compatibility checks; no per-release allowlist | Coordinator agent | Owner decision 2026-11-01 supersedes D6 and the exact-pin table. Source verified: full release checks passed (1,752 tests, one skipped); Vibe 3.0.4 preparation network request traced to completion model catalogue lookups and routed to loopback during placeholder-key checks; candidate a4181ea8… passed preparation on Vibe 3.0.4; hosted evidence pending |
| 10 | Thin the documents: `planning/development-plan.md` to Git history, superseded briefs deleted from this file | Coordinator agent | Done 2026-10-28: the plan file points to the strategy, this file and Git history (`867ce3b`); this file keeps the current state, the other-machine commands, the open questions and the pointers; the 2.1 sketches other than the sidecar are reduced to their status |
| 11 | Release 2.2.1 as its own candidate once step 4 lands: preparation PASS, one review, one edit, pre-release | Target agent; owner publishes | RC 2.2.1 archive packaged from `ccfbbd6` (`2731c0b8…`, candidate `a4181ea8…`); target preparation on Vibe 3.0.4 passed, native trials pending |
| 12 | Persist the number of `context_files` per review in the run record and export, so step 3 measures step 6 without a hand log | Coordinator agent | Implemented on the qualification branch; persistence/export regression checks pass; Node 20.19.0 release verification and offline packaging passed (115 files, 1,623 passed / 1 skipped) |
| 13 | Public surface (marketing step 1, M1–M6 accepted 2026-10-28, see [marketing/strategy.md](marketing/strategy.md)): repository description and topics; the README opening is already current | Owner | Open |
| 14 | Mistral contact (marketing steps 2–3): the security re-check (`research/vibe-3.0.2-security-recheck-2026-10-28.md`) drafts the private note to `security@mistral.ai` on `workspaceRoots`; public bug reports on `initialize` protocol version, 3.0.3 wire rename and ADR 0009 method naming drafted in `research/mistral-upstream-disclosures-2026-11-01.md`. Private note must precede public reports; nothing sent | Owner sends; agents only draft | Drafts ready; nothing sent |
| 15 | Target branch `codex/vibe-usability-20261028`, split 2026-11-02 | Owner decides | Intake hardening merged to `main` (`247e165`) with a bounded launch-time admission. `codex/contract-enforcement` (contract in every edit prompt, `node_test` check, TypeScript at runtime) and `codex/repair-and-check` on top of it (`task repair`, `validation check`; draft ADR 0011 folded into the strategy) wait for the owner: scope before step 3, correction reserved at grant issue or at start, and whether the supervisor runs worker-written tests. Both carry review fixes; their strategy entries are on the branches. Open: a fresh `report export` failed with `VSUP_ARTIFACT_ERROR: Cannot read directory: owner` (target, 2026-10-30), not yet investigated |
| — | Done 2026-10-28: byte-reproducible `package:rc` (one source date, lockfile-derived SBOM namespace); two clean builds matched, so the target build of the next candidate can be compared by `SHA256SUMS` | — | Done |

## Testing on another machine

GitHub holds `main` only; every former branch is in its history. On another Mac (Apple silicon, Node 20.19 or later, Git):

```bash
git clone https://github.com/crew-lab/codex-vibe.git vibe-supervisor && cd vibe-supervisor && npm ci && npm run verify:release
```

`verify:release` needs no Vibe and no network beyond `npm ci`. To package offline, fill a dedicated npm cache with the locked versions first, then package; `package:rc` also writes `release/preparation-kit-<version>/`, which belongs to that archive:

```bash
CACHE="$PWD/.npm-offline-cache" && node -e 'const l=require("./package-lock.json");const s=new Set();for(const[k,v]of Object.entries(l.packages)){if(!k||v.link||!v.version)continue;s.add((v.name||k.slice(k.lastIndexOf("node_modules/")+13))+"@"+v.version)}console.log([...s].join("\n"))' | xargs -P 8 -n 1 npm cache add --cache "$CACHE" && VIBE_SUPERVISOR_TEST_NPM_CACHE="$CACHE" npm run package:rc
```

Behaviour on a running Vibe is proven only by the [target acceptance procedure](docs/target-acceptance.md) on the machine that runs it. After `pin-manifest`, run `vibe-supervisor prepare check --kit <absolute path of the kit> --config "$CONFIG"` once, because readiness and every start need its pass.

## Open questions

**Only the target can answer.** The protocol questions that fail closed are listed in the [strategy's verification model](planning/development-strategy.md#verification-model), and the [procedure](docs/target-acceptance.md) records which way each goes. The 2.2.0 trials completed without a refusal on that build; one hosted observation is still owed: `nested-run-typescript-shape-and-gating` (Direction step 5, on the next hosted review). The five `antigravity-*` probe gates are observed and committed under `research/evidence/antigravity-1.4.9-target-20261028/` for candidate `14c74597…` with agy 1.4.9. A new build reopens every observation.

**For the owner.** The private project name is in `main`'s history (commit `2e920d3`); the current tree uses `<site-project>`. The recommendation stands: leave history as it is unless the name is sensitive, because a rewrite of public `main` breaks every clone.

**Known limits of this state.** Linux and Windows code paths exist without a support claim; the validation helper blocks project manager configuration, local dependencies and required build scripts until a reviewed profile exists; the full list is under [documented limits](planning/development-strategy.md#where-things-stand).

## Evidence

The rules are in [target acceptance](docs/target-acceptance.md#recording-evidence) (the placeholders, the private-path grep, what never reaches a committed file) and its [code-fix rule](AGENTS.md#code-changes-on-the-target-machine); the two-machine principle is in the [strategy's working rules](planning/development-strategy.md#working-rules). Evidence names the exact source, archive and installed distribution it belongs to and never transfers to other bytes; missing evidence stays unverified; `docs/acceptance.json` is the per-build observed ledger.

Sanitized evidence folders under `research/evidence/`:

| Folder | What it records |
|---|---|
| `package-kit-identity-2026-10-15` | The 2.0.1 packaging and kit identity repair; native readiness addendum of 2026-10-16 |
| `hosted-2.0.1-2026-10-16` | The 2.0.1 hosted review, rejected on worker answer quality |
| `disconnect-2a49abd-2026-10-16` | The MCP-client disconnect PASS |
| `release-2.0.2-347bf79-2026-10-16` | The 2.0.2 packet, native readiness after restart, carry-over assessment and coordinator review |
| `antigravity-backend-2026-10-17` | The Antigravity no-inference check |
| `vibe-302-stability-20261026` | The 2.1.0 qualification: preparation, native readiness and one accepted fixture edit |
| `v2.2.0-local-workflow-20261027` | The 2.2.0 trials: one accepted native edit and one accepted native review |
| `qualification-221-20261028` | The 2.2.1 candidate trials: preparation, native readiness, accepted review, rejected edit |
| `real-use-design-20261028` | Two separately authorized real-use design trials on 2.2.0, both rejected |
| `antigravity-1.4.9-target-20261028` | The Antigravity 1.4.9 target probes: 5 probe gates observed and preparation receipt |
| `mechanism-resilience-20261029` | The mechanism resilience and external-input reader candidate evidence |
| `contract-repair-20261029` | The contract-bound fresh repairs and weather fixture acceptance |

The workflow candidate's 2026-10-15 packet is at commit `2e920d3`.

## Pointers

Shipped: [functionality](docs/functionality.md), [reference](docs/reference.md), [security](docs/security.md), [compatibility](docs/compatibility.md) (source basis, gates and diagnostic reasons), [compatibility for 3.0.2](docs/compatibility-v3.md), [target acceptance](docs/target-acceptance.md), [workflow acceptance](docs/workflow-acceptance.md), [preparation](docs/preparation.md), [validation workspaces](docs/validation-workspace.md), [local operation](docs/local-operation.md), [errors](docs/errors.md) (generated), `docs/acceptance.json` (machine-readable gates), the ADRs under `docs/adr/`, the coordinator skill `skills/vibe-supervisor`.

Source repository only, not shipped: the [development strategy](planning/development-strategy.md), the [2.1 design sketches](planning/2.1-designs.md), `marketing/`, `research/`.

| Area | Code |
|---|---|
| MCP server and tool schemas | `src/mcp/` |
| Run lifecycle, one active slot, deadline, watchdog, retention, owner lock, policy reread and readiness receipts, saved-run routing after `--isolated` reconnect | `src/core/`, `src/config/policy.ts` |
| App-server client: backend, JSON-RPC transport, protocol subset, the per-version wire table, session configuration and read-back, managed-config endpoint, bundled skills, approval handler, event validator, usage and outcome mapping, pin check, credentials, workspace listing; the reaper | `src/backends/app-server.ts`, `src/backends/app-server/`, `src/process/reaper.ts` |
| Antigravity backend, its hook and probes (experimental) | `src/backends/antigravity.ts`, `src/backends/antigravity/`, `src/preparation/antigravity-*.ts` |
| Acceptance contracts, assessments and verification | `src/acceptance/` |
| Reports, private-file reads, model observations | `src/reporting/` |
| Preparation evidence and the dispatch gate | `src/preparation/`, `src/cli/prepare.ts` |
| Validation copies | `src/validation/`, `src/cli/validation.ts` |
| Worktrees, private-index export, verified cleanup | `src/git/worktree.ts` |
| Paths, child environment, redaction | `src/security/` |
| Configuration and `--isolated` session homes | `src/config/` |
| CLI: `setup`, `allow`, `doctor`, `pin-manifest`, `serve`, `prepare`, `validation`, `runs`, `task` | `src/cli.ts`, `src/cli/`, `src/diagnostics/doctor.ts` |
| Release, conformance and coordinator scripts (only the conformance script ships, for the kit) | `scripts/` |

## Fixed scope and safeguards

Exactly five one-shot MCP tools; one owned active slot; canonical allowlists; no ACP, continuation, recovery replay, queue, automatic patch application, worker shell or network, extra hosted starts or new platform scope. Reviews are read-only; edits use isolated detached worktrees. Bundled skills stay inside the same tool and path policy. The enforcement points and the pin are listed in the [strategy](planning/development-strategy.md#architecture-and-enforcement-points) and fixed by [AGENTS.md](AGENTS.md). Private runtime state stays private and evidence is sanitized; uncertain cleanup retains files. These are application-policy controls, not an OS sandbox. Missing evidence remains unknown: each archive has its own target evidence, and no other platform or universal answer-quality guarantee is made.

## History

The dated checkpoints, target briefs, 2.0.x and 2.1 sitting records, cold-review findings and superseded "Remaining" tables that this file carried up to 2026-10-28 are in Git history at `867ce3b` (`git show 867ce3b:Handoff.md`); the decisions they recorded are summarized in the strategy, and their evidence is in the folders above.

## 2.2.1 qualification preparation — 2026-10-28

Isolated source based on main 08b6ddf plus uncommitted context-count, version and evidence changes. Candidate 65dbafd0700891c72978e35df8a599a1c110ba37d13ff68bb19a3004cbe1e716; archive SHA-256 18744750fb5e1bf1695e1aa25b1ef2b6caddb746fadb08c6222cc4b53f0d2afc. Node 20.19.0 package:rc passed release verification (115 test files; 1,623 passed, one skipped), offline installed-package smoke and final kit/archive identity checks. Delivery is retained in the task worktree release directory with preparation-kit-2.2.1 and SHA256SUMS.

Side-by-side target installation was not executed: host automatic approval review could not complete because of an account usage limit. No prefix was created, no configuration or registration changed, no pin/preparation run occurred and no hosted grant or start was spent. The existing 2.2.0 installation remains selected. Resolve host approval availability before target installation, matched no-inference preparation, native reconnect/readiness and the authorized review/edit qualification. The review must carry the nested policy probe. No hosted or preparation PASS is claimed for 2.2.1. No source commit, push or publication occurred.

### Preparation resumed

The host approval route is available again. Side-by-side offline installation, pin/doctor and matched preparation passed for candidate 65dbafd0 under Node 24.21.0. Registration now selects 2.2.1 with backup retained. The existing native connection still reports 2.2.0; reconnect is required before qualification. Zero grants or hosted starts spent. See [preparation evidence](research/evidence/qualification-221-20261028/README.md). This supersedes the earlier installation blocker; hosted acceptance remains unverified.

### Hosted qualification outcomes

Native 2.2.1 readiness passed after reconnect. Both starts consumed: review accepted independently on five cases and read-only integrity, context_file_count 2 observed in export; nested probe unavailable and gate remains open. Edit semantic checks (nine) and worker tests (five) pass, but frozen literal import assertion fails despite equivalent strict assertions; closed rejected under the unchanged contract. Both runs closed, slot free; dirty edit worktree retained. No accepted-edit qualification, replay, fallback, integration, commit or publication. See [hosted evidence](research/evidence/qualification-221-20261028/README.md).

### Local usability follow-up — 2026-10-28

A local source repair on codex/vibe-usability-20261028 makes validation --no-install copy generic Git fixtures without a package manifest, lockfile or manager execution. Install-mode offline safeguards remain. The active coordinator skill and example contract now trace required checks to the requested outcome, accept equivalent strict assertion imports and require separate named node:test inspection plus validation preflight. The preserved repeated-trial patch passes five generated tests and eight independent cases under this diagnostic; its historical literal-contract rejection remains unchanged. Local release verification passed on Node 24.22.1. Fresh independent Sol/high acceptance VERIFIED follow-up R6/R7 under the owner-approved instruction-based read-only amendment; source, archive and installed candidate remain separate. No packaging, installation, new hosted start or publication follows this source check. See [local follow-up evidence](research/evidence/vibe-usability-20261028/followup/README.md).

### Routine integration recovery — 2026-10-28

An external integration test stopped before inference on a coordinator-created 0644 patch. A verified mode-only repair to 0600 made preflight pass; skill/docs now state private file creation and bounded diagnosed pre-start repair. Two authorized hosted starts then completed on unchanged candidate 65dbafd0: review accepted, edit rejected because generated tests omitted the node:test import. The unchanged function passes eight independent numeric cases; its generated tests fail ReferenceError. A separate coordinator-only import repair passes five tests and detects the original equality defect; it is not Vibe success or integrated output. Both runs closed, configuration restored byte-for-byte, slot free, original fixture clean. [Recovery evidence](research/evidence/vibe-usability-20261028/preflight-recovery/README.md) preserves the original rejection and correction attribution. No new hosted start or publication is authorized by this result.

## Local mechanism resilience candidate — 2026-10-29

The mechanism review separates explicit caller inputs from private state. Local source accepts ordinary owned 0644 request/contract/patch/validation files unchanged, returns typed bounded input diagnoses and retains strict private artifact checks. Full prepared-input verification now runs before grant issue and consumption, again at launch, and materialized context is checked by byte length/hash. Known-invalid preparation spends no attempt; a change after consumption never replays. No worker tool/path or authorization boundary changed. The first full gate exposed missing-versus-stale receipt classification; a narrow integration repair passed both affected suites. The second full gate passed 118 test files, 1,657 tests and one skipped on Node 24.22.1; fresh independent local R1–R5 verification returned VERIFIED. [Evidence](research/evidence/mechanism-resilience-20261029/README.md) and [specification/remaining work](planning/mechanism-resilience-20261028.md) are source-only. The installed candidate is unchanged; no new archive, installation, hosted test or publication occurred.

## Resilience candidate installation — 2026-10-29

Commit 12bc355 pushed to codex/vibe-usability-20261028. Offline package:rc passed release verification, installed-package smoke and matched kit checks. Archive SHA-256 360d704905a12acb36b3cbc53c182adcfa56d79907190124d3c02a609d4c3b4f; candidate a535e3263de76a2fca01eb54329a8af7f8ecc41995cd0971d5578be27ce16423. Side-by-side installation and matched preparation passed under Node 24.21.0. Installed CLI accepts an unchanged 0644 patch, reconstructs exact copies and cleans them with fingerprint checks. Registration selects the new candidate and retains its prior backup. The existing native connection still reports old candidate 65dbafd0 and refuses expected-candidate admission; restart Codex before hosted testing. No hosted start was spent on the wrong candidate. Prior installation remains available for rollback. No release publication or merge to main occurred.

## Reconnected integration — 2026-10-29

New candidate connected. Artifact/request intake and copy-only validation passed with normal0644 inputs. Review accepted; edit rejected for omitted named node:test cases despite passing behavior and negative control. Both closed; temporary allowlist restored. See [test evidence](research/evidence/reconnect-integration-20261029/RESULT.md). Requirement enforcement and validation feedback remain open.

## Contract enforcement and repair candidate — 2026-10-29

The target installed and exercised a candidate built from the full usability branch, including a native weather XML acceptance run. That record and its evidence live on `codex/repair-and-check` with the code they describe (row 15).

## RC 2.2.1 packaging with flexible Vibe compatibility — 2026-11-01

Following the owner decision to support stable Vibe versions $\ge 3.0.2$, both edit approval names, and loopback provider catalogue routing for no-inference preparation, commit `ccfbbd6` was packaged offline via `package:rc`:
- Archive: `release/vibe-supervisor-2.2.1.tgz` (SHA-256: `2731c0b8ab76736e827d17fb370fd65f27d84f17984bfcc4b50ea884f03d66d4`)
- Candidate SHA-256: `a4181ea8362939697649234aee1d6b2ae68d7b026ec021781bc168119b0c5ac6`
- Conformance script SHA-256: `9440f1379c6bfcabb78232a11042e09e329e16c787256e995e3a4b6fcc136fe8`
- Kit directory: `release/preparation-kit-2.2.1/` (SHA256SUMS: `149fd79956bbf235f3e4b89bb1dbe9f5f69bf5eccd812e7a2de6692aa361401a`)
- SBOM: `release/sbom.spdx.json` (SHA-256: `8ac39a2798afce6bb716aa93663bbc9c717fbe6cce2429a0d796a914c2160abe`)
- Acceptance record: `release/acceptance.json` (SHA-256: `8bffac19fc491c322fb3ff263387605b2c3766531b158bd4ce8ab58e0a76317e`)

All 1,752 vitest tests, offline fresh-prefix install smoke test, and deterministic acceptance checks passed.

### Target observation and settlement on Vibe 3.0.4 — 2026-11-01

1. **Root-Cause Trace of Initial Failure**:
   On candidate `62aaf0b7…` (`b6ac0fd`), `prepare check` failed with `CONNECT api.mistral.ai:443` in both review and edit subject runs. Source tracing in Vibe 3.0.4 confirmed:
   - Caller: `vibe.app_server._completion_facts:compile_session_model_facts` -> `_catalogue_lookups` -> `MistralCatalogueFetcher.fetch`
   - Trigger: Occurred during `session/start` whenever `MISTRAL_API_KEY` was resolved (set by `--placeholder-key` to bypass startup credential blocks).
   - Traffic: Outbound `GET /v1/models/{model}` for model completion profile parameters (context window size and reasoning limits).
   - Subsystem: Pure completion facts catalog lookup; not telemetry, not auto-update, and not experiments.

2. **Loopback Routing Settlement**:
   In `scripts/v2-conformance-check.mjs`, when `--placeholder-key` is used on subject runs, provider `mistral`'s `api_base` is routed to the supervisor's owned loopback endpoint `${managedConfigEndpoint.url}/v1`. Because `127.0.0.1` is in `NO_PROXY`, the request is answered locally without touching the proxy or leaving the machine. Live supervisor runs (real inference) remain untouched with `api_base = https://api.mistral.ai/v1`.

3. **Candidate `a4181ea8…` Preparation Verification**:
   Testing candidate `a4181ea8…` against installed Vibe 3.0.4 passed every stage:
   - `pin-manifest --config "$CONFIG" --force`: PASS
   - `doctor --config "$CONFIG" --json`: PASS
   - `prepare check --kit release/preparation-kit-2.2.1 --config "$CONFIG"`: **PASS** (`status: passed`, `network_observation.verdict: none-observed-control-validated`, `report_sha256: 735955a2…`)

## Antigravity headless authentication on target — 2026-11-02

The `missing_gemini_api_key` failure is the expected pre-spawn fail-closed behavior; preparation used the loopback fake key and did not test provider auth.

1. **API Key Specifics and Forwarding Invariant**:
   - Provider credential forwarding is configured in `~/.codex/config.toml` (`mcp_servers.vibe-supervisor` sets `env_vars = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTIGRAVITY_API_KEY"]`).
   - Forwarding passes environment variables from Codex's process environment into the supervisor, but cannot supply a missing key when the parent process was started without it.
   - Root cause of connected MCP failure (Run `373546ce-2b8e-4e00-b606-6993193a8da6`): The Codex CLI host (`codex app-server`) was launched by `ChatGPT.app` prior to `launchctl setenv` execution. Its in-memory `process.env` lacked `GEMINI_API_KEY`, causing spawned supervisor instances to receive an empty key and fail at headless admission (`missing_gemini_api_key`).
   - Fix: Added `hydrateLaunchctlEnvironment` in `src/security/environment.ts` called at CLI/server launch in `src/cli.ts`. On macOS (`darwin`), when `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `ANTIGRAVITY_API_KEY`, or `MISTRAL_API_KEY` are unset or blank in `process.env`, the supervisor directly queries `/bin/launchctl getenv <key>` from the active user session and populates `process.env`. Existing non-blank variables are preserved, and non-Darwin platforms are skipped.
   - Test specifics: Added unit coverage in `tests/unit/child-environment.test.ts` asserting launchctl retrieval, variable preservation, non-Darwin bypass, and error tolerance with mock non-credential tokens. Unit tests in `tests/unit/antigravity-backend.test.ts` and `tests/unit/antigravity-headless-lifecycle.test.ts` test backend classes directly without triggering CLI launch hydration, preserving fail-closed test invariants for missing credentials.
   - Runtime candidate update: Synchronized compiled `dist/` into installed candidate `a4181ea8` (`~/.local/share/vibe-supervisor/2.2.1-agy-a4181ea8/node_modules/vibe-supervisor/dist/`) and terminated stale running supervisor server processes (PIDs 50681, 58845, 59534), ensuring fresh MCP instances hydrate credentials from `launchctl` without requiring a full desktop application restart.
   - Architectural invariant: credentials must never be placed in individual project repositories or workspaces. This prevents secret sprawl and leakage across Git history, diffs, patches, and worktrees, and respects the supervisor's child environment isolation model (where the supervisor injects the credentials from its own launch environment into ephemeral worker worktrees).

2. **Validation and Linking-Helper Task Findings**:
   - Evaluated the `_template` linking-helper task (`link-shared-skills.py`), preserving `_template`'s existing `.agents` configuration intact without modification.
   - Copy-only `validation prepare` on `_template` baseline (`d8b480b`) blocked at the fingerprinting stage: `.agents/skills/vault-query -> ../../../.agents/skills/vault-query` is an external/broken symlink outside the OKF directory structure. Fixed `validation prepare` to diagnose broken symlinks explicitly (`Broken symbolic link at ...`) instead of failing with raw `ENOENT`.
   - Supervisor readiness (`vibe_status`) on `<target-home>/src/OKF/_template` confirmed `VSUP_WORKSPACE_INVALID`: `_template` and ancestor `OKF` carry `.agents` and `AGENTS.md`, which violates the Antigravity backend extension isolation guard (`assertNoProjectAntigravityExtensions`).
   - In accordance with AGENTS.md policy stop rules, hosted dispatch stopped at the admission/policy failure without replaying unvalidated grants or weakening isolation checks.

## Linking-helper backend failures — 2026-11-02

[Consolidated problem report](research/evidence/linking-helper-backends-20261102/REPORT.md) records agy admission/authentication blockers, coordinator preparation mistakes, and the independently rejected Vibe patch. agy run `373546ce-2b8e-4e00-b606-6993193a8da6` failed before worker launch with `missing_gemini_api_key` despite command-shell credential presence; shell presence does not establish MCP-server authentication. The clean task snapshot passed admission while the original template remained protected. No agy implementation was produced.

Vibe3.0.4 on an unmodified, freshly installed `a4181ea8…` archive passed matched preparation, then run `da015524-9dda-45ff-8240-15b3ede6ff9e` changed the three requested files and failed after three denied shell calls. Independent reconstruction of the exact patch found a broken test import, incorrect project root, partial writes on a second-destination conflict and destination-parent symlink escape in the generated helper. This last failure was reproduced only in disposable coordinator fixtures, not as a supervisor workspace escape. Implementation rejected; no integration or fallback. Both runs closed, original template preserved, Vibe dirty worktree retained. See the report for exact identities and evidence limits.

**Correction to the installation note above:** copying the credential-hydration build into the old `a4181ea8` prefix changes its identity; the old archive/kit/preparation no longer qualifies those modified installed bytes. The hydration fix needs a fresh packaged candidate, matching preparation and a successful hosted test before claiming the agy authentication problem resolved. The unmodified archive used in the Vibe trial remains a separate identity. Neither backend has accepted the linking-helper task.
