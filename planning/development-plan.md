# vibe-supervisor development plan

One plan for everything from here: publishing 2.0.0 from its frozen commit, releasing 2.0.1 from main, the 2.1 and 2.2 lines, the outreach that rides on them, and what never gets built. Written 2026-10-15 and revised the same day after the owner merged 2.0.1 ahead of the 2.0.0 release. Not shipped.

The reasons behind it are in the [development strategy](../docs/development-strategy.md); the live status is in the [Handoff](../Handoff.md); the evidence behind each choice is in [marketing/strategy.md](../marketing/strategy.md), [marketing/interest.md](../marketing/interest.md), [research/features-2026-10-14.md](../research/features-2026-10-14.md) and [research/antigravity-2026-10-14.md](../research/antigravity-2026-10-14.md). Two companions hold the long parts: the [2.0.0 release notes template](release-notes-2.0.0.md) and the [2.1 design sketches](2.1-designs.md).

## 1. Where we are

| Item | State |
|---|---|
| Main | `b7ac223`, pushed: version 2.0.1, the 2.0.1 cleanup merged on 2026-10-15 by the owner's decision ahead of the 2.0.0 release. No `docs/history/`, `docs/reviews/`, ADR 0003 or `v1-*` files; `tests/unit/no-legacy-references.test.ts` guards it. `verify:release` green on the merged tree (84 files, 1,270 tests) |
| 2.0.0 source | `0101f28691139307ee74e7b0295b7c622c336e41`, the commit before the merge: version 2.0.0, the 2.0 engine, the target brief under `docs/history/`. 2.0.0 is packaged and tagged from it and from nothing else. `verify:release` green on the same runtime tree (83 files, 1,244 tests) |
| Gates | `node-floor-20.19.0` passed locally; the nine target gates and the clean-account installation are open, in `docs/acceptance.json` on main |
| Target kit | `docs/target-acceptance.md` on main is the procedure; `scripts/v2-conformance-check.mjs` is identical at both commits; the disconnect and fixture scripts carry `v1-` names at `0101f28` and neutral names on main (section 3.2 maps them) |
| Packaging cache | `/Users/r.senchuk/.npm`, the default npm cache on the preparing machine; its `_cacache` is populated (about 1.3 GB). Not an owner input |
| Outreach | Drafts only: the dev.to article, the interest note's asks, the marketing calendar. Nothing posted |

## 2. The critical path and your touchpoints

| # | Step | Who | Your touchpoint |
|---|---|---|---|
| 1 | Package 2.0.0 from `0101f28`; record the archive identity on main | Coordinator | None |
| 2 | Carry the archive to the target | You | **Copy two files** |
| 3 | Run `docs/target-acceptance.md` on that archive; record the results on an evidence branch | Target agent | **Five authorizations, three hosted runs, name the evidence folder** |
| 4 | Clean-account installation of the same archive | You | **Do it, with the packet in 3.5** |
| 5 | Review and merge the evidence branch into main | Coordinator | Yes to the merge and `make push` |
| 6 | Repo readiness: rename, description, topics | Coordinator prepares | **Decide the rename; run two `gh` commands** |
| 7 | Publish v2.0.0 at `0101f28` as a draft, verify, then publish | Coordinator prepares | **Run `gh release create`, then `gh release edit`** |
| 8 | Package 2.0.1 from main; conformance check and readiness on the target; carry the hosted gates by decision | Coordinator, Target agent | **Two authorizations; the carry-over decision** |
| 9 | Publish v2.0.1 | Coordinator prepares | **Run the release commands** |
| 10 | Delete stale branches and worktrees; decide the plugin scaffold | You | **Run the deletions; pick a path** |
| 11 | 2.1 merges to main | Agents, Coordinator | Scope reading for Antigravity; the wheel download |

Nothing else blocks 2.0.0 stable. Steps 2 to 4 can overlap once step 1 is done; step 6 can happen any time before the first outreach post.

## 3. 2.0.0 to published

### 3.1 Package (coordinator, preparing machine)

Package in a detached worktree at the exact commit, under Node 20.19.0, with the default cache. The worktree keeps main's checkout untouched.

```bash
cd /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe
git worktree add --detach .claude/worktrees/package-2.0.0 0101f28691139307ee74e7b0295b7c622c336e41
```

```bash
cd /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/.claude/worktrees/package-2.0.0 && git rev-parse HEAD && node --version && npm --version && npm ci && VIBE_SUPERVISOR_TEST_NPM_CACHE=/Users/r.senchuk/.npm npm run package:rc; echo exit=$?
```

- **What it does:** `verify:release` (lint, typecheck, build, the 83-file suite, acceptance, secret scan, SBOM), then the offline installed-package smoke test, then `npm pack` with the cache. It never falls back to the network.
- **Where outputs land:** `.claude/worktrees/package-2.0.0/release/`: `vibe-supervisor-2.0.0.tgz`, `sbom.spdx.json`, `acceptance.json` (the packaging-time report, not `docs/acceptance.json`) and `SHA256SUMS` over those three. Copy them to the gitignored `release/2.0.0/` of the primary checkout, the same place earlier archives live, before the worktree is removed:

```bash
mkdir -p /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/release/2.0.0 && cp -p /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/.claude/worktrees/package-2.0.0/release/vibe-supervisor-2.0.0.tgz /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/.claude/worktrees/package-2.0.0/release/sbom.spdx.json /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/.claude/worktrees/package-2.0.0/release/acceptance.json /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/.claude/worktrees/package-2.0.0/release/SHA256SUMS /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/release/2.0.0/
```

- **Check and compute the SHA-256**, each a separate exit code:

```bash
cd /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/release/2.0.0 && shasum -a 256 -c SHA256SUMS; echo exit=$?
shasum -a 256 vibe-supervisor-2.0.0.tgz sbom.spdx.json acceptance.json SHA256SUMS
jq -e '[.deterministic_checks[] | select(.status != "PASS")] | length == 0' acceptance.json; echo exit=$?
jq -r .generated_at acceptance.json
tar -xOzf vibe-supervisor-2.0.0.tgz package/package.json | jq -r .version
tar -tzf vibe-supervisor-2.0.0.tgz | grep -E '^package/(docs/(history|reviews)|marketing|research|planning)/'; echo "exit=$? (1 means nothing leaked)"
```

- **The archive is built once.** Its bytes are not reproducible: `dist/sbom.spdx.json` ships inside it and carries a creation time and a random namespace (`scripts/sbom.mjs`). Every later step uses this file: the target installs it, the clean account installs it, the release attaches it. A rebuild anywhere is a different archive.
- **Record on main** (coordinator, one commit by path, then `make push` with your yes): in `docs/acceptance.json` a new top-level `released` array, and the packaging run as the node-floor evidence for this exact source. The top-level `frozen_archive_sha256` and `packaging_time_snapshot` stay for the file's `candidate`, 2.0.1, and are set in section 4.

