# rc.7 target-machine tests — 2026-10-07

Result: **not ready for 1.0**. Release verification and targeted hosted tests passed, but D18 stopped on its first run. Vibe emitted `<vibe_stop_event>Turn limit of 12 reached</vibe_stop_event>` and exited 1; the supervisor classified it as `VSUP_BACKEND_CRASHED` with no stop reason. The 100-run hosted soak remains unverified. No runtime correction, commit, push, global configuration change or upstream release was made.

The primary checkout had unrelated uncommitted edits and was left intact. Fetch advanced origin/main to `f30f8d74be9d442b5c315b51dc4e5c3cf5722757`. Tests used a detached managed checkout of that commit. The tarball was rebuilt locally for these tests; it is not evidence of downloading or verifying upstream release assets.

## Environment

| Item | Value |
|---|---|
| Platform | macOS 27.0.1 (26A434), arm64 |
| Node / npm / Git | 24.21.0 / 11.19.0 / 2.54.0 Apple Git-157 |
| Vibe / interpreter | 2.25.8 / /Users/roman/.local/share/uv/tools/mistral-vibe/bin/python3 |
| Codex CLI / desktop | 0.160.1 / unavailable from the checked app bundle path |
| Tested commit | f30f8d74be9d442b5c315b51dc4e5c3cf5722757 |
| Rebuilt tarball SHA-256 | 90cebe96a6df1b6a4b1b249fd9e99e808895e5b9f823c1ee9140ed842b8408c2 |
| Offline npm cache | /private/tmp/codex-vibe-rc2-npm-cache |
| Private test root | /private/tmp/rc7-phase-d-zotf2wpq |
| Synthetic source base | 79c00925ea88aa0c1cdd96f4cb1ccd6a54f58d2c |
| Hosted model | mistral-medium-3.5, read from native session metadata |
| Authentication | Parent MISTRAL_API_KEY absent; existing browser-login credential worked through the private runtime. Credential values were never read into the test harness. |

The synthetic Git repository has `src/nested/arithmetic.py` with an intentional subtraction bug, a fake ignored `.env`, ignored `node_modules/fixture/index.js`, an outside text marker, and a tracked symlink to that outside marker. No real project source was delegated. Export verification applied the patch only to another synthetic clone.

## Verification

`npm ci --offline --cache /private/tmp/codex-vibe-rc2-npm-cache` passed including prepare/build. `VIBE_SUPERVISOR_TEST_NPM_CACHE=/private/tmp/codex-vibe-rc2-npm-cache VIBE_SUPERVISOR_TEST_VIBE_PYTHON=/Users/roman/.local/share/uv/tools/mistral-vibe/bin/python3 npm run package:rc` passed lint, typecheck, build, 596 tests in 53 files (including both real installed-Vibe resolver tests), the Python suite, acceptance, secret scan, SBOM and offline installed-package MCP smoke. SHA256SUMS verified. See [package.log](package.log), [source-install.log](source-install.log) and [compat.json](compat.json).

D1 installed the rebuilt tarball with `npm install --offline --ignore-scripts --cache /private/tmp/codex-vibe-rc2-npm-cache --prefix /private/tmp/rc7-phase-d-zotf2wpq/install <rebuilt-tarball>`. Setup used `VIBE_SUPERVISOR_HOME=/private/tmp/rc7-phase-d-zotf2wpq/home` and `setup --workspace /private/tmp/rc7-phase-d-zotf2wpq/workspace --codex project`, then `--yes`, then `--yes` again. The plan left project Codex config absent; repeat preserved its mtime. See [install.log](install.log), [installed-setup-plan.log](installed-setup-plan.log), [setup-write.log](setup-write.log), [setup-repeat.log](setup-repeat.log), and [doctor.json](doctor.json).

## Phase D outcomes

