# Integration-test follow-up — 2026-10-28

The retained boundary patch is unchanged. Its original automated contract is still failed: the coordinator required the literal node:assert/strict import and the worker used the equivalent strict export of node:assert. original-checks.json and original.patch preserve the original check output and exact patch. This evidence does not amend that run or grant.

The local rebuilt validation CLI prepared independent copies of the actual immutable trial base and exact patch using --no-install, without manager/cache or a lockfile. Five generated named node:test cases and eight independent numeric boundaries passed. Both strict assertion imports resolved to the same object. A separate framework inspection accepted both strict import forms and rejected missing named test registrations; running the exact tests on the unfixed baseline failed at 100. The original baseline stayed clean. No new hosted start was spent.

Node 24.22.1 was used for these local checks. diagnostic.json, generated-tests.log and unfixed-negative.log record the results; private paths in logs use placeholders. Original frozen-contract failure and diagnostic requirement PASS are separate outcomes. The source repair and rebuilt CLI do not alter or qualify the installed candidate.

The task record is [the EDD](../../../../planning/vibe-usability-edd-20261028.md#follow-up-amendment-4--reported-integration-test-failures). Release checks and source identity are recorded alongside this note when completed. This is local-source evidence, not publication or target qualification.

Full local verification: npm run verify:release passed, including lint/typecheck/build, 115 test files with 1,627 passing tests and one skipped, acceptance, secret scan and SBOM. The focused validation suite has 13 tests. Skill syntax, adapter TOML, example JSON, 53 workflow links and 33 Handoff/evidence links passed. No machine paths were found in this follow-up packet.

Cleanup retained the disposable validation root on its first attempt while the injected negative-test file remained. After verifying and removing that known file, validation clean confirmed the original full content fingerprint and removed the copies. Raw diagnostic scripts/logs remain private; the exact original patch and the original failed checks are also preserved here.
