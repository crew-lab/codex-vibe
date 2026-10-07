# Turn-limit and saved-result corrections — 2026-10-07

Both defects are corrected in the isolated rc.7 checkout. **The original hosted soak still fails:** the first broad review reaches the unchanged 12-turn limit. The patched supervisor truthfully returns `completed` with `stop_reason: max_turn_requests` and an incomplete-result warning; the soak rejects that partial result instead of accepting it as a normal finish. The 100-run release gate remains unverified.

## Implementation

- Programmatic completion drains queued stdout/stderr and the final unterminated streaming entry on every exit. The pinned turn-limit outcome is recognized only when exit code 1, no signal, the final assistant stop marker, the standalone stderr marker and the configured turn count all agree. Marker-only assistant output, stderr-only markers, a different turn count, another exit code or an additional authentication/error message keep ordinary completion/failure handling. The partial summary describes the limit and does not present the marker as a final answer.
- Settlement attaches the outcome error before artifact writing and updates it again if artifact finalization converts completion into failure. Saved `result.json` now serializes that structured error through the existing sanitizer, including failure/cancellation fallback paths. Its schema declares the optional error object. Successful saved results omit error.
- Seven process-backed exit cases cover the marker agreement and spoof/conflict cases. Existing settlement scenarios now compare saved and live errors for launch failure, backend failure, deadlines, output limits, policy failures, cancellation and artifact-finalization failure. No dependency, pin, profile, tool permission or automatic application/replay behavior changed.

[implementation.patch](implementation.patch) contains the code, schema, tests and behavior documentation diff against `f30f8d7`. [verification.json](verification.json) records source hashes; all source changes are uncommitted in the managed checkout. The primary checkout's runtime files were not changed.

## Verification

- Targeted suites: 77 passed across failure reporting, settlement, stop reasons and storage faults; see [regressions-after.log](regressions-after.log). Before implementation, the turn-limit and missing-saved-error assertions failed. [regressions-before.log](regressions-before.log) also contains one temporary test-fixture auth expectation mismatch, corrected to the existing recognized HTTP 401 form; that was not a runtime defect.
- Full `package:rc`: lint, typecheck, build, 603 tests in 53 files, both real installed-Vibe profile tests, the Python suite, acceptance, secret scan, SBOM and offline installed-package MCP smoke passed. See [package.log](package.log). Checksums verified.
- Patched tarball SHA-256: `6e444fc3769d4a39114fe3fd8e4c13e84c018c59e74197b2287f16bc94f4f1bd`. It retains version `0.9.0-rc.7`; it is a local patched validation build, not an upstream release. The original package is preserved under `release/rc7-before-turn-limit-fix-2026-10-07/` in the managed checkout. The patch and behavior docs were in the tested tarball; this historical evidence was added afterwards and is excluded from packaging.
- Installed patched server: a missing-executable failure's saved result has exactly the same error object as its MCP reply, including code/remedy/details. See [fixed-saved-error-check.json](fixed-saved-error-check.json) and [local-failure-checks-fixed.json](local-failure-checks-fixed.json). These checks used no model inference.

Commands:

```sh
VIBE_SUPERVISOR_TEST_NPM_CACHE=/private/tmp/codex-vibe-rc2-npm-cache VIBE_SUPERVISOR_TEST_VIBE_PYTHON=/Users/roman/.local/share/uv/tools/mistral-vibe/bin/python3 npm run package:rc
npm install --offline --ignore-scripts --cache /private/tmp/codex-vibe-rc2-npm-cache --prefix /private/tmp/rc7-phase-d-zotf2wpq/install-fixed /Users/roman/.codex/worktrees/rc7-target-tests/codex-vibe/release/vibe-supervisor-0.9.0-rc.7.tgz
VIBE_SUPERVISOR_HOME=/private/tmp/rc7-phase-d-zotf2wpq/home node scripts/soak.mjs --workspace /private/tmp/rc7-phase-d-zotf2wpq/workspace --reviews 60 --edits 30 --acp 10 --out /private/tmp/rc7-phase-d-zotf2wpq/hosted-soak-fixed-original --server-command node --server-arg /private/tmp/rc7-phase-d-zotf2wpq/install-fixed/node_modules/vibe-supervisor/dist/cli.js --server-arg serve --server-arg --stdio --start-wait 0 --wait-seconds 60 --run-timeout 300 --stop-on-fail --yes
```

## Hosted retry

Run `d9ce1a35-e7c4-43d4-b619-32383d3353af`, built-in `review-bug-class`, reached its limit in about 15.2 seconds. The live and [saved result](result.json) report `max_turn_requests` with the warning. [summary.json](summary.json) reports FAIL with `driver:stop_reason_max_turn_requests`, one attempted run, zero permission requests, no leaked processes or worktrees and bounded artifacts. The driver was not changed, limits were not raised, and tasks/seed/workspace remained identical. Full evidence: [runs.ndjson](runs.ndjson), [events](events.ndjson), [driver log](soak-driver.log).

Public native tool responses show successful permitted reads/searches, repeated grep searches that treat filename extensions as content, and refused attempts to call unavailable `bash`. These are worker task/tool-use failures, not evidence to enable shell or weaken the profile. Hidden reasoning and full private histories were not copied. A subsequent bounded-task soak would be a separately described test plan; it must not be substituted for this failed original plan without explaining the scope change.

## Remaining work

Both implementation defects are resolved and verified. The remaining immediate release blocker is reliable normal completion of the broad review within its declared budget. Scope the synthetic soak tasks explicitly to the available file tools and known fixture paths, or make a deliberate documented budget decision; preserve this failed attempt and rerun the full plan. No limits, tasks, permissions or release acceptance criteria were changed here.

The earlier scoped ACP tests remain valid; native desktop restart adoption, tool-result/progress visibility, long waits in native clients, callbacks/selected reject, cancellation after generated output, clean-account installation and Intel remain unverified. No commit, push, user-global configuration change or upstream release was made. The managed checkout and private test artifacts are retained for review.

## Cleanup

[Cleanup evidence](cleanup.json) confirms all 18 saved test runs are closed, no test-owned worker/server or owner lock remains, the synthetic source is clean, and its registry has only its primary checkout. Source and package artifacts remain available for investigation; unrelated processes were not stopped.
