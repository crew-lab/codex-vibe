# rc.23 preservation and source integration review

Date: 2026-10-11. Status: preserved, reconstructed and reviewed; source integration is prepared locally, not merged or published.

## Preserved identities

Frozen archive SHA-256: `1dec1be1adcac0f96ad6d9ba453dd817977efdd3e76703ebc96acf4d65fa5998`.
Delivered implementation patch SHA-256: `bc27b5c04d882142e2218e7caf700d19143f11e4a666e54f0750644c8b843ff6`.
Base commit: `d94541e3c4a495306b6575758593164e6e28527e`.

Private preservation directory: `tmp/rc23-preserved-20261011T191549Z`. It contains a verified Git bundle of the base history, exact delivered patch, separate later source/documentation patch, release archive/SBOM/acceptance/checksums, prior package verification log, delivery and installed-client receipts, private selected configuration and synthetic baseline archive. No provider runtime or native histories were copied. These files are local/private and must be backed up separately; an ignored directory is not a remote backup.

Restoration succeeded in `reconstructed-delivery`: bundle validation and patch application passed; 118 runtime/test/script/package files match the working implementation. Every installed package file matches the frozen tarball. All retained release checksums were independently verified. Documentation updated after the artifact freeze is preserved separately and does not redefine that archive.

## Focused review

Scope: rc.23 reconnect routing, isolated CLI wiring, owner locking and shutdown integration, regression coverage, dependency/package delta and upstream ancestry. This is not a new full audit of the earlier reduction in PR #2.

No blocking defect was identified in this focused review. Routing uses only the selected private namespace, requires a unique UUID, claims the original store exclusively, revalidates paths after claiming, uses the current validated configuration and delegates saved-state handling to RunManager. New runs remain local; saved tasks are not replayed. Borrowed operations drain before primary shutdown. The lockfile dependency entries are unchanged; only the package version changed.

Existing limitations remain explicit: the namespace scan refuses more than 128 entries; unsafe/ambiguous paths and live owners fail closed; the client cannot identify its original session solely from reconnect; missing native hosted-disconnect and clean-account evidence remains unknown. Namespace capacity and conservative refusal can affect availability; neither is presented as a passed platform/stability gate.

Checks performed now: artifact and installed-file equality, base-bundle verification, delivered/current patch application, 118-file source equality, upstream commit ancestry and Git whitespace/local documentation link checks. Existing final package verification (570 Vitest passes, two skips plus Python/release/installed-MCP checks) is preserved rather than rerun for unchanged runtime code. No hosted inference was started.

## Upstream and integration path

GitHub state observed 2026-10-11:

| Item | State | Source identity |
| --- | --- | --- |
| main | rc.18 baseline | `0e0cb6c9909952dbc915af57d13752c90ea63770` |
| [PR #2](https://github.com/crew-lab/codex-vibe/pull/2) | OPEN to main; CLEAN; listed CI checks SUCCESS; no recorded review decision | `9cfbfde4ed50eed8662d8bc3497cfb462110dfbf` |
| [PR #3](https://github.com/crew-lab/codex-vibe/pull/3) | OPEN to PR #2 branch; CLEAN; listed CI checks SUCCESS; no recorded review decision | `d94541e3c4a495306b6575758593164e6e28527e` |
| [rc.22 prerelease](https://github.com/crew-lab/codex-vibe/releases/tag/v0.9.0-rc.22) | Published prerelease | same rc.22 commit |
| rc.23 | Private local artifact/source delta | no rc.23 publication performed |

Ancestry is linear: main → PR #2 → PR #3. Both rc.23 delivered and current patches apply cleanly at PR #3. This demonstrates a concrete source path without claiming GitHub review approval or merging the branches.

Local integration preview: `tmp/rc23-preserved-20261011T191549Z/integration-preview`, branch `codex/rc23-reconnect-hotfix`. Changes are staged only in this separate preview; no commit was created. The original implementation and unrelated primary changes remain preserved. The exact final staged tree and patch digest are in the private `integration-review.json` receipt.

Recommended source sequence: review/merge PR #2 when authorized; retarget/review PR #3 after that merge; review the rc.23 patch stacked on PR #3 or transplant it to the integrated main after comparing trees. If squash/rebase changes commit ancestry, use the preserved source/patch identities to verify equivalence. Recheck CI and upstream state at integration time. A new integrated artifact must be verified before a stable tag; do not silently substitute it for the frozen installed rc.23 archive.

## Next action and recovery

P0 preservation and focused review are complete. Source integration is reviewable but remains pending commit/push/merge authorization. Next independent development priority is P1: native saved-record access after reload and deterministic disconnect rehearsal without provider spending. Real active hosted-disconnect, candidate-specific hosted acceptance, Node-floor and fresh-account checks remain open.

The rollback registration backup is `/Users/roman/.codex/config.toml.bak-rc23-20261011T160257Z`; the previous private rc.22 installation remains available. Inspect current configuration before restoring the Supervisor entry so unrelated later changes are preserved. Do not blindly replace the whole config or delete private stores/worktrees.

This review performed no commit, push, merge, publication, account/configuration changes or hosted inference. No runtime modification was needed.

## Authorized integration follow-up

The user authorized commit, push and merge after this review. PR #2 merged as `49ba043b83afd8a7706a9addd53448f18887a505`; PR #3 was retargeted to main and merged as `b6a110179d11d2d3ce6cb7480a6866e983a33631`. The resulting main tree equals rc.22's reviewed base tree (`42850ffa7cc38f8ca67e20dc74bfb4614bc793a2`). The local rc.23 branch fast-forwarded to that base with its prepared changes intact and proceeds through its own commit/CI/merge workflow. Earlier OPEN/pending/no-commit observations above are the preserved pre-integration review, not the current authorization state. No rc.23 release publication or hosted call is part of this integration.