```json
"released": [
  {
    "version": "2.0.0",
    "tag": "v2.0.0",
    "source_commit": "0101f28691139307ee74e7b0295b7c622c336e41",
    "archive": "vibe-supervisor-2.0.0.tgz",
    "archive_sha256": "<64 hex from shasum>",
    "packaging_report_sha256": "<64 hex of release/2.0.0/acceptance.json>",
    "packaging_report_generated_at": "<generated_at from that report>",
    "packaged_on": "preparing machine, macOS arm64, Node 20.19.0, npm 10.8.2",
    "verify_release": "<test files> test files, <tests> tests, from this run's output (expected 83 and 1244)",
    "published_at": null
  }
]
```

  The `node-floor-20.19.0` entry keeps its shape and gets a new `evidence` sentence: "2026-10-NN, preparing machine: `package:rc` at 0101f28 under exactly Node v20.19.0 and npm 10.8.2; verify:release passed (83 test files / 1244 tests), smoke test passed; archive sha256 <hex>." The Handoff's release identity gets the same SHA-256. Nothing reads `released` today (`scripts/acceptance.mjs` reads only `verified` and `unverified`), so the field cannot break the acceptance report.

### 3.2 Target run (target agent, target machine)

**Archive transfer (you).** Copy `vibe-supervisor-2.0.0.tgz` and `SHA256SUMS` from `release/2.0.0/` to the target by whatever private means you use, and tell the target agent the archive's SHA-256 from the Handoff.

**Two checkouts on the target.** The archive's source, for building the scripts and the official client SDK, and main, for the procedure and the evidence branch:

```sh
read -r REPO_DIR   # the target's existing clone of the repository
read -r SRC        # a new directory for the 0101f28 worktree
read -r EVIDENCE   # the evidence folder you name, outside every checkout
read -r ARCHIVE    # the copied vibe-supervisor-2.0.0.tgz
read -r EXPECTED   # the archive SHA-256 from the Handoff
read -r CONFIG     # the selected config.toml the procedure uses
git -C "$REPO_DIR" fetch origin && git -C "$REPO_DIR" worktree add --detach "$SRC" 0101f28691139307ee74e7b0295b7c622c336e41 && git -C "$SRC" rev-parse HEAD
test "$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)" = "$EXPECTED" && echo archive-match
```

**Step 1 as written, with one change.** In `$SRC`: `npm ci`, `npm run verify:release` (keep the output for the node-floor gate if it ran under exactly Node 20.19.0) and `VIBE_SUPERVISOR_TEST_NPM_CACHE="$(npm config get cache)" npm run package:rc`. Record that build's SHA-256 as "target rebuild, not installed": it differs from the frozen archive by the SBOM bytes. Step 2 installs `$ARCHIVE`, never the rebuild:

```sh
read -r PREFIX     # a new private prefix next to the current install
npm install --ignore-scripts --offline --prefix "$PREFIX" "$ARCHIVE" && "$PREFIX/node_modules/.bin/vibe-supervisor" --version
```

**The conformance check runs against the installed bytes**, so its evidence is about the frozen archive: `node "$SRC/scripts/v2-conformance-check.mjs" --config "$CONFIG" --dist "$PREFIX/node_modules/vibe-supervisor/dist" --observe-network --output "$EVIDENCE/conformance.json"`.

**Script names at `0101f28`.** The procedure on main uses the neutral names; the same scripts exist in `$SRC` under the old ones, differing only in their own names, one comment and the client version string they announce:

| Procedure on main | In `$SRC` |
|---|---|
| `scripts/fixture-verify.mjs` | `scripts/v1-fixture-verify.mjs` |
| `scripts/disconnect-client.mjs` | `scripts/v1-disconnect-client.mjs` (starts `v1-disconnect-observer.mjs` itself) |
| `tests/disconnect-client.test.mjs` | `tests/v1-disconnect-client.test.mjs` |
| The fixture's review and edit assignments | Cases 1 and 2 of `docs/history/reviews/rc28-target-test-2026-10-13/assignments.json` (12 turns, 180 s, base `c83c01e4c5987fbe0e18afcfcccfea2d0a3a3e00`); case 7's task is the disconnect task file |

**The sitting**, stopping at the first failure:

| Procedure step | Authorization | Gates |
|---|---|---|
| 1. Build in `$SRC`; record the rebuild's SHA-256 | 1 | `node-floor-20.19.0` (target half, if Node is exactly 20.19.0) |
| 2. Install `$ARCHIVE`; `setup --dry-run`; switch the Codex registration | 1 | — |
| 3. `pin-manifest`, review it, `doctor` | 2 | pin half of the conformance check |
| 4. Conformance check with `--observe-network` and `--dist` | 3 | `target-no-inference-conformance-check`, config half of `permission-ask-visible-in-effective-config`, setting half of `thinking-off-effect`, `experiments-fetch-off` |
| 5. Native readiness | 3 | `native-readiness-on-candidate` |
| 6. One review (probe, reasoning watcher) and one edit, verified with the fixture verifier | 4: two hosted runs | `hosted-review-edit-confirmation`, handler half of `permission-ask`, effect half of `thinking-off-effect`, `nested-run-typescript-shape-and-gating` |
| 7. One observed MCP-client disconnect | 5: one hosted run | `mcp-client-disconnect-hosted` |

The same sitting answers the nine open protocol questions in the Handoff; the agent writes each answer, with the observation behind it, into `$EVIDENCE/FINDINGS.md`. Placeholders from AGENTS.md ("Recording target evidence") apply to every file before it leaves the target. When the sitting ends, pass or stop, the agent writes a digest file into the folder:

```sh
cd "$EVIDENCE" && ! grep -rln '/Users/\|/home/' . && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 shasum -a 256 > SHA256SUMS && shasum -a 256 SHA256SUMS
```

If the `grep` lists a file, replace its paths with the placeholders first; a raw-byte file whose hash is recorded elsewhere keeps its bytes and is listed in `FINDINGS.md` with the reason, as AGENTS.md says. The last hash is the folder digest the gate entries cite. The raw evidence stays in that folder, outside the tree; you decide whether a redacted copy is ever published.

### 3.3 Recording the evidence (target agent, then coordinator)

**Branch.** `evidence/v2.0.0-target`, from main, in `$REPO_DIR`. It changes exactly two files, `docs/acceptance.json` and `docs/compatibility.md`, and is pushed with `make push-branch BRANCH=evidence/v2.0.0-target`. No code, no Handoff (the coordinator owns it).

**A verified gate**, modelled on the `node-floor-20.19.0` entry: `evidence_required` unchanged, `status` `VERIFIED`, `evidence` naming the files and their hashes instead of a tree path, and a one-line `result`:

