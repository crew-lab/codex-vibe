# Clean-account acceptance packet: 1.0.1-rc.1

Prepared 14 October 2026. This packet has not been tested in a fresh macOS account. A rehearsal in the existing account does not satisfy that gate. The owner chose to perform the account test later.

## Identity and contents

Frozen archive SHA256: `2442e35579d30dbc9b28bab4abaddfbb0a7c1e782055ba83cc4187ca24946b98`.

The packet contains only the archive, a pinned npm installation manifest/lock, package-file hashes, a two-file Git fixture bundle, a local installation verifier and this checklist. It includes no credentials, provider traffic, runtime state, cache or user configuration. Preserve the archive; do not rebuild it as the same candidate.

## Human-operated preparation

1. Create or sign in to a separate standard macOS account yourself. Do not copy the original account's credentials, keychain, Codex configuration, Vibe settings, trust records or private caches. Install prerequisites independently: Node 24.21.0, Git, uv, and exactly `mistral-vibe==2.26.1` using `uv tool install mistral-vibe==2.26.1`. Confirm macOS Apple silicon and record actual versions. Provider authentication, if later needed, is performed by you in that account; keep credentials out of reports.
2. Transfer and unpack this packet into that account. Verify the transfer bundle checksum against the separately recorded delivery receipt, then run `shasum -a 256 -c SHA256SUMS` from the packet directory. Stop if any checksum differs.
3. Set the following paths to your account's locations. Use a new test directory. None of these variables replaces HOME or CODEX_HOME.

```sh
VSUP_KIT="$HOME/Downloads/rc1-fresh-account-kit"
VSUP_TEST_ROOT="$HOME/.local/share/vsup-clean-account-rc1"
VSUP_CACHE="$VSUP_TEST_ROOT/npm-cache"
mkdir -m 700 -p "$VSUP_TEST_ROOT"
cp -R "$VSUP_KIT" "$VSUP_TEST_ROOT/warm"
```

4. Populate a new dedicated cache from the public npm registry, using the supplied exact lock and disabled package scripts. This uses network access for dependencies, not hosted inference. Do not reuse the original account's cache.

```sh
cd "$VSUP_TEST_ROOT/warm"
npm ci --ignore-scripts --cache "$VSUP_CACHE"
```

5. Install the actual test copy offline from the same pinned manifest and cache. This is a private test prefix, not a global installation.

```sh
cp -R "$VSUP_KIT" "$VSUP_TEST_ROOT/installed"
cd "$VSUP_TEST_ROOT/installed"
npm ci --ignore-scripts --offline --cache "$VSUP_CACHE"
VSUP_CLI="$VSUP_TEST_ROOT/installed/node_modules/vibe-supervisor/dist/cli.js"
node "$VSUP_KIT/verify-install.mjs" "$VSUP_TEST_ROOT/installed/node_modules/vibe-supervisor"
node "$VSUP_CLI" --version
git clone "$VSUP_KIT/fixture.bundle" "$VSUP_TEST_ROOT/fixture"
git -C "$VSUP_TEST_ROOT/fixture" rev-parse HEAD
```

Expected version: `1.0.1-rc.1`. Expected fixture HEAD: `c83c01e4c5987fbe0e18afcfcccfea2d0a3a3e00`. The verifier must report all 140 package files matching and the pinned runtime dependency versions.

6. Initialize a separate explicit config with only the canonical fixture root, then run doctor. This changes only the test account's private test configuration, when performed by its human owner.

```sh
VSUP_CONFIG="$VSUP_TEST_ROOT/config/config.toml"
node "$VSUP_CLI" allow --config "$VSUP_CONFIG" "$VSUP_TEST_ROOT/fixture"
node "$VSUP_CLI" doctor --config "$VSUP_CONFIG" --json
```

If any prerequisite, version, signature or inventory fails, preserve sanitized evidence and stop. Do not widen the allowlist, change compatibility pins or copy credentials to make it pass.

## Native connection and inference gates

Prepare and review a Codex registration selecting the absolute Node executable, absolute installed CLI, `serve --stdio --isolated --config` and this test account's explicit config. TOML does not expand the shell variables above. Registration application requires its own applicable approval if an agent performs it. Reconnect, then verify the live handshake version, exact five-tool catalog and native workspace readiness on the connection that would run the task. Save no readiness receipt body.

Doctor, an installation verifier and native readiness are non-inference checks. They do not prove provider authentication. There is **no remaining hosted allowance**. Start no review or edit until a fresh bounded budget is authorized for this lane.

Prepared inference scopes, if subsequently approved: one read-only review of `CONTRACT.md` and `src/limit.mjs`, followed only on acceptance by one isolated edit at the recorded fixture base, creating only `src/at-least.mjs` and `tests/at-least.test.mjs`. Define a new explicit edit contract: export `atLeast(value, limit)` returning the ordinary JavaScript comparison `value >= limit`; add node:test/node:assert/strict tests for equal, below and above numeric boundaries, including negative and fractional values. The existing CONTRACT.md describes only below(value, limit), so do not invent additional validation requirements or alter that function. The coordinator must review the exact contract and prepare the complete task before requesting allowance; this outline is not an executable dispatch or authorization. Proposed ceilings: 12 turns, 180 seconds, one run per scope, no retry, stop first unexpected failure. Verify exported changes in a separate candidate copy, then close safely.

## Evidence and closure

Record test date, account type (standard; omit identity), architecture/runtime versions, archive and lock hashes, offline-install commands/results, verifier result, doctor result, registration proposal/approved diff, exact native server/config/policy identity, catalog and readiness blockers. For any authorized run record scope/base, run ID, limits, stop reason, warnings, integrity, independent acceptance and cleanup. Report usage/cost only if supplied; otherwise UNKNOWN. Record failures alongside later passes.

Never include credentials, keychain contents, provider payloads, private reasoning, caches or run HOME directories. Missing evidence remains unverified. Save only sanitized results for the coordinator. No source commit, push, release or production deployment is included.

Rollback for this account: disconnect the test registration, restore the account's reviewed pre-test registration if one was changed, and retain failed-run evidence until ownership/export checks allow cleanup. Do not delete another account's files or force-delete dirty worker worktrees. Removal of this test prefix is separate from site rollback.
