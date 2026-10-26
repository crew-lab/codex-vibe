# Clean-account installation checkpoint

Status on 2026-10-17: pending. The owner has no separate clean standard macOS account available. A private prefix or changed HOME in the current account does not satisfy this gate. Do not create an account, use administrator privileges, or mark this check passed as part of the current task.

## Frozen candidate

Use version 2.0.2 from source `347bf79`, archive SHA-256 `84bff94130ea342baa26be3a7567c282ff22ef7b3f32c0f7817113afc8a3cf09`, installed distribution SHA-256 `eaa40320873caf810900cf201862695a82e1dc499807bb81ca25235b955d12c1`. Transfer the exact frozen archive, matching preparation kit, SBOM and checksum manifests; never rebuild it for this check. The [packet report](../research/evidence/release-2.0.2-347bf79-2026-10-16/REPORT.md) records preparation and identities.

## When a separate standard account is available

1. Record macOS version, Apple silicon architecture and standard account status without publishing account names or machine paths. Record which prerequisites were initially absent.
2. Follow the [installation instructions](../README.md#source-setup) with Node 20.19.0/npm 10.8.2 and pinned Vibe 3.0.2. Use a reviewed populated offline cache for the exact archive installation, with lifecycle scripts disabled. Do not copy the existing account’s credentials, trust records, private configuration or preparation receipt. Missing offline prerequisites are a recorded blocker, never a silent network fallback.
3. Verify archive/kit checksums and installed identity. Create a fresh explicit config with only the named synthetic fixture root. Generate and inspect the pin manifest; run doctor.
4. Run one matched no-inference preparation check according to the [target procedure](target-acceptance.md). Stop on deterministic failure; do not retry unchanged bytes. No provider credential or hosted turn is needed.
5. Review registration dry run, record initial configuration and skill-link state, apply only Supervisor entries with rollback retained, reconnect and check native review/edit readiness for the expected candidate, preparation PASS, eligible fixture, free slot and five tools.
6. Exercise rollback to the recorded prior state (including absence, if no prior registration existed), remove only test-owned files after ownership checks, and verify cleanup. Leave the existing account’s installation untouched.
7. Save a sanitized report with exact identities, checks actually performed, registration/rollback outcome and cleanup. Exclude credentials, receipts, machine paths and private history. Only complete evidence closes `clean-account-install`; partial setup remains pending.

This checklist authorizes no hosted start, stable promotion, merge, tag or publication.
