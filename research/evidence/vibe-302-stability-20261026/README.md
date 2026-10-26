# Vibe 3.0.2 stability qualification

Candidate: `7641d294df5f432b1b99633c052b5e2311e16131e9ad9e8dc828ccf8511f9154`. Archive SHA-256: `9f949d4337b4dc037c1e82c0a692c8da27878f670992c46f77f79c9f5f1de2a5`.

The frozen source was restored and every source file checked against its saved checkpoint. The published archive is the original qualified artifact; it has not been rebuilt or relabelled. Its source snapshot is attached separately.

The target passed the matched no-inference preparation check and native readiness with five one-shot tools, Vibe 3.0.2, an eligible workspace and a free slot. The preparation report hash is `4447cd4f0c64aa63bd96af4d99e8dcf1a668ac4fb7edbad36931ae87b8a453aa`; this is not a receipt identity.

The bounded arithmetic edit passed nine semantic checks and nine worker tests. A coordinator parser defect initially rejected it: the parser read `ok` instead of `passed`, and expected a terminal reporter rather than TAP. Offline verification corrected that conclusion. The normal close API appended acceptance while preserving the original rejection. No hosted replay occurred.

The archived hosted runner is disabled. Its offline replacement passed nine regressions; 51 dispatch, readiness and cleanup regressions passed. One listener test required local-network permission after EPERM in the restricted environment.

This narrow fixture does not establish general implementation quality, hosted Antigravity support, clean-account installation, or every historical hosted gate. Those remain separate. Publication is a pre-release, with no stable/latest promotion.

## Publication verification

On 2026-10-26, Node 20.19.0 / npm 10.8.2 release verification passed: 106 files, 1,542 tests, lint, typecheck, build, acceptance, secret scan and SBOM. Dependencies were restored offline from the locked cache. The portable offline verifier passed all nine checks and lint after replacing its private local options dependency with public fixture inputs. Run it with `node --test research/evidence/vibe-302-stability-20261026/offline-verifier/verify-trial.checks.mjs`. Its fixture verifier retains the original behavior with documentation comments removed; tests compute the hash of the bundled bytes. Historical verifier hashes remain unchanged in the recorded trial evidence.
