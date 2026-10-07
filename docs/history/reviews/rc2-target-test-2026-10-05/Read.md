# rc.2 target-machine test — 2026-10-05

Tested GitHub commit `6b49782` (`vibe-supervisor@0.9.0-rc.2`) in an isolated archive at `/private/tmp/codex-vibe-rc2-test`. The original checkout and its existing changes were preserved. No user-global configuration, registration, hosted inference, commit, or push was performed.

Environment: macOS 27.0.1 arm64, Node 24.21.0, Git 2.54.0 (Apple Git-157), Vibe 2.25.8, Codex CLI 0.160.0. Vibe Python: `/Users/roman/.local/share/uv/tools/mistral-vibe/bin/python3`.

## Results

- **PASS:** `npm run verify:release`: lint, typecheck, build, 179 TypeScript tests across 16 files, 51 Vibe-free Python tests, deterministic acceptance, secret scan, and SPDX inventory. See [verification.log](verification.log).
- **PASS:** `npm run compat:probe -- --out /private/tmp/codex-vibe-rc2-compat.json`: installed Vibe version, real ACP initialization, advertised session loading, installed logger fixture, and shim version consistency. See [compat.json](compat.json). MANUAL entries remain unverified.
- **FAIL (B1):** installed `vibe.core.tools.utils.resolve_path_permission`, using canonical temporary paths and rc.2's `[root, root/**]` allowlist: immediate file `always`; nested `src/a/b.ts` has no grant and falls back to `never`. Root `.env` is `never`; outside and symlink-to-outside have no grant. See [path-results.json](path-results.json). This checks the stock resolver, not a hosted tool invocation.
- **UNVERIFIED:** fresh install and offline packaging. `npm ci --offline --cache /Users/roman/.npm` failed with ENOTCACHED for Zod 4.6.5. The historical cache path is absent. Verification instead used the checkout's existing `node_modules` through a symlink; the remote lockfile differs only in root package version, with identical pinned dependencies. This does not prove clean installation.

Per the field plan's stop-at-first-failure rule, hosted testing stopped before T6. B2 real Keychain lookup, B3 effective agent permissions, hosted review/edit, continuation/recovery, desktop registration, plugin installation, hosted soak, Intel, and clean-account installation remain unverified. No run IDs exist because no hosted run started.

Next action: correct B1 against the pinned installed resolver and verify B3's configuration layering, then repeat the path tests before hosted work. The candidate was tested without applying its changes to local main.

## Installation and first-use setup

The user subsequently authorized installation and use. Installed the unchanged rc.2 package from commit `6b49782` at `/Users/roman/.local/share/vibe-supervisor/rc2/node_modules/vibe-supervisor`. The source checkout remains at its original revision with existing user changes intact.

- **PASS:** fresh `npm ci --cache /private/tmp/codex-vibe-rc2-npm-cache`, including the prepare build. This supersedes the earlier fresh-install limitation on this account; it is not a clean-OS-account test.
- **PASS:** `VIBE_SUPERVISOR_TEST_NPM_CACHE=/private/tmp/codex-vibe-rc2-npm-cache npm run package:rc`, after explicitly populating missing package metadata via a temporary online tarball install. The first offline smoke attempt failed ENOTCACHED for ACP SDK registry metadata; no silent network fallback occurred. The second package run passed full release verification and offline installed-package MCP smoke. See [package.log](package.log).
- **PASS:** `shasum -a 256 -c SHA256SUMS`. Package SHA-256: `308dc5cb53657b3e0af16c7340eb78c56e05ed3611fd4b542372d38c9c06956a`. See [SHA256SUMS](SHA256SUMS).
- **PASS:** durable installation used `npm install --offline --ignore-scripts --omit=dev --cache /private/tmp/codex-vibe-rc2-npm-cache --prefix /Users/roman/.local/share/vibe-supervisor/rc2 <verified-tarball>`.
- **PASS:** backed-up user registration through the installed `configure-codex --user`. `codex mcp get vibe-supervisor` reports enabled, stdio, installed CLI path, and 600-second tool timeout.
- **PASS:** official MCP client launched the command from the actual Codex configuration, discovered all eight tools, called status for an unknown UUID and received the expected error, then closed the connection. See [installed-connection.json](installed-connection.json). This does not establish tool visibility in this already-open Codex chat.
- **PASS:** installed `doctor --json` reports `ok: true`; auth and desktop visibility remain explicitly unverified. See [installed-doctor.json](installed-doctor.json).

