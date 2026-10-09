# rc.17 target-machine installation receipt

Date: 2026-10-09, Europe/Warsaw. Scope: merge the stable strategy into main, build and verify the rc.17 release artifact, migrate existing configuration, install refreshed skills and verify initialization through a fresh official MCP client. No hosted inference or native desktop reload was performed.

## Git delivery

The strategy branch was merged with latest main at 51266b3. Remote main received merge commit 8a85832914bfb081672eb47419a4f3082909944b. The merge contains only Handoff.md, README.md and docs/v1-stable-strategy.md; it preserves the rc.17 launch-article update.

The first direct push was rejected by automatic approval review. After the coordinator supplied the earlier human commit/push authorization, checked the documentation-only diff and verified the unchanged remote base, the same normal fast-forward push was approved. No force push or alternate mutation of main was used.

The old dirty primary checkout was not updated or merged. Its existing changes remain; an additional dirty README edit observed during execution was left intact. Integration and evidence work used the clean managed worktree and private temporary build copy.

## Exact artifact identity

The preparing machine's ignored rc.17 archive was not available on the target Mac. A local rebuild used an archive of the immutable release commit ac812802badde5d398a49fbe348038dbb39fc374, without dirty overlays. Dependencies and installed-package checks used the populated offline npm cache, with no network fallback.

| Item | Identity / outcome |
| --- | --- |
| Package | vibe-supervisor 0.9.0-rc.17; private, unpublished, ESM, MIT |
| Local build | Node 24.21.0; exact release source; local offline rebuild |
| Installed archive SHA-256 | e62458562e4d9f9602235b3f21800ab20cc63c96b9be8f0cdf1b59072176ccc2 |
| Local SBOM SHA-256 | b92ec51a85f23a2d0a5ca07ca754e7fcf209d569ea347141e313475582491cc6 |
| Local acceptance SHA-256 | 180465b6368d77cdf263358c0c7b0e9a76b70aa6a5ccd32898fce3b867a08195 |
| Preparing-machine archive receipt | 5e25afc6ab0c292e6db2abf5ebaccd92b2fe957c283a34c3d0156a29e235b1b0; not the installed artifact |
| Checksum verification | All three local SHA256SUMS entries passed |
| Compiled runtime identity | All 39 JavaScript/Python files matched the installed package |

The different archive hashes are kept explicit. This receipt establishes the local rebuild's source and bytes, not byte identity with the preparing machine's artifact.

## Installation and migration

Installed prefix: /Users/roman/.local/share/vibe-supervisor/rc17.

The CLI alias now points to that prefix's node_modules/.bin/vibe-supervisor. The existing Codex MCP entry retains its absolute Node command, stdio/isolated arguments and 30/600-second startup/tool limits; only the package path and VIBE_SUPERVISOR_HOME now point to rc17.

The new template preserves backend acp, all five workspace roots and every declared limit, including max_turns_review 12 and max_turns_edit 20. No turn budget was raised. Queue capacity remains eight.

Removed obsolete keys:

- max_queued_runs
- retention.preserve_failed_runs
- phase1.allow_temporary_trust
- security.allow_shell_in_review
- security.allow_shell_in_edit
- security.allow_network_tools
- security.log_raw_acp
- security.persist_reasoning

The installed strict configuration validated and doctor returned ok=true before activation. Authentication and native registration remain explicitly unverified in the doctor report. Removed legacy knobs do not enable shell, network, raw ACP logs, reasoning persistence or project trust.

All unrelated Codex settings were parsed and compared before/after. An owner-private backup of the original Codex configuration was saved. The previous template and rc.15 installation were retained; old runs, homes and locks were not deleted or replayed.

Both global skill links now target the installed rc.17 package. All three skill/reference files matched release-source bytes:

| File | SHA-256 |
| --- | --- |
| vibe-supervisor/SKILL.md | e4921c0753bfb8ed4197a1c0540f34925288b35a86f3aa11ee274ca512ec0330 |
| vibe-acp/SKILL.md | 07b93de193a1872fa7fba33df91799fc4127018c8f73e3ed5c23373ae76b4873 |
| vibe-acp/references/verification-loop.md | 09ab791a4ddd2e90fa87a9e6100ff1f31d040890bef926eebc5cfc98da61cce7 |

## Checks actually performed

- Offline package:rc passed: lint, typecheck, build, 761 TypeScript tests passed / two opt-in tests skipped in 68 files, Python checks, deterministic acceptance, secret scan, SBOM and installed-package smoke.
- The smoke covered installed executable, initialization/tool listing, EOF shutdown and concurrent isolated MCP clients.
- Installed CLI prints 0.9.0-rc.17. Local doctor passes with pinned Vibe 2.25.8 initialization; it does not prove hosted authentication.
- A separate fresh official MCP client received server name vibe-supervisor / version 0.9.0-rc.17 and exactly seven tools: review_start, edit_start, status, result, close, continue, respond, all prefixed vibe_.
- Start schemas have no backend or allow_shell fields. A status request for a nonexistent test ID returned VSUP_NOT_FOUND.
- Client close left zero saved runs and zero owner locks in the new template's isolated session directories.

Supervisor catalog digest: 90f0eb2c8b7d97472a28ac7ca5b32fbeb85794b0c181d1af3587c60c63949963. This is the Supervisor catalog, not a hosted effective Vibe tool-inventory check.

## Evidence and remaining gates

Private artifact/checksums, build log, migration and installation records, doctor output, file/skill verification and official-client results are retained under /Users/roman/.local/share/vibe-supervisor/rc17/installation-evidence-2026-10-09. Its 17-file manifest SHA-256 is 6b4faf4035d5ddfbee83c68395190399189384dfba110b0dd1e3bbd33a85c962. Configuration backups remain owner-private; raw configuration is not reproduced here.

The current desktop connection was not reloaded or attested. No hosted run ID, worker candidate, current-build correction, recovery, soak, callback, Intel or clean-account pass is claimed. Initialization checks do not certify full D0–D4 or 1.0.

Next: reconnect the desktop integration or start a fresh chat, verify its actual version/catalog, then execute the bounded review and complete edit/correction/verification/cleanup sequence in the [stable strategy](../../v1-stable-strategy.md).