| ID | Result | Evidence and scope |
|---|---|---|
| D0 | PARTIAL | Environment and rebuilt tarball recorded; desktop bundle version unavailable. |
| D1 | PASS | Offline install into a private prefix prints rc.7; checksums pass. |
| D2 | PARTIAL | Project-scoped plan/write/repeat and doctor pass; user-global registration was not changed. |
| D3 | PARTIAL | Official MCP client sees five programmatic and seven ACP tools; desktop restart not exercised. |
| D4 | PASS | Five automatic probe checks and both installed Vibe resolver/layering tests pass. |
| D5 | PARTIAL | Two hosted nested reviews finish end_turn with verified integrity; official client rather than native Codex. Driver adds a result call for usage (four calls, not three). |
| D6 | PARTIAL | Live edit launcher had no task in argv and consumed prompt file; manifests 0600, public/native records omit reasoning fields. Scope is the observed launcher, not every process. |
| D7 | PARTIAL | Real content change detected. Combined tracked touch/ignored rewrite reports only node_modules/fixture/index.js. Original plan expectation failed; ignored stat comparison is intentional. No large-tree timing. |
| D8 | PASS | Eleven-file patch applies, four arithmetic cases pass, source unchanged, worktree_removed true. |
| D9 | PASS | Hosted ACP same-session continuation reaches end_turn. |
| D10 | PASS | Additional test observes running before close; final closed, verified integrity, no backend failure. Result has no stop_reason; cancellation after generated output remains untested. |
| D11 | PASS | Completed session reloads; separate restart after live tool use becomes recoverable and reloads to end_turn. Graceful restart, not SIGKILL. Early negotiation interruption correctly returns VSUP_SESSION_NOT_RESUMABLE. |
| D12 | PASS | 60-second TTL, observed idle_expired after 65 seconds, continuation reloads to end_turn. |
| D13 | PASS | Actual tool refusals for outside path and fake .env; unknown write_file in review; allow_shell rejected; source verified and zero permission requests. |
| D14 | PARTIAL | Offline installed-package smoke passes concurrent isolated clients; native desktop/CLI adoption not exercised. |
| D15 | PASS | Second shared client names owner PID/lock path; missing executable reports VSUP_VIBE_NOT_FOUND. |
| D16 | PARTIAL | Official client accepts wait_seconds 300 with 600-second request timeout; native desktop/CLI deadline and model-visible reply/progress content remain unverified. |
| D17 | PARTIAL | Doctor 1422 ms; import vibe wall 20 ms (cumulative import 5746 us); metadata-only Keychain lookup 8 ms. No large-tree/export timing. |
| D18 | FAIL | Stopped on run 1/100: 12-turn limit, exit 1, VSUP_BACKEND_CRASHED. No leaked processes/worktrees, no permission requests, bounded artifacts. |
| D19 | SKIP | Optional; legacy harness is the supported scope. |
| D20 | SKIP | Clean OS account and Intel hardware unavailable in this session. |

## Hosted evidence

- [Cold/warm review records](hosted-reviews/runs.ndjson): `9158336b-3667-4176-b7f3-121fc2b5f9fd` / `db4945ca-c8e2-4669-ad24-cb2c900e13e9`. Settled reply observed after 8866 / 3801 ms. First-event observation occurred after settlement because the start call waited; these are not true streaming first-token latencies. Both diagnosed the nested arithmetic bug accurately.
- [Edit and ACP records](hosted-edit-acp/runs.ndjson): edit `fbcd85d0-42a8-4099-bcd3-63ecf7f37dec` completed in 12128 ms; live continuation `c826be43-ad78-4c52-9bf1-a3a25a6550c9`; completed-session restart `02a83f1a-6cbe-4496-9ba5-43892f98b64e`. See [independent patch verification](edit-patch-verification.json).
- [Targeted integrity records](target-checks.json): content-change run `4f516c98-cb85-4fac-a081-7c920127ecf3`; combined tracked touch / ignored rewrite `edee8c86-9871-4b7e-aca2-d31391356a28`. The latter failed the original D7 expectation, not the runtime contract. `docs/functionality.md` and `tests/unit/workspace-snapshot.test.ts` explicitly require an ignored-file stat change to count as changed. Handoff D7 was corrected accordingly, with no runtime/policy change. The first test session stopped and subsequent tests resumed after this diagnosis.
- [Explicit ACP tests](acp-target-checks.json): idle expiry/reload `8d1550c6-6f2e-4b56-9534-b5a09f69df92`; close observed in running state `9425bc7d-539b-41b6-8d33-f8d8b11615b4`; policy probes `ed5b37c8-c7bd-48a7-90a6-64bdca9fb9c0`. Outside and `.env` reads returned permanently disabled; write_file was unknown. A temporary test-harness variable error was corrected before this successful session; it was not a supervisor defect.
- [Restart after live tool use](restart-running-check.json): `011a37f7-ffca-49a8-a67e-59db1fa978e7`, startup 98 ms, recoverable, explicit continuation reloaded and reached end_turn. The separate driver negotiation interruption returned VSUP_SESSION_NOT_RESUMABLE and is not evidence of loading a started prompt.
- [Local failure checks](local-failure-checks.json): owner lock error names PID/path; missing executable has the expected code. A sandboxed attempt could not observe the owner correctly; the recorded result is the successful unsandboxed check.
- [Authenticated inventories](session-inventory.json), [live argv/prompt check](live-argv-prompt-check.json), [authentication context](auth-context.json), [measurements](measurements.json), [doctor timing](doctor-timing.json), and [machine-readable session](session.json).

