# Package/kit identity repair and preparation

Result: repair implemented, packaged, independently verified and installed. The one no-inference preparation check passed. Desktop registration and the Supervisor skill link were switched after PASS, with private backups. Native readiness is pending a desktop reconnect: the current connection still reports 2.0.0-rc.2. No hosted run started.

## Frozen build

- Source commit: `44dc6f815c1b80ac75c0ce2613373e38ed2421c8`, branch `codex/package-kit-identity`, based on main `8b288b8` in an isolated preparing checkout.
- Package version: unpublished 2.0.1; runtime Node 20.19.0 / npm 10.8.2; macOS arm64; Vibe 2.26.1.
- Archive SHA-256: `7978719c0010c8bad27ff9982ee930b392040b5f5339cb1493467d5dae2bae4e`.
- Installed candidate SHA-256: `8b1b7dd556ea985e27f9886b31d2fea7952861c831f2b24e22f273a64dba93a4`.
- The candidate digest equals the actual runtime digest of the failed packet. This repair changes packaging, tests and documentation, not runtime identity inputs. The corrected archive has a distinct archive hash and a kit that now identifies the distributed runtime correctly.

## Defect and repair

npm 10.8.2 executes prepare during pack even with --ignore-scripts. Rebuilding dist removes its SBOM. The previous packager regenerated an external SBOM before computing kit identity, binding the kit to a file absent from the archive. The failed packet remains unchanged with its original mismatched kit identity `ca130061bb1273a08cbb8f9bda89187f806f3b37dee46c49d4917d4885de9f42` and archive hash `18d46d1c1d803518842a14973ef037412add927104c74b1bf5198229c79f6312`.

The packager now captures identity immediately after pack and before external SBOM regeneration. An internal finalization helper installs the exact archive offline, with lifecycle scripts disabled, into a temporary private prefix. It checks installed identity, version, conformance script and all kit checksums before announcing success. Delivery checksums include every kit file. The temporary installation is removed in finally. External SBOM generation, identity algorithm, public schemas, five MCP tools and preparation policy are unchanged.

## Checks performed

- Four artifact regressions passed: real npm lifecycle rebuilding dist/removing SBOM; an archive retaining its SBOM before external regeneration; repacked modified content and tampered/unsafe kit checksums rejected; actual offline dependency-cache miss rejected with cleanup and no success announcement.
- Full package:rc passed on the frozen commit under Node 20.19.0/npm 10.8.2: lint, typecheck, build, 89 files/1,296 tests, acceptance, secret scan, SBOM and offline installed-package smoke.
- Mandatory final installation check passed; main-chat independent offline installation separately verified archive/kit binding, script, version and delivery/kit checksums. Both temporary installations were removed.
- Pin reviewed: Vibe 2.26.1, 783 files, native compiled core included; doctor passed. Per-check pin hashing took 166, 158 and 149 ms.
- Exactly one matched no-inference preparation check passed: fixed fake key, no turn/start, zero reported prompt/completion tokens, model-call count unavailable. Both profiles had zero read-back mismatches, thinking off and expected tool/permission policies. Builtin skills were accepted with expected provenance.
- No subject network requests observed; positive control validated the refusing observer. Requests were refused and nothing forwarded. Experiments-specific attribution remains unverified.
- All three child processes exited on EOF; process groups gone and private directories removed. Two informational runtime/updated notification findings are retained in the separate packet’s CONFORMANCE.sanitized.json; no fail findings.
- Side-by-side installation retained the old prefix. All three old roots and other settings preserved; only the named Supervisor repository added. New private pin/receipt, no old receipt changes.
- Registration dry run reviewed after PASS, configuration and skill link backed up privately, only Supervisor entries switched. Independent parsed comparison confirmed unrelated desktop settings unchanged.
- Installed readiness via official SDK passed: expected candidate, preparation passed, eligible workspace, free slot, no blockers/restart requirement, exact five-tool catalog. This is not native evidence.
- Native tool check reports the old 2.0.0-rc.2 connection, no candidate identity or preparation status, and the old root-policy blocker. Desktop reconnect is required before native acceptance. UI control of Codex was denied by the computer-use tool; no alternate UI-control mechanism was attempted.

## Boundaries and remaining work

No hosted starts, main merge, push, publication, deployment, automatic patch application or credential access. Primary checkout unrelated changes, failed packet, old installation and previous preparation receipts are preserved. Luna/high implemented packaging and regression changes; main chat independently reviewed and verified the artifacts and performed installation/preparation. No Vibe edit was used for this repair.

Reconnect the desktop Supervisor connection, then check expected candidate, preparation PASS, workspace eligibility, free slot and native five-tool catalog. No hosted work is included. Hosted gates, fresh-account installation and other platform support remain unverified.

The raw conformance report remains in private installation state under its recorded hash. The shared copy is sanitized and has a different hash. Private receipts and configuration backups are intentionally excluded from this packet. SHA256SUMS is the packager delivery manifest; PACKET-SHA256SUMS additionally covers the frozen kit archive and reports.