```json
{
  "name": "target-no-inference-conformance-check",
  "status": "VERIFIED",
  "evidence_required": "<unchanged>",
  "evidence": "Owner's evidence folder v2.0.0-target-2026-10-NN, outside the tree, folder digest (sha256 of its SHA256SUMS) <64 hex>: conformance.json sha256 <64 hex>, vibe-pin-manifest.json sha256 <64 hex>, doctor.json sha256 <64 hex>, FINDINGS.md sha256 <64 hex>.",
  "result": "PASS 2026-10-NN on the target (macOS arm64, Node 20.19.0, Vibe 2.26.1), archive sha256 <first 16 hex>: exit 0; read-back totals 0 before and after thinking for review and edit; shutdown clean, reaper stopped; pin verify 3 runs, median <n> ms; findings: <none, or the warning kinds>."
}
```

**A gate that stays open** keeps `status` `UNVERIFIED` and gains a `result`: `"NOT EXERCISED 2026-10-NN: the model never attempted a write; not rerun."` or `"FINDING 2026-10-NN: reasoning count grew from 0 to 41 during the review; recorded, run completed."` The agent also sets `delivery_requirements.hosted_allowance_remaining` to what is left (0 after three runs) and `updated_at`.

**`compatibility.md`.** Each verified gate leaves the "Unverified gates" table for a "Verified gates" table with the same one-line result; open gates keep their row with the finding appended.

**Words the guard test refuses.** `docs/acceptance.json` and `docs/compatibility.md` are scanned by `tests/unit/no-legacy-references.test.ts`. A result line must not contain `docs/history`, `docs/reviews`, a `v1-` name (write "the fixture verifier", "the disconnect client"), `rc.` with a digit, `1.0.0`, `1.0.1`, `programmatic`, `legacy-harness`, `vibe -p` or any Vibe version other than 2.26.1. `2.0.0`, the commit hashes and dates are fine.

**Before pushing**, in a main checkout with `npm ci` done: `npm run build && npm run acceptance; echo exit=$?` and `npx vitest run tests/unit/no-legacy-references.test.ts tests/unit/docs-links.test.ts; echo exit=$?`.

**The coordinator's review**, in this order, each check by exit code:

1. Scope: `git diff --name-only main...origin/evidence/v2.0.0-target` lists only the two files.
2. Shape: `jq -e . docs/acceptance.json` parses; every moved gate has `status`, `evidence_required`, `evidence`, `result`; `evidence_required` is byte-equal to main's (`jq` both sides and `diff`).
3. Identity: the archive SHA-256 prefix in every hosted and readiness result matches `released[0].archive_sha256`; the server version in the readiness result is `2.0.0`.
4. Completeness: each moved gate meets its row in the procedure's last table; nothing is `VERIFIED` on a partial observation; the hosted run count matches the allowance used (no retries).
5. Evidence: you copy the evidence folder to the preparing machine, into the gitignored `release/2.0.0/evidence/`; `shasum -a 256 -c SHA256SUMS` passes in it; the folder digest matches the one in the entries; `grep -rn '/Users/\|/home/'` finds nothing; no readiness receipt value, credential or reasoning text appears (`npm run secret-scan` on the branch; a manual read of `FINDINGS.md`).
6. Findings: every warning kind and every answer in `FINDINGS.md` is either recorded in a result line or routed to section 3.4.
7. Checks: `npm run verify:release; echo exit=$?` on the merge result, then a cold review of the diff, then the merge and `make push` with your yes.
8. After the merge, the coordinator copies the nine answers into the Handoff's open questions and the observed wire facts into `compatibility.md` ("observed on the target, 2026-10-NN").

### 3.4 If the target finds something

Every row fails closed, so a finding costs a fix and a new sitting, never a silent pass. Paths are on main.

| Failure | Shows as | Fix: files and functions | Test to add | ADR | Decides |
|---|---|---|---|---|---|
| Read-back key missing, cased or nested differently | `readback_mismatch` with `details.fields` | Expectation in `src/backends/app-server/session-config.ts` `buildExpectation`; comparison in `src/backends/app-server/readback.ts` `compareReadback`; parse in `protocol.ts` `parseConfigEffectiveReadResult`. Check the same fact at its observed location | Observed shape in `tests/fixtures/fake-vibe-app-server.mjs` and a scenario; the old shape now fails in `tests/unit/app-server-readback.test.ts` | No; yes if a fact can no longer be read back and would be dropped | Coordinator; you approve the new sitting |
| Callback `relatedEntryId` only under `detail` | Every approval refused, `unlinked_callback` | `src/backends/app-server/protocol.ts` `callbackSchema` and the `callback/call` parser read `detail.relatedEntryId` when the top level is null; `approvals.ts` keeps `unlinked_callback` when both are absent | Both placements parse equal in `app-server-protocol.test.ts`; detail-only link approved, no link denied in `app-server-approvals.test.ts` | No | Coordinator |
| Approved effects lack `execute` / `ask` / `user` | First approved read fails `unapproved_effect` | `src/backends/app-server/events.ts`, the approval-metadata check in the effect validator: accept the observed triple only for an effect linked to the handler's own ledger record with equal fingerprint, tool and turn | Observed triple plus ledger link passes, without link fails, in `app-server-events.test.ts`; a scenario in `tests/fixtures/app-server-scenarios/` | Yes: it changes what the event validator counts as approved | Coordinator drafts; you approve |
| Unknown history entry kind | `unknown_entry_kind` naming the kind | `protocol.ts` `parseHistoryEntry` gains a case; `events.ts` ignores it only if its schema cannot carry a tool call or effect | A scenario with the kind in the history and in `history/entryAdded` | No if it cannot carry a call; yes if it can | Coordinator |
| Legitimate `write_file` over the 8 MiB frame cap | `VSUP_OUTPUT_LIMIT` (`line_too_long`) | Document the limit in `docs/reference.md`, or derive the line cap from `limits.max_event_bytes` (bounded above) in `src/backends/app-server.ts` (`MAX_LINE_BYTES`) and `jsonrpc.ts` | Frame at the new cap passes, one byte over fails, in `app-server-jsonrpc.test.ts` | No | You |
| Thinking stays on | The watcher count grows | Documentation only: `docs/security.md` and `docs/compatibility.md` say reasoning is generated and held in the throwaway store until close | None | No | You |
| Experiments request observed | `requests-observed` verdict | A 2.26.1 setting that stops it goes into `RUNTIME_SETTINGS` in `session-config.ts` (the read-back follows); if none exists, `docs/security.md` says so | Environment and expectation contain the setting in `app-server-session-config.test.ts` | No | Coordinator; you on documenting |
| Callback expires before 5 s | Callback error before the verdict | `DEFAULT_DECISION_DEADLINE_MS` in `src/backends/app-server/approvals.ts` below the observed expiry; AGENTS.md's "5-second deadline" wording follows | Deadline test at the new value; `approval-stall.json` scenario | No (shorter); the AGENTS.md line is your edit | Coordinator |
| `maxTurns` not enforced and `modelCalls` null | A review runs past its limit | `checkBudget` in `src/backends/app-server/usage.ts` and the start sequence in `src/backends/app-server.ts` fail closed when the first statistics carry no model-call count; if Vibe never reports one, every run fails, so the real fix counts model calls from history | `stats-usage.json` variant with null `modelCalls` | No | Coordinator |
| The real install fails the pin (`file-extra`, `file-unsafe`) | `doctor` or the conformance check refuses | Covered-directory rules in `src/backends/app-server/pin.ts`, only for files Vibe itself writes after install, named exactly | A fixture environment with that file in `app-server-pin.test.ts` | No if exact; yes if a directory is excluded | Coordinator; you approve |
| The worker group survives a disconnect | Observer shows a live owned process | `src/process/reaper.ts` and the cleanup path in `src/backends/app-server.ts` | `tests/integration/active-disconnect.test.ts` case reproducing it | No | Coordinator |

