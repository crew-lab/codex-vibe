# Current state — 2026-10-28

**Source and release.** v2.2.0 was published on 2026-10-27 from `cea6bed` as a pre-release through [crew-lab/codex-vibe#11](https://github.com/crew-lab/codex-vibe/pull/11); by decision D2 (2026-10-28) the owner marks it latest without the clean-account installation. `main` carries unreleased 2.2.1 work. Archive SHA-256 `6b0a120d1ae16bb102af4bc07bfa11522684f536a3a17fce3f9f93dc70d44984`, candidate `81df8140eb49afbebfb5202bc3186c97f9ea8b57a7243d108ce376cbdcc73b90`; the kit, SBOM, qualification report and run ledger are release assets. Beyond the 2.2.0 features (`allowed_write_paths`, per-field authorization diagnostics), the release carries `919fd3c` (`task authorize` binds the server's selected Node runtime) and `45dc907` (grant storage, prepared-input and private-directory repairs, and [the local operating procedure](docs/local-operation.md)). No functional source changed after qualification.

**Qualification.** Two native hosted trials on that archive, Node 24.21.0 on macOS arm64 with an isolated exact Vibe 3.0.2: Trial A, a one-file edit, accepted on its contract and ten independent numeric cases; Trial B, a review, accepted on three evidence-backed boundaries with all 274 project-file hashes unchanged. Both workers exited, private state was removed and the slot is free; Trial A's dirty worktree is retained with its verified export; both authorized starts are consumed, with no replay or fallback. Package verification on Node 20.19.0: 109 files, 1,567 tests. The [evidence](research/evidence/v2.2.0-local-workflow-20261027/README.md) does not certify general reliability, a clean account, the newer Vibe CLI on the target's PATH (3.0.3, separate from the supervised runtime) or Antigravity. The trials did not carry the nested `run_typescript` probe, so `nested-run-typescript-shape-and-gating` stays unverified.

**Operating.** Follow [the local operating procedure](docs/local-operation.md). Preserve the qualified installation, settings and rollback.

**What remains.**

The order, each step's outcome and the recommendation for every owner decision (D1–D6) are in the [development strategy's Direction](planning/development-strategy.md#direction--2026-10-28); this table is the status.

| # | Step | Who | State |
|---|---|---|---|
| 1 | Record the 2.2.0 build and its two trials in `docs/acceptance.json`; then simplify the ledger to one observed-list per build | Coordinator agent | Done 2026-10-28 (D1): the ledger is one entry per build, 2.2.0 first with seven gates observed from the committed evidence and the rest open with a reason each; `npm run acceptance` reports the new shape |
| 2 | Mark v2.2.0 latest. The owner has no spare standard macOS account (2026-10-17), so the clean-account gate is retired as a blocker; the target's fresh-prefix install and the offline smoke stand in | Owner | D2 accepted 2026-10-28; the owner marks the release latest |
| 3 | Ten real starts through Codex on real tasks, each logged with its export and `runs usefulness` entry; the log orders the later steps | Owner uses; target agent records | D3 accepted 2026-10-28 (an allowance of about ten); no start logged yet |
| 4 | Start friction: `vibe_status` returns the exact `task authorize` command for the connected server; the skill carries the sequence; a Codex custom agent wraps it. The single-use grant is unchanged | Coordinator agent | Done 2026-10-28 on `main` (`11a58dd`, unreleased): readiness returns `task_authorize` and a request template; the skill carries the sequence; `examples/codex/agents/vibe-reviewer.toml` wraps it |
| 5 | The nested `run_typescript` probe rides on the next hosted review and settles `nested-run-typescript-shape-and-gating` | Target agent | Inside step 3's allowance |
| 6 | Search context without a new boundary: the skill has Codex search first and pass the hits as `context_files`; measured on step 3's reviews | Coordinator agent | Done 2026-10-28 on `main` (`464211e`): the skill and the `vibe-reviewer` agent search first and pass at most 8 `context_files`; the measurement waits on step 3 |
| 7 | Review search sidecar ([design](planning/2.1-designs.md#5-search-tool-for-reviews), source-checked against Vibe 3.0.2): built only if step 5 shows nested calls deniable and step 6 did not close the quality gap; it changes three AGENTS.md lines | Coordinator agent; target agent runs its hosted gate | D4 decided 2026-10-28: not yet; decided again after steps 5 and 6 |
| 8 | Antigravity frozen at agy 1.4.9 (D5 accepted 2026-10-28; freeze note in ADR 0008 and security): `main` carries 1.4.7–1.4.9 and the opt-in, logged `[experimental] antigravity_skip_permissions` switch. The target's reported five-probe pass with the flag on is recorded as claimed, not recorded, until its evidence is committed, so the `antigravity-*` gates stay open. No new agy versions, flags or features; dropped in the next minor if unused | Target agent commits the evidence | Frozen; the evidence is still owed |
| 9 | Vibe cadence: stay on 3.0.2 and re-pin on a trigger only (a problem seen in step 3, a security fix, 3.0.2 uninstallable). The newer release on the target's PATH (3.0.3) renames the edit tool on the approval wire (2026-10-28 assessment under `research/`). Prepare the move with a per-version wire table; a re-pin's qualification is the preparation PASS plus one fixture review and one fixture edit | Coordinator agent | D6 accepted 2026-10-28; the per-version wire table is on `main` (`cd263ec`); the pin stays 3.0.2 until a trigger |
| 10 | Thin the documents: `planning/development-plan.md` to Git history, superseded briefs deleted from this file | Coordinator agent | Done 2026-10-28: the plan file points to the strategy, this file and Git history (`867ce3b`); this file keeps the current state, the other-machine commands, the open questions and the pointers; the 2.1 sketches other than the sidecar are reduced to their status |
| 11 | Release 2.2.1 as its own candidate once step 4 lands: preparation PASS, one review, one edit, pre-release | Target agent; owner publishes | Step 4 is on `main`; needs a hosted allowance of two |
| 12 | Persist the number of `context_files` per review in the run record and export, so step 3 measures step 6 without a hand log | Coordinator agent | Open; small |
| 13 | Public surface (marketing step 1, M1–M6 accepted 2026-10-28, see [marketing/strategy.md](marketing/strategy.md)): repository description and topics; the README opening is already current | Owner | Open |
| 14 | Mistral contact (marketing steps 2–3): the security re-check (2026-10-28, `research/vibe-3.0.2-security-recheck-2026-10-28.md`) found the workspace-roots candidate still holds (draft private note) and the `callbackKinds` crash still holds (draft public bug report); the sub-agent candidate is dropped. Add the bug reports on the missing protocol version and the unannounced edit-tool rename | Owner sends; agents only draft | Drafts ready; nothing sent |
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

**Only the target can answer.** The protocol questions that fail closed are listed in the [strategy's verification model](planning/development-strategy.md#verification-model), and the [procedure](docs/target-acceptance.md) records which way each goes. The 2.2.0 trials completed without a refusal on that build; two observations are still owed: `nested-run-typescript-shape-and-gating` (Direction step 5, on the next hosted review) and the five `antigravity-*` probe gates (step 8, evidence reported by the target and not yet committed). A new build reopens every observation.

**For the owner.** The private project name is in `main`'s history (commit `2e920d3`); the current tree uses `<site-project>`. The recommendation stands: leave history as it is unless the name is sensitive, because a rewrite of public `main` breaks every clone.

**Known limits of this state.** Linux and Windows code paths exist without a support claim; the validation helper blocks project manager configuration, local dependencies and required build scripts until a reviewed profile exists; the full list is under [documented limits](planning/development-strategy.md#where-things-stand).

## Evidence

The rules are in [AGENTS.md](AGENTS.md#recording-target-evidence) (the placeholders, the private-path grep, what never reaches a committed file) and its [code-fix rule](AGENTS.md#code-changes-on-the-target-machine); the two-machine principle is in the [strategy's working rules](planning/development-strategy.md#working-rules). Evidence names the exact source, archive and installed distribution it belongs to and never transfers to other bytes; missing evidence stays unverified; `docs/acceptance.json` is the per-build observed ledger.

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
