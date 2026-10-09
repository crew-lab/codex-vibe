# rc.18 release and local installation — 2026-10-09

Candidate: `vibe-supervisor@0.9.0-rc.18`, npm-private, unpublished to the npm registry, ESM, MIT. GitHub prerelease distribution and local installation are authorized. Runtime behavior remains rc.17 apart from package identity; preparation scripts remain source-only and skills are refreshed. F8/F7/F15/F11 remain unresolved. Hosted recovery and soak are blocked pending fixes. No new hosted inference is part of this release task.

The exact release source is the rc.18 tag commit. SHA256SUMS identifies the distributed tarball, SBOM and acceptance report. Release assets and installation must be verified before reporting completion. This source receipt describes intended scope; a separate post-build receipt records actual checks, hashes and installation outcome, avoiding a self-referential archive checksum.

Offline packaging requires the populated cache and runs lint, typecheck, build, unit/integration/Python checks, deterministic acceptance, secret scan, SBOM and isolated installed-package smoke. Fake-peer tests and initialize/tool listing do not prove hosted recovery, native desktop refresh, soak, Intel or clean-account installation.

Installation targets a new `/Users/roman/.local/share/vibe-supervisor/rc18` prefix. Preserve rc17, private provider state, original configuration backup and all existing runs. Preserve unrelated Codex settings and backend/roots/limits; change only the executable/template paths. Refresh the existing skill links to the installed package. Independently verify installed version, archive/runtime/skill bytes and seven-tool official-client initialization. This chat's already connected process remains unverified until a new native run records its creator; do not restart it automatically.

See [triage](lifecycle-triage-2026-10-09.md), [test plan](../../lifecycle-recovery-test-plan.md), [prior installation](rc17-local-installation-2026-10-09.md) and [Handoff](../../../Handoff.md).

## Verified outcome

Published [GitHub prerelease v0.9.0-rc.18](https://github.com/crew-lab/codex-vibe/releases/tag/v0.9.0-rc.18) from exact source/tag commit `88bb58c8340815ca78f95ab90252a284c229072e`. Downloaded all four assets independently; every byte matched the local verified outputs, and all SHA256SUMS entries passed.

| Asset | SHA-256 |
| --- | --- |
| vibe-supervisor-0.9.0-rc.18.tgz | d22acd05ef2fa5c4f697d76cf4ef26d70973699cf668200076daa2a79baebd28 |
| sbom.spdx.json | 19f93dab786cd351be8f31f0231fccac42feb8d006b8ffb9f952d09d4bf2e547 |
| acceptance.json | 65cefb3805357e48b032316a2acc4af3a6608ac3bc5585efc690903b5c2febc3 |

Final `package:rc` passed lint/typecheck/build, **771 TypeScript tests, two optional skips in 69 files**, the Python suite, deterministic acceptance, secret scan, SBOM and isolated installed-package smoke. The initial attempt failed because the plugin manifest version was not updated; that mismatch was corrected and full packaging rerun. Initial and final logs are retained privately; no pass is substituted for the first failure.

Local installation at `/Users/roman/.local/share/vibe-supervisor/rc18` passed doctor and exact comparison of **119 dist/skill files**. CLI alias and both skill links point to rc18. Backend ACP, all existing roots and declared limits are unchanged; unrelated Codex settings were parsed and compared. The original Codex configuration has an owner-private backup; rc17 template, runs, provider state and installation remain untouched for rollback. No guards were weakened.

Fresh official-client initialization confirmed **0.9.0-rc.18**, seven ACP tools and no start-side backend/allow_shell fields. Missing-run status returned VSUP_NOT_FOUND; close left zero saved runs/owner locks in the new initialization-only session. This does not prove the current desktop process refreshed. Hosted inference was NOT_RUN. No recovery, soak, clean-account or Intel claim is made. Skill changes are available on the next turn; establish native creator identity before hosted dispatch.

[Sanitized outcome](rc18-release-outcome-2026-10-09.json) records exact identity/check results. Private logs, downloaded outputs, installation/doctor/handshake and file-verification records are retained under the rc18 prefix's `installation-evidence-2026-10-09`. Post-build outcome documentation is committed separately from the tagged artifact to avoid self-referential checksums; the published tag/assets remain immutable.