**What a code fix means on this path.** `0101f28` is fixed and main is 2.0.1, so a fix cannot become 2.0.0 without a second line. Two ways, your choice:
- **Recommended: skip 2.0.0, as 1.0.1 was skipped.** The fix lands on main; 2.0.1 becomes the first published 2.x release after a full sitting on its own archive (all nine gates, three hosted runs, the clean account). The release notes template carries over with the version changed and the 2.0.1 changelog entry added. Cost: one more sitting.
- **Keep 2.0.0:** a branch from `0101f28` with only the fix, packaged and tagged `v2.0.0` there, and the same fix merged into main. Cost: two copies of every fix, a tag that is not `0101f28`, and a second sitting anyway.

Rows decided as "document" do not block 2.0.0: the text lands on main, ships in 2.0.1, and the 2.0.0 release notes state the finding under the limits. Budget for one more sitting.

### 3.5 Clean account (you)

On a new standard macOS account on an Apple silicon Mac, with the archive copied into it. The packet records into one file in that account; read it, replace the account's home path with `<target-home>`, and keep it with the target evidence.

```sh
read -r ARCHIVE    # absolute path of vibe-supervisor-2.0.0.tgz in this account
read -r EXPECTED   # the archive SHA-256 from the Handoff
REC="$HOME/clean-account-2.0.0.txt"
{ date -u; sw_vers; uname -m; node --version; npm --version; git --version; } | tee "$REC"
test "$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)" = "$EXPECTED" && echo archive-match | tee -a "$REC"
PREFIX="$HOME/.local/vibe-supervisor-2.0.0"
npm install --ignore-scripts --prefix "$PREFIX" "$ARCHIVE" 2>&1 | tail -3 | tee -a "$REC"
VSUP="$PREFIX/node_modules/.bin/vibe-supervisor"
"$VSUP" --version | tee -a "$REC"
mkdir -p "$HOME/vsup-check" && git -C "$HOME/vsup-check" init -q && git -C "$HOME/vsup-check" -c user.name=check -c user.email=check@invalid commit -q --allow-empty -m base
CONFIG="$HOME/Library/Application Support/VibeSupervisor-oneshot/config.toml"
"$VSUP" allow --config "$CONFIG" "$HOME/vsup-check" 2>&1 | tee -a "$REC"
"$VSUP" pin-manifest --config "$CONFIG" 2>&1 | tee -a "$REC"
"$VSUP" doctor --config "$CONFIG" --json > "$HOME/doctor.json"; echo "doctor exit=$?" | tee -a "$REC"
"$VSUP" setup --workspace "$HOME/vsup-check" --config "$CONFIG" --codex user --dry-run 2>&1 | tee -a "$REC"
"$VSUP" setup --workspace "$HOME/vsup-check" --config "$CONFIG" --codex user --yes 2>&1 | tee -a "$REC"
```

- If Vibe 2.26.1 is installed in the account (`uv tool install mistral-vibe==2.26.1`, the README's first step), `pin-manifest` writes the manifest and `doctor` passes its pin check; if not, both fail with `VSUP_VIBE_NOT_FOUND`, which you record: the gate is about the supervisor's installation, not Vibe's.
- Open Codex in the account, confirm the five tools are listed and run one `vibe_status` readiness check on `~/vsup-check` (no run, no inference). Note `server_version` in the record.
- **Rollback:** restore the Codex configuration from the backup `setup --yes` printed (or delete the `[mcp_servers.vibe-supervisor]` block if the file was new), restart Codex, confirm the tools are gone. **Cleanup:** `rm -rf "$PREFIX" "$HOME/Library/Application Support/VibeSupervisor-oneshot" "$HOME/vsup-check"`, then delete the account.
- **The gate entry** (the coordinator writes it from your record):

```json
{
  "name": "clean-account-install",
  "status": "VERIFIED",
  "evidence_required": "<unchanged>",
  "evidence": "Owner's record clean-account-2.0.0.txt sha256 <64 hex>, kept with the target evidence.",
  "result": "PASS 2026-10-NN: new standard macOS <version> arm64 account, Node <version>; archive sha256 <first 16 hex> matched; installed into a private prefix with --ignore-scripts; --version 2.0.0; allow, pin-manifest and doctor <pass, or Vibe absent as recorded>; setup previewed then written with a backup; Codex listed five tools and readiness answered 2.0.0; rollback restored the backup; prefix, data root and account removed."
}
```

### 3.6 Repo readiness (you run, coordinator prepares)

- **Rename** (recommended before the first outreach post; GitHub redirects the old name and old clones keep working):

```bash
gh repo rename vibe-supervisor --repo crew-lab/codex-vibe --yes && git -C /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe remote set-url origin https://github.com/crew-lab/vibe-supervisor.git && git -C /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe remote -v
```

- **Description and nine topics**, from the outreach draft (commit `d360f28`, `docs/history/outreach-drafts.md`, section 2):

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) && gh repo edit "$REPO" --description "Local MCP server that lets Codex delegate one bounded review or one isolated edit to Mistral Vibe 2.26.1. Edits run in a detached Git worktree and return a patch that is never applied. Shell and network tools are off. macOS Apple silicon only. Application policy, not an OS sandbox." --add-topic mcp --add-topic mcp-server --add-topic model-context-protocol --add-topic codex --add-topic mistral --add-topic mistral-vibe --add-topic code-review --add-topic git-worktree --add-topic coding-agents
```

- **README top section** (coordinator, on main, so it ships in 2.0.1): the limits in the first paragraph, the independence line ("an independent project, not affiliated with Mistral AI or OpenAI"), the install steps from the release notes, and "verified on the target" only for gates that are `VERIFIED`. A social preview concept goes into `marketing/` as text; you upload any image.

### 3.7 Release (coordinator prepares, you publish)

**Release notes.** The coordinator copies [the template](release-notes-2.0.0.md) to `release/2.0.0/release-notes.md` (outside the tree), fills every `[FILL]` from the merged `docs/acceptance.json` and the evidence, and deletes the template's instructions block. Nothing else in the template changes without a reason recorded in the Handoff.

**Two more assets**, after the evidence branch is merged:

```bash
cd /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe && jq --arg sha "$(shasum -a 256 release/2.0.0/vibe-supervisor-2.0.0.tgz | cut -d' ' -f1)" --arg evidence_commit "$(git rev-parse origin/main)" '{schema_version: 1, version: "2.0.0", tag: "v2.0.0", source_commit: "0101f28691139307ee74e7b0295b7c622c336e41", archive_sha256: $sha, evidence_record: ("docs/acceptance.json at " + $evidence_commit), verified: [.verified[] | {name, status, result}], open: [.unverified[] | {name, status, result}], hosted_allowance_remaining: .delivery_requirements.hosted_allowance_remaining, packaging_report_note: "The acceptance.json asset is the packaging-time report; this file records the later target results for the same archive, which was not rebuilt."}' docs/acceptance.json > release/2.0.0/release-evidence.json; echo exit=$?
```

```bash
cd /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/release/2.0.0 && shasum -a 256 vibe-supervisor-2.0.0.tgz sbom.spdx.json acceptance.json SHA256SUMS release-evidence.json | jq -R -s '{tag: "v2.0.0", algorithm: "sha256", assets: (split("\n") | map(select(length > 0) | capture("^(?<sha256>[0-9a-f]{64})  (?<name>.+)$")))}' > asset-checksums.json; echo exit=$?
```

`SHA256SUMS` stays exactly as `package:rc` wrote it; `asset-checksums.json` covers the later files. These are the six assets 1.0.0 shipped.

**Publish (you).** A draft first, so the assets can be checked before anything is public. The target commit must be on main's history, and is:

```bash
cd /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe && git fetch origin && git merge-base --is-ancestor 0101f28691139307ee74e7b0295b7c622c336e41 origin/main && echo on-main
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) && REL=/Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/release/2.0.0 && gh release create v2.0.0 --repo "$REPO" --draft --target 0101f28691139307ee74e7b0295b7c622c336e41 --title "vibe-supervisor 2.0.0" --notes-file "$REL/release-notes.md" "$REL/vibe-supervisor-2.0.0.tgz" "$REL/sbom.spdx.json" "$REL/acceptance.json" "$REL/SHA256SUMS" "$REL/release-evidence.json" "$REL/asset-checksums.json"
gh release view v2.0.0 --repo "$REPO" --json isDraft,assets --jq '.isDraft, (.assets[] | "\(.digest)  \(.name)")'
```

Compare the printed digests with `asset-checksums.json`; then publish. GitHub creates the lightweight tag `v2.0.0` at `0101f28` on publish, the same kind of tag as `v1.0.0`:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) && gh release edit v2.0.0 --repo "$REPO" --draft=false --latest
```

