# Frozen 2.0.2 packet and preparation — 2026-10-16

2.0.2 was packaged from pushed source 347bf79, independently verified, installed side-by-side and selected in registration. Full packaging, one matched no-inference preparation check and installed SDK readiness PASS. Native readiness is pending desktop reconnect; the active 2.0.1 connection correctly rejects the expected 2.0.2 identity. No hosted start or release publication occurred.

## Exact identities

- Source: 347bf79 on codex/package-kit-identity, based on main 4a84930. Evidence review is draft PR #9; no merge into main occurred.
- Version 2.0.2, Node 20.19.0/npm 10.8.2, Vibe 2.26.1, macOS arm64.
- Archive SHA-256: `84bff94130ea342baa26be3a7567c282ff22ef7b3f32c0f7817113afc8a3cf09`.
- Installed candidate/kit SHA-256: `eaa40320873caf810900cf201862695a82e1dc499807bb81ca25235b955d12c1`.
- Conformance script SHA-256: `7d563e9c346c5f687545f0c2989787a9ba4570e659ad27b6c03a354ac6bc490e`, unchanged.

The source, archive, external SBOM, kit directory/archive, original packaging acceptance report and checksums are frozen here. The original packager manifest remains byte-for-byte in PACKAGER-SHA256SUMS. The delivery SHA256SUMS additionally binds the kit archive created from its verified files. PACKET-SHA256SUMS covers the reports too. The frozen packaging acceptance report is not rewritten when later target evidence is recorded in source documentation.

## Tests and preparation actually performed

Full package:rc passed on Node 20.19.0/npm 10.8.2: lint, typecheck, build, 89 files/1,305 tests, acceptance, secret scan, SBOM, offline installed-package smoke, and the mandatory exact-archive installation/kit binding check. A separate coordinator offline installation verified installed identity, package version, script hash and kit/delivery checksums; its temporary prefix was removed.

Installed into a new private prefix beside the previous 2.0.1 installation. All four configured roots and other settings were preserved, with no added root. The new pin path is candidate-specific. The reviewed manifest exactly matches the prior Vibe 2.26.1 manifest: 783 files including the compiled core. Doctor passed without reading provider credentials.

Exactly one matched prepare check passed, with fixed fake key and refusing observer. No turn/start was sent. Review/edit startup, version, configuration/read-back, thinking off, permitted bundled skills and profile policies pass; subject startup requests are absent and the positive control validates observation. Experiments-specific attribution stays unverified. All three child processes exited on EOF, their groups disappeared and private directories were removed. Only informational runtime/updated notifications were reported. No retry occurred.

After reviewing the dry run, private configuration/skill-link backups were retained and only Supervisor registration and skill link were switched to the persistent Node 20.19.0 runtime and 2.0.2 prefix. Parsed comparison verified unrelated desktop settings unchanged. Official SDK readiness passes with expected candidate, preparation passed, eligible workspace, free slot, no blockers and exact five-tool catalog.

Native readiness with the new expected candidate reports the old 2.0.1 candidate 1c3c1358 and the expected-candidate mismatch blocker. SDK results are not presented as native proof. Desktop reconnect is required before the native gate can close. No attempt was made to control the app through a prohibited UI route.

## Release boundaries and next action

The disconnect PASS remains bound to source 2a49abd/archive 133e77bd. It is not relabeled as a PASS for earlier source 44dc6f8/archive 7978719c or this new 2.0.2 archive. The worker review/edit failures remain documented limitations, not test passes. Proposed disconnect/handler carry-over still needs explicit owner confirmation; no new hosted allowance exists or was spent.

Reconnect Supervisor or restart Codex, then verify expected native candidate eaa40320, preparation PASS, fixture readiness, free slot and five tools. After native evidence is recorded, the owner still completes the clean-account check on the archive selected for stable promotion and confirms any carry-over. No release tag, publication, promotion, deployment or merge is included in this task.

Raw receipts and configuration backups remain private. The raw conformance report stays in candidate state under its recorded hash; the sanitized copy has a distinct hash. No credentials, readiness receipt, reasoning content, raw transcript or target-machine path is included in committed evidence.
