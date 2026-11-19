# Vibe 3.1.3 model pin and recovery trial

Tested on November 18, 2026 from GitHub main at `2275c722cd2d434c235aada03cc61c89b4467b29`. The 2.2.2 release suite passed 1,930 tests across 131 files, with one skip. The release archive and kit passed checksum verification.

The worker and quality trials used an installed preview archive with candidate SHA-256 `e18cbffc06f73a2231d3f23db3402f32ba44f22d42572c1f82edd0de3ef4a89a`. The final release archive added the generated SBOM. All files shared by the two archives were byte-identical. The final archive had candidate SHA-256 `e9654fbaf67e1143a07b48be49c3cee2b354d9d0d7c8861d589f25f276bbf381` and was separately prepared for the CI replay.

## Preparation and recovery

- A private 3.1.2 pin against Vibe 3.1.3 refreshed automatically. Readiness named `mistral-medium-3.5` and the 25-turn default, then required a preparation receipt for the new candidate. The installed preview passed `prepare check` in 16.9 seconds. The model-selection gate reported `selected: true` and provider label `mistral-vibe-cli-latest`.
- From that prepared state, Vibe 3.1.3 to 3.1.2 took 17.5 seconds to re-pin and prepare, and 3.1.2 to 3.1.3 took 17.9 seconds. Both readiness calls returned eligible with no blockers, the correct `worker.refreshed.from`, and the 25-turn default. Both hosted reviews carried the warning about hosted quality after refresh. Neither transition required a manual pin or preparation command.
- A byte appended to `vibe/__init__.py` in the disposable worker installation returned `file-mismatch` with `attempt_consumed: false`. After the original bytes were restored, the same grant completed `review-total`. No patch was applied to the quality fixture.
- With `mistral-large-4-0` selected, automatic preparation passed. The hosted review made one model call, read zero files, and returned HTTP 403 as `VSUP_BACKEND_ERROR` with `details.reason: provider_refused` and `details.model: mistral-large-4-0`. The provider's message was “This model is not available in your subscription tier.” The original account error code was `invalid_api_key`. The trial restored the default model.
- The earlier run `8aa0f43d-30d1-458e-bfb5-0cfa1c80e919` was unavailable in the local run stores checked. Its selected model remains inferred. This trial directly observed the provider refusal with the large model explicitly selected.

## Hosted quality

| Task | Vibe | Checks | Duration | Model calls | Prompt + completion tokens |
| --- | --- | --- | --- | --- | --- |
| review-stock baseline | 3.1.3 | 4/4 | 61.5s | 4 | 34,410 |
| review-stock after downgrade | 3.1.2 | 4/4 | 33.5s | 2 | 17,569 |
| review-stock after upgrade | 3.1.3 | 4/4 | 18.5s | 3 | 19,984 |
| review-total after restoring drift | 3.1.3 | 9/9 | 40.5s | 2 | 20,409 |
| edit-shipping | 3.1.3 | 14/14 hidden tests | 12.0s | 4 | 30,195 |
| edit-reserve-all | 3.1.3 | 17/17 hidden tests | 21.9s | 7 | 60,549 |

All six runs ended with `end_turn`. Every review read exactly its three named files and the hosted baseline exported `mistral-medium-3.5` as both the requested model and the runtime alias. The [3.1.2 records](../vibe-312-quality-e429-20261114/README.md) report the same checker outcomes. Review-stock was more variable on this trial. Shipping used fewer tokens and reserve-all used more than the earlier single 3.1.2 edit samples. This run covered all four task types and did not repeat the previous five-sample review sweep.

Both quality edit runs closed successfully. The supervisor retained their worktrees because the exported changes were still uncommitted or untracked there. The original fixture stayed clean.

## Copy-rules CI replay

The frozen request was recovered and its original SHA-256 matched. The checked-out base was `4465bbf0b04ff7d8ac7234837ebfc8f339732bf2`. Readiness for the final release archive was eligible with the expected candidate, Vibe 3.1.3, `mistral-medium-3.5` and a 25-turn default. The request retained its 600-second deadline.

Run `397dbf8b-10fa-4245-9be7-7382f0eb750f` reached `end_turn` in 404.4 seconds after 15 model calls. It spent more than five minutes between its last tool event and settlement. The audited execution recorded 11 reads across seven allowed files, seven writes and one blocked shell call. The six requested initial files were read in order. No out-of-scope path was read or changed.

The exported patch SHA-256 was `b17d3dec817ecb5b2590b56e1534efb6de031f77bae488fb031572f5d3d81bf7`. Its bundle checksums matched. The built-in contract passed scope, required changes and snapshot absence, then failed the named-test check. Independent checks in a separate disposable clone confirmed CI step placement, lint, type checking, three baseline tests and no-vault validation. Nine of ten focused tests failed. The exporter stored the documented `--vault-path` flag under `vault-path` and looked for `vaultPath`, causing an immediate failure with valid input. The patch also introduced trailing whitespace.

The coordinator recorded a rejected assessment against the frozen contract and exported patch. The supervisor retained the dirty worktree. The original trial clone stayed clean.

## Bounded correction on November 19

The correction used the same base, seven writable paths, acceptance contract and 600-second deadline on the final 2.2.2 archive. Its brief included the prior CLI, fixture, named-test and whitespace failures and asked the worker to finish after a tool refusal. Wire tracing was enabled.

Run `17a9676c-739d-4800-a4a4-c989c04fa6f8` finished with `end_turn` in 84.7 seconds after 18 model calls. The worker still attempted one shell call, which policy denied. The wire trace recorded one completion frame at 83,013 ms and accepted it at 83,014 ms. The earlier prolonged tail did not recur in this sample.

The exported patch and bundle checksums matched. The built-in contract passed all four checks. Independent type checking, lint, whitespace, three baseline tests, CI placement and no-vault validation passed. All eight focused tests failed at fixture setup because they called `mkdtempSync()` without a prefix. An independent synthetic export also reproduced the original failure: the documented `--vault-path` was rejected with “Error: --vault-path is required.” The coordinator recorded a rejected assessment. Patch SHA-256 `ec3687ebd5245ff839fa96ed126a4d3a43b892dfa5da08ef4408cf06b9db1ee5`.