**After publishing** (coordinator or you):

```bash
cd /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe && git fetch origin --tags && test "$(git rev-parse v2.0.0^{commit})" = 0101f28691139307ee74e7b0295b7c622c336e41 && echo tag-ok
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) && CHECK=$(mktemp -d) && gh release download v2.0.0 --repo "$REPO" --dir "$CHECK" && cd "$CHECK" && shasum -a 256 -c SHA256SUMS && test "$(shasum -a 256 vibe-supervisor-2.0.0.tgz | cut -d' ' -f1)" = "$(jq -r '.released[] | select(.version == "2.0.0") | .archive_sha256' /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/docs/acceptance.json)" && echo archive-matches-record
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) && gh release view v2.0.0 --repo "$REPO" --json isDraft,isPrerelease,targetCommitish,publishedAt,url
```

Then on main (coordinator, by path, `make push` with your yes): `released[0].published_at` set, the Handoff's release identity says "published", and the 2.0.0 changelog line "The GitHub release follows the target-machine acceptance" becomes the date and the link. Existing releases are never replaced or retagged; a wrong asset means a new patch release, not an edit of the old one.

## 4. 2.0.1: merged ahead of 2.0.0

### 4.1 What happened

- **The merge.** `claude/v2.0.1-cleanup` (`b76eda7`, branched from `4ade3fc`) was merged into main as `b7ac223` and pushed. `git merge-tree --write-tree --name-only 0101f28 claude/v2.0.1-cleanup` gave the conflict set: `Handoff.md` (two hunks: the release identity and the pointers paragraph) and `docs/development-strategy.md` (one hunk: the 2.0.0 paragraph). Both were resolved to the cleanup's text, with the pointer to `planning/development-plan.md` in place of the removed implementation plan, and the Handoff identity rewritten to "2.0.1 on main, merged ahead of the 2.0.0 release; 2.0.0 is packaged and tagged from `0101f28`". `planning/v2-implementation-plan.md`, deleted on main and untouched on the branch, merged as a deletion without conflict. `verify:release` green on the merged tree.
- **What 2.0.1 contains.** The 2.0.0 runtime with a comment change and one removed special case (saved records with an unknown engine are skipped by the general rule); the history and every other version out of the tree; `docs/target-acceptance.md`; `marketing/sources.md` with the article's story facts citing commit `d360f28`; neutral script names; the guard test.
- **What the guard test expects.** `tests/unit/no-legacy-references.test.ts` scans `src`, `tests`, `scripts`, `skills`, `examples`, `schemas` and `docs` (`docs/acceptance.json` included) and the root `README.md`, `SECURITY.md`, `CHANGELOG.md`, `AGENTS.md` and `Handoff.md`; `planning/`, `marketing/` and `research/` are not scanned, so this plan may name history paths. Three exceptions are listed in the test with their reasons (Vibe's `programmatic` wire value and two Vibe source paths). In `CHANGELOG.md` it checks from the first `## 2.0.0` or `## 2.0.1` heading down, so a `## 2.1.0` entry written above them would not be scanned: the 2.1 docs wave changes that rule to start at the first `## ` heading.
- **Evidence format.** There is no `docs/reviews/` any more. 2.0.0's evidence goes into `docs/acceptance.json` as one-line results with file hashes (section 3.3), and the raw files stay in the folder you name. The `v2.0.0` tag keeps the brief and the old evidence reachable for anyone who needs them.

### 4.2 Why this order, and what it costs

- **For it:** main is final sooner, so 2.1 branches start from the tree that ships; the target follows the reusable procedure instead of a one-off brief; every document already speaks of one version, so the 2.0.0 evidence lands in its final place once.
- **Against it:** the 2.0.0 sitting runs from a commit that is not main, so the target needs two checkouts and a script name map; a code defect found by the target cannot become 2.0.0 without a second line (section 3.4); main's `docs/acceptance.json` carries a 2.0.0 record while its `candidate` is 2.0.1, so the `released` array has to keep the two apart; and 2.0.1 needs its own short sitting after 2.0.0 is published.

### 4.3 Stale lines on main (coordinator, one commit before packaging 2.0.1)

- `CHANGELOG.md`, 2.0.1 entry: "Unreleased. The version is set on branch `claude/v2.0.1-cleanup`" becomes "Unreleased; on main since 2026-10-15."
- `Handoff.md`, Remaining: step 1 (cold review and merge) is done; step 2 drops "owner gives the cache path" for the fixed cache; packaging names `0101f28` and `release/2.0.0/`.
- `docs/acceptance.json`, `native-readiness-on-candidate`: "server_version 2.0.0" becomes "the candidate's version", so the same entry takes the 2.0.1 observation.
- `docs/development-strategy.md`: keeps "the default npm cache is the populated offline cache it needs"; nothing else stale found.

### 4.4 Releasing 2.0.1 (after v2.0.0 is published)

1. **Package** from main after the evidence merge and the stale-line commit, exactly as 3.1 with `2.0.1` in place of `2.0.0` and the main commit in place of `0101f28` (worktree `.claude/worktrees/package-2.0.1`, outputs copied to `release/2.0.1/`). Record the top-level fields of `docs/acceptance.json`, which belong to the `candidate`:

```json
"frozen_archive_sha256": "<64 hex>",
"packaging_time_snapshot": {
  "version": "2.0.1",
  "source_commit": "<40 hex>",
  "report_sha256": "<64 hex of release/2.0.1/acceptance.json>",
  "generated_at": "<generated_at from that report>",
  "node": "20.19.0",
  "npm": "10.8.2"
}
```

2. **Target, two authorizations:** 1 (install the 2.0.1 archive next to 2.0.0 and switch the registration) and 3 (the conformance check, `--observe-network` not needed again unless you want it). The pin manifest from the 2.0.0 sitting is reused: it pins Vibe, not the supervisor, so `doctor` passing is enough and authorization 2 is not spent. Readiness reports `server_version` `2.0.1`. No hosted run.
3. **Your decision on the hosted gates.** Recorded on each hosted gate as a `decision` field: `"Observed on 2.0.0 (archive sha256 <first 16 hex>); applies to 2.0.1 by owner decision 2026-10-NN: the runtime source differs by one comment and the removal of a saved-record special case (git diff 0101f28 <2.0.1 commit> -- src)."` The conformance and readiness results gain a second sentence for 2.0.1. `clean-account-install` carries over the same way, since installation did not change.
4. **Publish** exactly as 3.7 with `2.0.1`, the release notes being the 2.0.1 changelog entry plus "everything in 2.0.0 applies" and a link to the v2.0.0 release. The tag is `v2.0.1` at the packaged main commit; `--latest` moves to it.

### 4.5 Branches and worktrees (you, after v2.0.1 is published)

From the primary checkout. Merged remote branches go in one pass; each is checked as an ancestor of main first:

```bash
cd /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe && git fetch --prune origin && REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) && for b in claude/app-server-design claude/development-plan claude/v1.0.0-bump claude/v1.0.1-docs claude/v1.0.1-rc.2 claude/v1.0.1-unblock claude/v2.0.1-cleanup codex/connection-readiness-handoff codex/devto-development-article codex/lifecycle-triage codex/preparation-diagnostics codex/rc21-multichat-hotfix codex/rc23-reconnect-hotfix codex/rc7-testing-fixes codex/rc8-stall-diagnostics codex/turn-limit-diagnostics codex/v1-release-confirmation codex/v1-stable-strategy; do git merge-base --is-ancestor "origin/$b" origin/main && gh api -X DELETE "repos/$REPO/git/refs/heads/$b" && echo "deleted $b"; done
```

Unmerged remote branches: read what each holds, then delete. `claude/v1.0.0` is two documentation commits past the `v1.0.0` tag (`90ded78`); the tag keeps the release:

```bash
cd /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe && for b in claude/session-pruning claude/v1.0.0 codex/project-agents-isolation codex/rc1-runtime-consolidation codex/rc28-target-evidence codex/skill-cleanup-update; do echo "== $b"; git log --oneline origin/main..origin/$b | head -5; done
```

```bash
cd /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe && REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) && for b in claude/session-pruning claude/v1.0.0 codex/project-agents-isolation codex/rc1-runtime-consolidation codex/rc28-target-evidence codex/skill-cleanup-update; do gh api -X DELETE "repos/$REPO/git/refs/heads/$b" && echo "deleted $b"; done
```

Worktrees and local branches. Each removal stands alone, so one refusal does not stop the rest; a dirty worktree refuses removal, and you read it before forcing anything. `git branch -d` deletes only branches merged into the current one:

```bash
cd /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe && for w in v2-0-1 v1-0-0 package-2.0.0 package-2.0.1 project-review-a90ec4; do git worktree remove ".claude/worktrees/$w" && echo "removed $w"; done; git worktree prune && git worktree list
```

```bash
cd /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe && git switch main && for b in claude/app-server-design claude/development-plan claude/development-plan-detail claude/next claude/phase-d-prep claude/v1.0.0-bump claude/v1.0.1-docs claude/v1.0.1-rc.2 claude/v1.0.1-unblock claude/v2.0.1 claude/v2.0.1-cleanup; do git branch -d "$b"; done
```

```bash
cd /Users/r.senchuk/src/github.com/whitebithq/cdx-vibe && git branch -D claude/session-pruning claude/v1.0.0
```

**Kept:** `main`; `codex/unified-harness-v2` until 2.1 has ported the shipped manifest and the search sidecar (items 5 and 7), then deleted the same way; the local `claude/ci-checks`, `claude/ci-node-floor` and `claude/release-workflow`, which wait for the push token's `workflow` scope.

### 4.6 The plugin scaffold: your call

`.codex-plugin/plugin.json` (legacy layout, version in lockstep with `package.json`) and `.mcp.json` (a disabled `node ./dist/cli.js serve --stdio --isolated` entry) are outside the npm package, so neither path changes an archive.

- **Delete now, rebuild in 2.2 (recommended).** One commit on main before 2.0.1 is packaged: delete both files; in `tests/unit/version.test.ts` drop the case "keeps the plugin manifest literal equal to package.json"; in `tests/integration/lazy-startup-retention.test.ts` drop the two `.mcp.json` lines and " and matches .mcp.json" from the test name (the timeouts stay asserted against the written Codex entry); the scaffold sentence in `docs/compatibility.md` and the Handoff's known limits go; the 2.0.1 changelog entry gains "The unverified Codex plugin scaffold is removed; Codex plugin packaging returns in 2.2 in the current layout." 2.2 builds the root `plugin.json` with `extensions.com.openai` and the `.agents/plugins/marketplace.json` the interest note describes, with an install gate on the target.
- **Keep.** Nothing changes now; `version.test.ts` keeps the version in step at every bump; the documents keep calling it an unverified scaffold; 2.2 migrates it instead of creating it. Cost: a file in a fallback layout that no one has installed, shown in the repository root during the outreach weeks.

## 5. 2.1: observable and measurable

Ranked by demand evidence, fit with the boundaries and effort in the features research. Every item gets a fixture test; items that touch a run get one hosted observation. The design of each, with data shapes, files, tests, gate entries, size and dependencies, is in the [2.1 design sketches](2.1-designs.md). Work starts on branches now; nothing merges to main until v2.0.1 is tagged, so 2.0.1 stays what was tested.

| # | Item | Size | Gate | ADR |
|---|---|---|---|---|
| 1 | Usage, ceilings and tool-call counts saved in every run record; `runs list` covers isolated sessions | S | Fixture + the 2.1 hosted review | No |
| 2 | `accepted` and `reason` on `vibe_close`; `runs usefulness` prints the log row | S | Fixture + the 2.1 hosted close | No |
| 3 | `excluded_globs` per allowed root, merged into the profile denylist, the handler and the listing, read back | S | Fixture + the 2.1 hosted review | No |
| 4 | Findings for reviews: `output: "findings"`, `findings.json`, `runs sarif` | M | Fixture + the 2.1 hosted review | No |
| 5 | Search sidecar for reviews | L | Fixture + its own hosted review; the 2.0.0 nested-gating evidence first | Yes (0005) |
| 6 | `runs export` audit bundles, with the approval ledger saved per run | S–M | Fixture + one exported hosted run | No |
| 7 | Vibe candidate script and the wheel-derived shipped manifest | M | Your yes to the wheel download; conformance check on the target | No |
| 8 | Antigravity as a verified MCP client: docs, client-neutral skill wording, four gates | S docs + target | Your scope reading; an account on the target; three hosted runs | No |
| 9 | Per-language task templates in the skill | S | Review | No |

Order: wave 0 (contracts) first, then 1, 2, 3, 4, 6 and 7 in parallel, the backend wiring, then 5 and 8 after the 2.0.0 evidence. One 2.1 target sitting covers 1 to 4 and 6 with one review and one edit; 5 and 8 add their own runs. Section 9 has the graph and the waves.

## 6. 2.2: wider, still one path

- `allowed_write_paths` on edits: the handler denies writes outside the declared list and the run continues (features candidate 3).
- A per-root cost ledger (`budgets.<root>.max_cost_usd_per_day`) surfaced as a readiness blocker, built on item 1's records.
- Linux, claimed only after a Linux pin manifest, conformance check, one review, one edit and one disconnect are recorded.
- MCPB bundle and registry entry; the Codex plugin in its current layout (section 4.6).
- A `runs` watch view over item 1's numbers.

## 7. Later and never

**Later, each behind its own trigger:** fixes from target evidence; the next Vibe release as a new candidate (revalidate wire facts, new manifest, conformance, one review, one edit; item 7's script does the first pass; if the cadence becomes unaffordable, the pin policy is revisited openly, never relaxed silently); MCP Tasks when a client declares it; size-capped inline images; a single repair turn and `turn/steer`, each only through an ADR; a CI mode after Linux and an ADR; Antigravity as a worker only if Google documents ACP permission semantics, per-process configuration isolation, checksummed binaries, API-key authentication and a permissions read-back; byte-reproducible archives (the SBOM's creation time and namespace are the first thing to fix); the local CI branches once the `workflow` scope exists.

**Never**, each rejected by a line in AGENTS.md rather than by lack of demand: resume, replay or queueing; interactive or elicitation-based approvals; more than one active run per instance; shell-based search; a worker other than Vibe; automatic patch application; a Vibe version range.

## 8. Outreach, tied to the releases

You send everything personally; agents only draft.

| When | Action | Who |
|---|---|---|
| Now | Rename decision; description and topics (section 3.6) | You |
| Now | Rewrite the Mistral Discussion for 2.0; draft three Bug Reports; write the private note for Mistral security; protocol feedback note; one-page brief; rewrite the Multica comment (it still describes the removed launcher), draft the Paperclip comment. Story facts come from `marketing/sources.md` on main, which cites commits now that the history is out of the tree | Agents draft |
| Now | Send the private note to Mistral security; wait for a reply or two weeks | You |
| 2.0.0 published | Publish the article (apply its `[UPDATE AT PUBLISH]` list from the merged `docs/acceptance.json`; pick dev.to's AI-assisted label); post the Discussion and Bug Reports with the hosted results; Show and tell; Multica and Paperclip comments | You |
| 2.0.0 + 1 week | Show HN with the article link; Reddit and LinkedIn | You |
| 2.0.0 installable | Apply to the Codex open source fund | You |
| 2.0.1 published | MCPB bundle and registry entry, awesome-list PR (agents build; you publish as org Owner) | Agents, you |
| 2.1 | Antigravity forum reply with the gate evidence; the reviewdog channel once SARIF ships; the usefulness rate published monthly from `runs usefulness` | You |
| After 2.0.1 | Ambassador application, with the advocacy record | You |
| Monthly | Blog series pieces; CFP submissions | Agents draft, you publish |

The marketing calendar's weeks 3 to 4 ("2.0.1 work; history leaves the tree") are already done; its registry work (weeks 5 and 6) can start as soon as 2.0.1 is published. The independence line ("an independent project, not affiliated with Mistral AI or OpenAI") goes in every public asset. Security claims always carry "application policy, not an OS sandbox".

## 9. How the work runs

### 9.1 Rules

- **Coordinator only:** merges, commits, pushes, packaging, tags, Handoff changes, the registration lines in shared files named below.
- **Agents:** named files, disjoint ownership, never stage or move files in Git, never write outside their worktree. Implementation agents use the model AGENTS.md names where it is available; where it is not, the report says so rather than claiming it.
- **Checks gate on exit codes:** `cmd; echo exit=$?` or `&&`, never a `grep` of test output, which hides failures.
- **Fakes:** no credential that matches `/\bsk-[A-Za-z0-9_-]{24,}\b/`.
- **Files:** written with the Write tool, never with stdin heredocs; no aliased `ls`.
- **After each agent:** check for its leftover processes; forward any fact one agent finds that another needs.
- **Long agents:** write a usable first version early, so an interruption leaves something.
- **Vibe:** never run on the preparing machine; behaviour is proven only on the target.
- **Owner values:** a command that needs one uses `read -r NAME` (or `read -rs` for a secret) and then `$NAME`, never a placeholder to edit.

### 9.2 Dependency graph

| ID | Work item | Needs | Who |
|---|---|---|---|
| R1 | Package 2.0.0 from `0101f28`; record `released[0]` | — | Coordinator |
| R2 | Archive to the target | R1 | You |
| R3 | 2.0.0 target sitting | R2, five authorizations | Target agent |
| R4 | Clean-account installation | R1 | You |
| R5 | Evidence branch reviewed and merged | R3, R4 | Coordinator |
| R6 | Rename, description, topics; then the README top section | — | You; Coordinator for the README |
| R7 | Release notes filled; `release-evidence.json`, `asset-checksums.json` | R5 | Coordinator |
| R8 | v2.0.0 published | R7, your yes | You |
| R9 | Stale lines on main; plugin path if "delete" | — | Coordinator |
| R10 | Package 2.0.1 from main, after the publish date is on main | R5, R8, R9 | Coordinator |
| R11 | 2.0.1 conformance and readiness; carry-over decision | R10, two authorizations | Target agent, You |
| R12 | v2.0.1 published | R8, R11 | You |
| R13 | Branch and worktree deletions | R12 | You |
| D1 | Outreach drafts | — | Agents |
| D2 | Article markers filled | R5 | Agent |
| P0 | 2.1 wave 0: contracts | — (merges after R12) | Agent |
| P1 | Items 1, 2, 3, 4, 6, 7 modules | P0 | Agents |
| P2 | Backend wiring | P1 | Agent |
| P3 | 2.1 docs and gate entries | P2 | Agent |
| P4 | ADR 0005 and the search sidecar | R5 (nested-gating evidence), P2 | Agents |
| P5 | Antigravity docs and skill wording | Your scope reading | Agent |
| P6 | 2.1 package and target sitting | P3 (P4, P5 if they ship) | Coordinator, Target agent |
| P7 | Delete `codex/unified-harness-v2` | P4, item 7 merged | You |

### 9.3 Agent waves and file ownership

**Release work** runs mostly by people and one target agent; the only parallel agent work beside it is D1 (`marketing/` drafts, one agent per document) and R6's README section (one agent owning `README.md`).

**2.1, contract first.** Shared files are touched in one wave by one owner; later waves only read them.

| Wave | Agent | Owns (creates or edits only these) |
|---|---|---|
| 0 | Contracts | `src/contracts.ts`, `src/core/serialization.ts`, `src/core/run-manager.ts`, `src/mcp/schemas.ts`, `src/mcp/tools.ts`, `src/cli.ts`, new `src/cli/runs.ts`, `schemas/run.schema.json`, `schemas/result.schema.json`, new `schemas/findings.schema.json`, new `schemas/audit-bundle.schema.json`, new stub `src/core/findings.ts`; tests `tests/unit/tool-schemas.test.ts`, `tests/unit/cli.test.ts`, new `tests/unit/run-record-fields.test.ts`, new `tests/integration/close-acceptance.test.ts` |
| 1 | Usage (item 1) | `src/backends/app-server/usage.ts`, `src/backends/app-server.ts`; tests `tests/unit/app-server-usage.test.ts`, new `tests/integration/usage-record.test.ts`, new scenario `tests/fixtures/app-server-scenarios/usage-tool-counts.json` |
| 1 | Exclusions (item 3) | `src/config/validation.ts`, `src/config/config.ts`, `src/config/policy.ts`, `src/backends/app-server/session-config.ts`, `src/backends/app-server/approvals.ts`, `src/backends/app-server/workspace-listing.ts`, `schemas/config.schema.json`, `examples/config.toml`, `scripts/v2-conformance-check.mjs`; tests `tests/unit/config.test.ts`, `tests/unit/app-server-session-config.test.ts`, `tests/unit/app-server-approvals.test.ts`, `tests/unit/app-server-workspace-listing.test.ts`, `tests/unit/policy-readiness.test.ts` |
| 1 | Findings (item 4) | `src/core/findings.ts` (replacing the stub), new `src/cli/runs/sarif.ts`; new `tests/unit/findings.test.ts`, new `tests/unit/sarif.test.ts` |
| 1 | Usefulness and export (items 2 and 6, CLI side) | new `src/cli/runs/usefulness.ts`, new `src/cli/runs/export.ts`; new `tests/unit/runs-usefulness.test.ts`, new `tests/unit/runs-export.test.ts` |
| 1 | Candidate tooling (item 7) | new `scripts/vibe-candidate.mjs`, `src/backends/app-server/pin.ts`, new generated `src/backends/app-server/shipped-manifest.ts`, `src/cli/pin.ts`, `scripts/README.md`; tests `tests/unit/app-server-pin.test.ts`, new `tests/unit/vibe-candidate.test.ts` |
| 1 | Templates (item 9) | `skills/vibe-supervisor/SKILL.md` |
| 2 | Backend wiring | `src/backends/app-server.ts` (exclusions passed to the session configuration, handler and listing; the findings contract in the prompt; the ledger handed over at settle); new scenarios for each; `tests/integration/app-server-backend.test.ts` |
| 3 | Docs | `docs/reference.md`, `docs/functionality.md`, `docs/security.md`, `docs/compatibility.md`, `docs/acceptance.json`, `README.md`, `CHANGELOG.md`, `tests/unit/no-legacy-references.test.ts` (the changelog rule, section 4.1); `npm run docs:errors` if a remedy changed |
| 4 | Sidecar (item 5) | new `docs/adr/0005-review-search-sidecar.md`, new `src/backends/app-server/search.ts`, `search-server.ts`, `path-policy.ts`; then `session-config.ts`, `readback.ts`, `approvals.ts`, `events.ts` (all free again after wave 2) |
| any | Antigravity (item 8) | `docs/reference.md` section "Other MCP clients" (coordinated with wave 3 by sequencing: wave 3 first), `skills/vibe-supervisor/SKILL.md` after wave 1's templates |

The coordinator adds one line per subcommand to `src/cli/runs.ts`'s table when merging waves 1 and 2, and resolves the version bump to 2.1.0 last. Each wave ends with the coordinator's `npm run verify:release` on the merged result and a cold review before the next wave starts.

## 10. Risks and measures

**Risks:**
- **A wire fact we guessed wrong:** every one fails closed, so the cost is a fix and a new sitting; on this path a code fix most likely means skipping 2.0.0 (section 3.4).
- **The frozen archive is lost or rebuilt:** its bytes cannot be reproduced; keep `release/2.0.0/` until v2.0.0 is published and verified, and never rebuild to "refresh" it.
- **Two version lines in one record:** main's `docs/acceptance.json` describes 2.0.1 while recording 2.0.0's results; the `released` array and the archive hash in every result line keep them apart, and the coordinator's review checks the hash.
- **Mistral changes or removes `vibe-app-server`:** each release pins one Vibe version, and a later Vibe release is a new candidate.
- **The hosted allowance runs out:** stop at the first failure and never retry.
- **The guard test rejects an evidence line:** it fails `verify:release` before the merge, never after; the forbidden words are listed in section 3.3.
- **Antigravity churn and terms:** client only, verified per version, never "supported".

**Done means:**
- 2.0.0: zero `UNVERIFIED` gates or each remaining one accepted by you with its finding in the release notes, and one archive SHA-256 matching across the packaging record, the target, the clean account and the release assets.
- 2.0.1: the guard test passes, no link is broken, its conformance and readiness are recorded, and the carry-over decision is on every hosted gate.
- Every release: `verify:release` is green on Node 20.19.0.
- 2.1 and later: each item has its fixture test and, where it touches a run, one hosted observation.
