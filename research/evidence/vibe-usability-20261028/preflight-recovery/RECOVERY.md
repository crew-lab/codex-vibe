# Integration recovery result — 2026-10-28

The original PREFLIGHT.md is unchanged. Diagnosis was correct: the coordinator's patch was mode 0644. After canonical path, ownership, regular-file and single-link checks, changing only the mode to 0600 preserved SHA-256 and allowed copy-only preflight to pass. Private patch creation and one bounded pre-start recovery are now explicit in the active skill and validation documentation.

Two authorized hosted starts were then used, with no replay: one review and one edit. Connected supervisor 2.2.1, installed candidate 65dbafd0700891c72978e35df8a599a1c110ba37d13ff68bb19a3004cbe1e716, matched preparation PASS. This does not qualify the source-tree helper's rebuilt distribution.

Review: PASS. Two supplied context files, two executed reads, verified read-only integrity, correct defect at exactly 100. Closed normally.

Edit: REJECTED. The exact two permitted files changed, named export retained, numeric behavior passes eight independent cases. Generated tests call test without importing it from node:test; Node 24.21.0 --test fails ReferenceError: test is not defined. Original patch SHA-256 88459562600d6b8c60454cbfe53c43aa52550dcddada2cc1476cf36544179892. Automated existence/scope checks passed; required coordinator framework and test checks failed. This is a genuine worker-output defect, not an import-spelling preference.

Coordinator diagnostic repair: add only the missing node:test import in separate validation copies. All five generated named tests pass; on the original baseline, the repaired tests fail specifically at exactly 100. This is separately attributed coordinator work, not Vibe success or integrated output. The original exported patch and rejected assessment remain unchanged.

Verification-record correction: the first evidence script expected Node's failure text only on stderr, but the test runner forwarded it on stdout. The script was corrected once to inspect combined streams; the original failure was unchanged. The rejection was based on the earlier direct Node invocation; the final script also confirmed all eight independent numeric cases.

Both runs closed. Slot free. Exact pre-test supervisor configuration restored after confirming no concurrent change; temporary fixture authorization removed. Dirty supervisor edit worktree retained by policy. Original fixture remains clean at its frozen baseline; no patch integration, project commit or publication.

Recommended task shape for dependable use: preflight private artifacts, supply a working test scaffold or coordinator-owned tests, give Vibe a bounded implementation change, run independent tests and accept only verified output. Do not continue spending hosted starts on the unchanged rejected artifact.

Final cleanup: all three disposable validation roots were removed only after the helper verified full ownership/content fingerprints. The separately repaired test was restored to its original bytes and the injected baseline test removed before cleanup. Exact exports, logs, the corrected-test snapshot, original fixture and supervisor-owned dirty worktree remain available for inspection. Independent diagnostic audit supports the reported attribution and outcomes; it does not accept the rejected edit.