Both configuration backups were created on 2026-10-05: `~/.codex/config.toml.bak-2026-10-05T18-29-32-886Z` and `~/Library/Application Support/VibeSupervisor/config.toml.bak-2026-10-05T18-29-32-645Z`. Preserved the existing workspace root and added only `/Users/roman/.local/share/vibe-supervisor/field-workspace`, a dedicated local Git repository with synthetic README.md and src/a/add.js files. Explicit Vibe and ACP executable paths were added. No credential was read, printed, or copied by installation.

Dependency audit reports moderate and critical advisories in development-only `@vitest/mocker` and `vitest`; these packages are absent from the runtime installation. Pinned versions were not changed. See [dependency-audit.json](dependency-audit.json).

**First hosted use is pending explicit payload approval.** Automatic approval review rejected launching the proposed review because it would send local source to Mistral and judged the general instruction to use the supervisor insufficient authorization for that specific transfer. The hosted command did not execute; no hosted run or run ID exists. Asked the owner to approve only the two synthetic files for one bounded review through existing browser login, with possible provider usage. No workaround was attempted. B1 and B3 remain unresolved, and hosted edit use remains unverified.

## Approved first hosted use — 2026-10-05

The owner explicitly approved the pending review. This supersedes the pending-approval status above. Ran one bounded programmatic review of README.md and src/a/add.js in the synthetic fixture; no edit or subsequent hosted replay was attempted.

The initial official-client connection closed before tool discovery or starting a run. The shared application data directory contained a supervisor owner lock. Retained that lock and used independent private test storage at `/private/tmp/codex-vibe-rc2-approved-use-wXrnJM`, with only the fixture repository allowlisted. This does not prove that the existing owner's process caused the connection failure, since its startup stderr was not captured. The installed package and original HOME context were retained; `MISTRAL_API_KEY` was omitted from the supervisor environment.

Run: `0c196301-5a37-4136-885d-78b735ef8472`. Task requested reading both files, identifying the arithmetic bug with a file reference, and reporting any denial without guessing. Limits: 4 turns, 120 seconds, 45-second start wait. The run entered `failed` with `VSUP_BACKEND_CRASHED` after Vibe exited 1 and emitted `Turn limit of 4 reached`; it was explicitly closed. Source integrity was verified and no source changes were exported. See [first-hosted-use.json](first-hosted-use.json).

- **PASS, hosted authentication and generation:** the private Vibe session recorded actual assistant tool calls and token usage without an exported API key. This establishes generation through the normal private launcher in this environment, but does not certify a separate live Keychain diagnostic or every possible credential-resolution source.
- **PASS, recorded review inventory:** only `grep` and `read_file` were available, agent `plan`. Attempted `bash` fallbacks returned `Unknown tool 'bash'`; no shell execution was enabled. Edit inventory remains unverified.
- **FAIL, B3 review agent layering:** both requested `read_file` calls returned `Tool 'read_file' is permanently disabled`. The saved effective configuration shows Plan replaced the read allowlist with the private `vibe-home/plans/*` path instead of the fixture root.
- **FAIL, B1 nested search:** `grep` succeeded for the immediate README but was permanently disabled for nested src/a/add.js. It retained the legacy `[root, root/**]` grant.
- **FAIL, useful review outcome:** no diagnosis of the arithmetic bug was delivered. The public transcript contains only the stop marker. The detailed tool failures were available in the filtered private session records, not in the compact supervisor result. See [tool-outcomes.json](tool-outcomes.json).

