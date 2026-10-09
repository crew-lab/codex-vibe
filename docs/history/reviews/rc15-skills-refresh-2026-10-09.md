# rc.15 skills refresh and local installation

Note added on main: the "rc.15" built and installed here was cut on the target machine from `codex/project-agents-isolation` (rc.14 plus these skills). It is not the 0.9.0-rc.15 on main, which removed the `auto` backend, the `baseline prepare` and `audit-edit` CLI commands and other surface. The skills were folded into main in 0.9.0-rc.17, rewritten for that command set.

Date: 2026-10-09. Source: `codex/project-agents-isolation`, following pushed rc.14 commit `eeea2ee`. The user requested updated repository skills, local installation and Handoff reconciliation. Existing commit/push authorization is retained. No new hosted run, source application to UARoots, publication or deployment.

## Skill gap audit

| Gap | Observation | Applied fix |
| --- | --- | --- |
| G1 | Baseline guidance appended after references duplicated the core loop | Consolidated both skills into inputs, numbered procedure, completion checks and references |
| G2 | ACP verification step allowed tests in the worker worktree despite separate-copy guidance | All test/build/dependency/cache work is assigned to a separate exact candidate copy |
| G3 | A continuation step still suggested a larger budget/replacement without explicit authorization | Cumulative ceiling enforced as workflow guidance; no automatic increase/replay; replacements require explicit authorization |
| G4 | Ready/final results could be confused with acceptance; premature close loses correction | Explicit candidate-ready versus accepted distinction and acceptance/correction before close |
| G5 | Templates did not clearly identify prepared baseline or actual tool inventory | Prepared cwd/base_ref, reviewed bytes, disabled tools and actual final answer included |
| G6 | Scope audit could be mistaken for export acceptance or provider quota measurement | Argument-only scope and distinct messages/calls/updates/provider measurements stated |

Portable name/description/license frontmatter uses a validated plain/JSON-quoted YAML subset. Folder names, description bounds/triggers, required local sections, numbered steps, completion checks, body sizes and local references passed validation. The local section convention is an authoring checklist, not an additional Agent Skills protocol requirement. Both skills remain compact (79 and 73 lines); the existing focused template reference is preserved. No new companion skill/global sync was created: these are domain integration skills, not a new Claude CLI workflow.

Authoring references: [Agent Skills specification](https://agentskills.io/specification), [ACP prompt turns](https://agentclientprotocol.com/protocol/v1/prompt-turn), and the existing local skill-builder checklist. Current official skill examples informed concise core/reference separation; no external text or policy overrides were imported into the runtime contract.

## Release and installation

`package:rc` passed with the populated offline npm cache: 790 tests, two skipped, Python tests, lint/typecheck/build, acceptance, secret scan, SBOM and installed-package smoke. Archive SHA-256: `87ba5194fd000db8d12f629f7078c4ba584aa9a8debb52cfbc65d4b6963c4e78`.

Installed alongside earlier versions at `~/.local/share/vibe-supervisor/rc15`. The effective rc.14 ACP config was copied unchanged into a new private template home; the original config, prior template, allowlists and unrelated Codex settings were preserved. Only the existing MCP entry, CLI alias and two skill symlinks were switched. CLI switch occurred after installation succeeded.

Fresh official MCP initialization identified `vibe-supervisor` `0.9.0-rc.15`; exactly seven tools were listed, no backend/allow_shell start parameters. A missing-run status check returned the expected error; the preflight left zero saved runs/owner locks. All three installed skill/reference files match source bytes; both discovery links resolve to the rc.15 package.

Private installation/registration/check evidence and the package are retained under `~/.local/share/vibe-supervisor/rc15/installation-evidence-2026-10-09`. Native histories/credentials were not copied into this report.

## Evidence limits and next task

No rc.15 hosted inference, authenticated effective worker inventory or native desktop reload is claimed. Earlier rc.13 pilot acceptance remains version-bound; its original product candidate still has a partial Vibe gate after coordinator correction. The next bounded product task must verify the actual connection, use a prepared reviewed baseline, keep the session open through independent tests/review and any same-session correction, then verify fresh export and cleanup. Full soak, recovery/callback, Intel and clean-account gates remain unverified.
