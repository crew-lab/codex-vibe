# Vibe 3.1.3 stock-export trial

Tested GitHub main at `093cee5` on November 19, 2026. The installed 2.2.2 archive and preparation kit passed checksum verification. Candidate SHA-256 `bdded82beffac1297c807aa52e5f6e2716a41c1af356eb74ed4ab4623ebb3ec8`. Release verification passed 1,953 tests with one skip across 132 files.

Installed preparation passed in 14.8 seconds on Vibe 3.1.3. The read-back checked project context disabled and provider waits of 300 seconds for first output, 120 seconds for stream idle and 180 seconds for retrying a failed call. Hosted runs used `mistral-medium-3.5`, the 25-turn edit default and wire tracing.

The old copy-rules run `397dbf8b-10fa-4245-9be7-7382f0eb750f` recorded `turn_retrying` at 19:29:15 UTC, about 305 seconds after its last tool event and seven seconds before verification. The record confirms a retry during the tail. It does not contain the underlying provider error.

The installed preparation path filters out `VIBE_STRICT_CONFIG`. A separate copy of the no-inference probe injected only `VIBE_STRICT_CONFIG=1` into its disposable Vibe children and recorded the variable in their environment names. It passed in 13.8 seconds with no findings or warnings. The diagnostic did not change the installed candidate, preparation receipt or persistent worker configuration.

## Existing quality pack

| Task | Outcome | Seconds | Model calls | Tokens | Previous seconds / calls / tokens |
| --- | --- | ---: | ---: | ---: | --- |
| review-stock | 4/4 | 46.7 | 2 | 19,987 | 18.5 / 3 / 19,984 on the last 3.1.3 review |
| review-total | 9/9 | 75.4 | 4 | 38,500 | 40.5 / 2 / 20,409 |
| edit-shipping | 14/14 | 11.9 | 4 | 29,997 | 12.0 / 4 / 30,195 |
| edit-reserve-all | 17/17 | 21.8 | 7 | 60,591 | 21.9 / 7 / 60,549 |

All four runs ended with `end_turn`. Both reviews read exactly their three named files. Both edits passed the supervisor contract and independent checker. The single review samples were slower and total-review token use rose. The [earlier trial](../vibe-313-model-pin-20261118/README.md) already showed substantial review variability, so the comparison does not isolate the impact of removing project context.

## Stock-export edit

| Sample | Independent tests | Assessment | Seconds | Model calls | Tokens |
| --- | --- | --- | ---: | ---: | ---: |
| 1 | 19 passed | Accepted | 27.8 | 10 | 110,216 |
| 2 | 20 passed | Rejected, execution failed | 343.4 | 13 | 143,762 |
| 3 | 13 passed, 9 failed | Rejected | 84.3 | 23 | 427,008 |
| 4 | 17 passed, 2 failed | Rejected | 207.0 | 14 | 224,272 |
| 5 | 19 passed | Accepted | 60.5 | 16 | 240,938 |

Three out of five patches passed the independent checker. Two out of five runs passed end to end. Samples 1, 3, 4 and 5 ended with `end_turn`.

- Sample 2 emitted `turn_retrying` and eventually failed with `VSUP_BACKEND_ERROR`. The worker's detail was “The model stopped producing output for 120 seconds and the call was stopped.” Verification stayed incomplete despite the passing exported patch.
- Sample 3 used `outDir` as the `parseArgs` option key, so the documented `--out-dir` was rejected. The patch also added trailing whitespace.
- Sample 4 recovered from a retry. Its worker test expected a malformed string literal instead of a newline before the second CSV row.
- Sample 5 had one denied edit call and still passed all checks.

The five-run sample used the repository's brief as written. No separate stand-in study was run for that brief.

## Correction from the rejected patch

Run `f77b619d-206b-4f5e-ac25-7e5578dbd8da` started from unreferenced commit `987efaabcc477fe100ad1bc0634b0e8cbbd3becb`, assembled from the previous rejected correction in a private index. Its contract allowed changes only to the exporter and focused test file. Both patches were applied to a separate validation copy. Correction patch SHA-256 `24df4710b199a25363c9de8b01a7d62b3202f9488dddfc471294bf100294f99e`. The export checksums matched.

The worker hit `turn_limit` at 25 model calls in 61.4 seconds and used 670,096 tokens. The earlier correction from the original base took 84.7 seconds and 18 calls. The supervisor passed its contract check after the audited turn limit, and independent type checking, lint, whitespace and the three baseline tests passed. The coordinator rejected the combined patch after four of eight focused tests failed. The exporter now parsed the flag and reached an undefined `source_sha256` reference. The tests also wrote a snapshot before creating its parent directory and searched stdout for a failure message on stderr. The previous `mkdtempSync()` setup failure was resolved.

The in-flight install check, newer agy refresh and native Codex approval prompts from the previous trial remain open.