Observed model: `mistral-medium-3.5`, not an assumed Devstral model. Session-reported usage: 15,634 prompt tokens (13,312 cached), 432 completion tokens, 16,066 total. Session-reported estimated cost: USD 0.0087198; this is Vibe metadata, not a verified bill. See [session-evidence.json](session-evidence.json). No Codex token-saving measurement was performed.

The next useful development step is to fix both the nested grant and the Plan override using mechanisms supported by pinned Vibe 2.25.8, with resolver and effective-configuration regression checks. Raising the turn limit would not address either denial. Hosted edit, correction/continuation, recovery, soak, and desktop-native tool invocation remain unverified.

## Permission fix and successful review — 2026-10-05

The owner requested fixing the defects. `src/backends/profile.ts` now emits `vibe-path:directory_recursive:<root>` and writes owner-only private agent definitions using Vibe 2.25.8's supported built-in shadowing mechanism. The generated Plan and Accept Edits definitions keep environment path restrictions and `never` file-tool fallbacks; no user/project profile, global write grant, shell tool, or network tool is enabled. Agent definition paths refuse symlinks and regenerate on recovery.

The same focused source change is present in the original local checkout and in the isolated rc.2 test tree. The checkout was not fast-forwarded, so its unrelated local work and older package revision are preserved. [permission-fix.patch](permission-fix.patch) contains the changes against GitHub rc.2 commit `6b49782`, including tests and behavior documentation. No commit or push was performed.

- **PASS:** local checkout release verification: 54 tests across 8 files, lint, typecheck, build, acceptance, secret scan, and SPDX generation. See [permission-fix-main-verification.log](permission-fix-main-verification.log).
- **PASS:** patched rc.2 packaging: 184 tests across 17 files, the Vibe-free Python suite, lint, typecheck, build, acceptance, secret scan, SPDX, offline installed-package MCP smoke, and checksums. See [permission-fix-package.log](permission-fix-package.log) and [permission-fix-SHA256SUMS](permission-fix-SHA256SUMS).
- **PASS:** both runs explicitly set `VIBE_SUPERVISOR_TEST_VIBE_PYTHON` so the new installed-runtime tests actually executed. The network-disabled fixture loads the real private agent definitions through the installed AgentManager and config layers, then checks the installed file resolver for read/search and edit/write tools. It verifies ordinary files at several depths, root and nested secrets, reserved paths, outside/sibling paths, and an outside symlink. Other tests check private permissions, regeneration, and refusal of a symlinked agent file.

Installed the patched build alongside the original at `/Users/roman/.local/share/vibe-supervisor/rc2-permission-fix/node_modules/vibe-supervisor`. It retains package version `0.9.0-rc.2` but is a local patched build, not a new published release. Tarball SHA-256: `df769930b6160c103ba8f0ba310588af38c2f9d462f71189ddbcda948dccb64d`. Updated Codex's server entry to that CLI with backup `~/.codex/config.toml.bak-2026-10-05T21-09-35-805Z`; the existing running server was not killed. Reload/restart Codex to activate the updated entry.

Repeated a fresh bounded hosted review on the same approved two synthetic files, using independent storage `/private/tmp/codex-vibe-rc2-fixed-use-Depobr`. Run `d879d0a5-dba1-4c0b-9974-6d39eae87b32` **completed**, read both files successfully, identified `a - b` as the bug, and recommended `a + b` at src/a/add.js:1. No files changed, source integrity was verified, and the run was closed. See [fixed-hosted-use.json](fixed-hosted-use.json).

The authenticated session confirms only grep/read_file were available and both effective grants used the encoded recursive policy with `never` fallback. The model also attempted write_file, which returned `Unknown tool 'write_file'`; this confirms the attempted write did not execute. No valid tool call was rejected by the permission policy. See [fixed-session-evidence.json](fixed-session-evidence.json).

Model: mistral-medium-3.5. Session-reported usage: 12,122 prompt tokens (2,048 cached), 738 completion tokens, 12,860 total; estimated USD 0.0209532. The successful run used fewer tokens than the failed run but cost more according to Vibe's metadata because much less input was cached. These two observations do not establish Codex token or total-cost savings. Hosted edit, ACP continuation/recovery, soak, platform gates, and desktop-native tool visibility remain unverified.

