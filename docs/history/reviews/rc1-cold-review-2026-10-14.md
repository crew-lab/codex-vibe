# Cold review of 1.0.1-rc.1 (2026-10-14)

Range `31f3ceb..c55ed4f` (PR #7): the effective tool inventory check and the optional worker diagnostics. An independent reviewer read only the runtime and test diff, with no design context. The preparing machine checked each finding against the code and added the packaging and evidence findings. Vibe 2.26.1 is not installed here, so nothing below about Vibe's own code is verified. No runtime change was made; every finding is for the owner to schedule.

## Confirmed

The startup checks fail closed whether or not diagnostics are enabled. An unknown agent, a malformed or mismatched `VIBE_ENABLED_TOOLS`, or drift in the pinned source hashes or signatures raises before the entrypoint runs. No secret or path leaks were found in the diagnostics; they record only known tool names, `<other>`, and outcomes, with no arguments or results, and stay within 64 KiB.

## Findings

| # | Severity | Where | Finding |
|---|---|---|---|
| P1 | Medium | `package.json` `files` | `docs` ships everything except `docs/history`. PR #7 added `docs/reviews/` (2.0 MB of hosted results, patches, logs, and the scripts `inspect.py` and `vsup_perf_*`). The frozen rc.1 archive already contains two of those files, and any new build would ship them all. Fixed on this branch with `"!docs/reviews"`. |
| P2 | Medium | `docs/reviews/` | The repository is public. 50 evidence files contain absolute paths under the target account's home directory, and 83 name the private test project. Earlier evidence replaced these with placeholders. Redacting them is the owner's call: it rewrites recorded evidence, and history still holds the originals. |
| F1 | Low | `src/core/run-manager.ts:1215-1225` | The diagnostics file is optional, but a symlinked or non-file `worker-diagnostics.json`, or an `lstat` error other than ENOENT, throws. That aborts `writeArtifacts`, and a completed run loses its transcript, events and patch listing ("Run artifacts could not be finalized"). An oversized file is only skipped with a warning; an unsafe one should be handled the same way. Separately, the size comes from `lstat` but the file is read again, so growth in between can raise `VSUP_OUTPUT_LIMIT` for the whole run. Reaching this needs a write into the run directory, which the worker's tools cannot do. |
| F3 | Low | `vibe_supervisor_launcher.py:633-645` | `except Exception` does not catch `asyncio.CancelledError` or `GeneratorExit`. A cancelled tool call is therefore left as a bare `attempt`, which looks the same as a call that hung. |
| F2 | Low, unconfirmed | launcher writer (533-541) and `describeArtifact` | The writer overwrites the file in place. If finalization could run while the worker's monitor thread is still alive (timeout or cancel), the published hash could describe a half-written file. Whether finalization always waits for the child to exit was not confirmed. |
| T1 | Test gap | `tests/integration/run-manager-regressions.test.ts:85-99` | Only the artifact's presence is tested. Neither the over-limit omission nor the unsafe-file branch is exercised, so F1 or removing the size guard would still pass. |
| T2 | Test gap, dead code | `record_tool_inventory` | Names collapse to at most five values, so the 128-name cap can never be reached and `tool_inventory_truncated` is always false. The test asserts false either way. |
| T3 | Test gap | `tests/fixtures/vibe-profile-check.py:398-413` | The "unexpected tool" case changes the inventory and `enabled_tools` together. It proves the property wrapper rejects a mismatch, not that the tool list given to the model passes through that property. |

## Open question that decides fail-closed

Answered 2026-10-14 from the tag source: COVERED for tool exposure and dispatch; a built-in skill injection path remains, and rc.2 should enforce the profile at execution time. See [the answer](tool-inventory-answer-2026-10-14.md).

Does Vibe 2.26.1 build the model's tool schemas, and dispatch calls, only through `ToolManager.available_tools`? If another path exists (`_all_tools`, `get()`, or MCP tools added later), a tool outside the profile could reach the model without the check. Answer it from the 2.26.1 source on a machine with Vibe installed, before stable 1.0.1. The rest of the profile still disables MCP and connector tools, so this is a question about the new check's coverage, not a known bypass.

## Recommendation

- P1 is fixed here.
- P2 and the open question come before stable 1.0.1.
- F1 and F3 are small fixes for the next runtime candidate, which the packaging change already requires; add T1 and T2 alongside them.
- F2 needs only the answer to whether finalization waits for the child.
