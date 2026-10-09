# rc.18 release and local installation — 2026-10-09

Candidate: `vibe-supervisor@0.9.0-rc.18`, npm-private, unpublished to the npm registry, ESM, MIT. GitHub prerelease distribution and local installation are authorized. Runtime behavior remains rc.17 apart from package identity; preparation scripts remain source-only and skills are refreshed. F8/F7/F15/F11 remain unresolved. Hosted recovery and soak are blocked pending fixes. No new hosted inference is part of this release task.

The exact release source is the rc.18 tag commit. SHA256SUMS identifies the distributed tarball, SBOM and acceptance report. Release assets and installation must be verified before reporting completion. This source receipt describes intended scope; a separate post-build receipt records actual checks, hashes and installation outcome, avoiding a self-referential archive checksum.

Offline packaging requires the populated cache and runs lint, typecheck, build, unit/integration/Python checks, deterministic acceptance, secret scan, SBOM and isolated installed-package smoke. Fake-peer tests and initialize/tool listing do not prove hosted recovery, native desktop refresh, soak, Intel or clean-account installation.

Installation targets a new `/Users/roman/.local/share/vibe-supervisor/rc18` prefix. Preserve rc17, private provider state, original configuration backup and all existing runs. Preserve unrelated Codex settings and backend/roots/limits; change only the executable/template paths. Refresh the existing skill links to the installed package. Independently verify installed version, archive/runtime/skill bytes and seven-tool official-client initialization. This chat's already connected process remains unverified until a new native run records its creator; do not restart it automatically.

See [triage](lifecycle-triage-2026-10-09.md), [test plan](../../lifecycle-recovery-test-plan.md), [prior installation](rc17-local-installation-2026-10-09.md) and [Handoff](../../../Handoff.md).