## Native Codex chat after restart — 2026-10-05

After the owner restarted Codex and requested another test, all eight registered `mcp__vibe_supervisor__vibe_*` tools appeared in this chat. Invoked the native review-start, result, and close tools directly, without a separate SDK client or test server. The registered entry points to the local permission-fix installation.

Run `958f15a5-93bb-48cd-8312-4c9ce3f9cdab` **completed** in approximately 15 seconds using normal application storage. The review was restricted to the same approved synthetic README.md and src/a/add.js. It correctly identified subtraction instead of addition at src/a/add.js:1 and suggested the smallest correction. Source integrity was verified, no file changes were reported, and close returned `closed`. See [desktop-hosted-review.json](desktop-hosted-review.json).

Private session records confirm two successful tool calls, no failed/rejected tool calls, and the expected grep/read_file inventory. Model: mistral-medium-3.5; 7,888 prompt tokens (5,120 cached), 482 completion tokens, 8,370 total; session-reported estimated USD 0.008535. See [desktop-session-evidence.json](desktop-session-evidence.json). This measures Mistral usage, not Codex usage or billing.

Desktop registration, native tool visibility, and the hosted programmatic review path are now verified for this local patched build on this account. Visibility of all eight tools does not prove successful native execution of edit, continuation, response, or cancellation. Those gates, hosted ACP soak, plugin installation, Intel, and clean-account installation remain unverified.

## Hosted edits and live continuation — 2026-10-05

The owner requested testing hosted edits too. Used native Codex MCP calls for two bounded runs against the synthetic fixture at HEAD, with shell disabled. Patches were inspected and never applied to the original fixture. See [desktop-hosted-edits.json](desktop-hosted-edits.json).

- **PASS, programmatic edit:** run `0644977e-82c7-4fa3-ac6f-f47beb8a88ee` completed and exported only the requested one-character arithmetic fix in src/a/add.js. Independently checked exact file contents and four arithmetic cases (positive, negative, zero, fractional), confirmed source remained clean/unchanged, then closed with verified worktree cleanup. The patch SHA-256 is `633c993061687ed4578337fb5117deb3c546bbc53863389c4827d8b14282c784`.
- **PASS, ACP edit:** run `d00fe37d-8c7f-4500-b0c1-6285b678ab2e` completed its initial turn with the same minimal fix.
- **PASS with turn-limit caveat, live ACP continuation:** continued the same run and worktree, requesting one exact README example line while preserving the implementation. The exported patch contains exactly both requested changes. Verified the README addition and four arithmetic cases, and confirmed the original repository remained clean/unchanged. This follow-up stopped with `max_turn_requests` at the six-turn budget instead of a normal final answer; the manager still reports `completed` and a generic success summary. The stop reason and independently verified artifact, rather than that summary, establish what was achieved. No restart/replay occurred.
- **PASS, cleanup:** both runs closed with `cleanup_worktree: true`; independently confirmed both directories and their Git worktree registrations were removed. Private session/artifact evidence remains under retention.

Both authenticated edit sessions recorded only edit, grep, read_file, and write_file, with agent accept-edits; no shell/network/MCP tool was available. All valid tool calls succeeded without policy rejection. See [desktop-edit-session-evidence.json](desktop-edit-session-evidence.json). Programmatic session usage: 13,041 total tokens, estimated USD 0.0078483. ACP edit plus continuation: 22,706 total tokens, estimated USD 0.0329994. Combined estimated Mistral cost is USD 0.0408477, based on Vibe metadata rather than a verified bill. No Codex usage measurement was performed.

Hosted edit/export/source isolation/cleanup and one live ACP continuation are now demonstrated for the local patched build. Cancellation, permission/input callback handling, restart/load recovery, idle expiry, hosted 100-run soak, plugin installation, Intel, and clean-account gates remain unverified.
