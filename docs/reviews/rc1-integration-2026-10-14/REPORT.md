# Source integration and account-test preparation — 14 October 2026

The previous goal turn made progress: it completed the authorized hosted batch and recorded independent disconnect acceptance while retaining original failures. This turn made progress by preparing and verifying a clean source integration and a transferable account-test packet. The stable-version goal remains active.

## Source integration

GitHub main was read without mutation and remains `7b30feaf60e7b6038e2bd80c14974d7ff270330e`, the candidate's reviewed base. A separate local clone contains the 18 tracked candidate changes plus four packaged review documents. All **22 files** match the frozen source bytes. This includes packaged documents omitted from the earlier tracked-only patch.

The independently installed pinned dependencies used the existing populated offline cache with package scripts disabled. The clean preview built successfully on Node 24.21.0: all **118 built runtime files** match their frozen package hashes. SBOM generation is separate from build and its unchanged frozen hash is already recorded in the package audit. No runtime changes were made, so the earlier full deterministic verification remains applicable; this is an integration and byte-reproduction check, not another hosted run.

A [complete source patch](complete-source.patch) and [rollback patch](rollback.patch) are prepared. A second disposable clone reproduced all 22 candidate files, applied the reversal and returned to the exact clean baseline. [Integration manifest](integration-preview.json), [build comparison](build-comparison.json), [rollback verification](rollback-verification.json).

No source commit, push, merge, tag, CI run or publication was performed. The primary dirty checkout and frozen package were preserved. This preview is reviewable local preparation; it is not a merged source revision. Frozen packaged acceptance documents retain their dated state. Later successful native/hosted/Node-floor evidence must be supplied as a separate dated supplement, not silently written into the same frozen archive.

## Clean-account packet

The owner chose **prepare the packet; test later**. The [instructions](FRESH-ACCOUNT.md) describe human-operated standard-account preparation, pinned private installation, native readiness and evidence collection. The [delivery receipt](fresh-account-kit-receipt.json) records the transfer bundle and every input hash. It includes no credentials, runtime state, cache or provider traffic.

Bundle: `tmp/vibe-supervisor-1.0.1-rc.1-fresh-account-kit.tar.gz`.
SHA256: `93f26aa82284de8c4a159b027d8ed01a208b3444d95d2d536ba46b1d8572dfd2`.

The [local rehearsal](fresh-account-packet-rehearsal.json) passed with no network: all 140 package files and four runtime dependency versions matched, the expected two-file Git fixture loaded, and intentional README tampering was rejected. This used the existing account and does **not** satisfy fresh-account installation or authentication. The actual account test must use its own independently populated dependency cache and human authentication.

The transfer bundle and disposable copies are local, ignored artifacts, with no remote backup guarantee. Preserve the bundle before moving or cleaning this checkout. The receipt and instructions are durable repository documents, but are not yet committed or pushed.

## Completion audit

| Requirement | Current verdict and evidence |
| --- | --- |
| Fixed one-shot scope, security and compatibility contracts | Existing full deterministic candidate checks PASS; candidate runtime/source unchanged. |
| Candidate native readiness and exact installed archive | PASS; installed archive audit and hosted final-readiness receipt. |
| Useful hosted review/edit and bounded failure handling | Accepted cases 1, 2b, 3, 4, 5; original case 2 FAIL retained. The corrected edit passed independent source review and 18 actual-command tests without worker-code repair. |
| Active official-client disconnect | Independently observed runtime PASS; original helper FAIL retained and diagnosed. Offline evidence-verifier regressions PASS; no rerun. |
| Exact Node floor and candidate package checks | Prior exact Node 20.19 and Node 24 full verification PASS, recorded externally after freeze. |
| Source integration and reversal | Prepared and independently verified locally; not committed/merged, no CI evidence yet. |
| Fresh standard macOS account | REQUIRED_NOT_RUN; transferable packet rehearsed, owner will perform later. |
| Stable promotion and publication | NOT_RUN for the changed runtime; applicable approval, fresh-account acceptance, CI and immutable source/artifact identity remain required. A changed final version/archive needs its own applicable confirmation; do not silently transfer frozen-candidate evidence. |
| Earlier no-edit root cause | UNKNOWN; successful observed tool use does not explain that earlier run retroactively. |

Hosted allowance is exhausted: seven used, zero remaining, no retries. Any later paid run needs a concrete scope and separate approval. Published 1.0.0 remains unchanged. <site-project> privacy and site release remain separate responsibilities, not hidden Supervisor acceptance gates.

Next available external actions are the owner's account test and applicable delivery authorization for the prepared integration. Keep the goal active while those requirements are incomplete.
