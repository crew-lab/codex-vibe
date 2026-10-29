# Artifact and prepared-input mechanism review — 2026-10-29

Scope: local source review and deterministic repair after repeated Unsafe artifact failures. No hosted inference, candidate installation, commit or publication was performed. This source is separate from the installed 2.2.1 candidate.

The review identified external-input/private-state conflation, envelope-only prepared-input admission before grant consumption, absent contract-to-worker forwarding, manual request duplication, and coordinator-only validation execution/diagnostics. The first candidate repairs input classification/diagnostics and prepared-input admission; remaining orchestration work is documented explicitly in the specification.

before-cli.log reproduces the old CLI rejecting a normal 0644 patch. after-cli.log and cli-proof.json show the rebuilt CLI preparing exact baseline/candidate copies from the same unchanged 0644 bytes, without chmod or dependency installation. Unsafe writable input and malformed selected JSON return specific INVALID_ARGUMENT errors without contents; private internal state stays strict. The disposable validation root was removed after full fingerprint verification.

release.log is the original failed broad gate: 116 test files passed, two failed on missing-receipt classification after error typing. receipt-regression.log records the affected suites after the narrow integration repair. The original failure remains preserved. release-round2.log records the full successful gate: 118 test files, 1,657 tests passed and one skipped. independent-verification.md records fresh local R1–R5 acceptance as VERIFIED.

Task/specification: [mechanism resilience](../../../planning/mechanism-resilience-20261028.md). Raw machine paths use placeholders; exact source hashes and candidate diff bind local evidence. This packet cannot qualify a different archive or installed server and does not claim arbitrary-prompt implementation correctness.