Only selected/redacted public evidence and a narrow native-session inventory were copied. Full private histories, environment values, provider credentials and reasoning text are excluded. Private test homes remain under the test root for investigation; all owned clients and runs were closed.

## D18 failure and next action

The soak plan and outcome are recorded in [driver.log](hosted-soak-100/driver.log). The exact command was:

```sh
VIBE_SUPERVISOR_HOME=/private/tmp/rc7-phase-d-zotf2wpq/home node scripts/soak.mjs --workspace /private/tmp/rc7-phase-d-zotf2wpq/workspace --reviews 60 --edits 30 --acp 10 --out /private/tmp/rc7-phase-d-zotf2wpq/hosted-soak-100 --server-command node --server-arg /private/tmp/rc7-phase-d-zotf2wpq/install/node_modules/vibe-supervisor/dist/cli.js --server-arg serve --server-arg --stdio --start-wait 0 --wait-seconds 60 --run-timeout 300 --stop-on-fail --yes
```

Its requested mix was 60 programmatic reviews, 30 programmatic edits and 10 ACP runs, with start wait 0, status wait 60, per-run timeout 300 and stop-on-fail. It used the installed rc.7 CLI and the private synthetic allowlist, through the official MCP client.

[summary.json](hosted-soak-100/summary.json) reports FAIL, stopped_early, one attempted review and zero successful runs. Run `12ad387d-307c-420c-a123-63da3d0e17e3` used built-in task `review-bug-class`, hit the 12-turn cap after 27.4 seconds, and was closed. It sent no permission requests and left no leaked processes or worktrees. See [failure detail](soak-failure-detail.json) and [events](soak-failure-events.ndjson). The persisted result says failed without its error field; the saved run meta and MCP replies retain VSUP_BACKEND_CRASHED. Investigate both the programmatic turn-limit classification and persisted-result error completeness before the next candidate. Do not relabel this attempt as a successful soak or silently raise limits to mask it.

Recommendation: continue with rc.8 validation after resolving the failure and rerun the full soak. Current native desktop setup/tool visibility, model-visible reply/progress format, long waits in both native clients, clean-account installation and Intel remain unverified. Permission/elicitation callbacks and real behavior after a selected reject remain unverified because normal hosted runs had zero requests. The supported harness remains legacy only.

## Final evidence checks

Local documentation-link validation passed; `git diff --check` and the secret-pattern scan passed after evidence was saved. [Cleanup evidence](cleanup.json) confirms 16 saved runs are closed, no test-owned process or owner lock remains, the synthetic worktree registry contains only its primary checkout, and its source status is clean. The managed source checkout, rebuilt package and private synthetic test root are retained for investigation. Temporary test harnesses are archived as `.mjs.txt` evidence; their original executable files remain in the private test root.
