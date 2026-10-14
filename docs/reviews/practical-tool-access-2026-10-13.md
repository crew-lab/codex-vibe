# Practical edit tool access diagnosis

## Finding

The historical run `4ba5e305-de28-41a4-b6d5-a2de983fddcf` ended with an empty patch and a worker claim that tools were unavailable. Its record contains no tool-attempt evidence, so the cause remains **unknown**. The source snapshot included `.github/workflows/deploy.yml` and `rollback.yml`; those paths are readable under the pinned local edit profile. This investigation does not establish what happened in that hosted run.

The candidate now checks the effective Vibe `ToolManager.available_tools` inventory against the exact review or edit profile before tools are exposed to the model. Missing or extra tools fail closed. Optional diagnostics record the safe inventory and bounded `BaseTool.invoke` attempts/outcomes; they omit arguments, paths, results, provider traffic, and reasoning. Calls blocked before `invoke` are not observed, so absence of a recorded call does not prove absence of an attempt or a permission denial. Final flush is serialized with the periodic writer and runs when the launcher exits.

The offline fixture uses installed Vibe 2.26.1 and its real `ToolManager` and file tools, with provider networking disabled. It verifies exact inventory checks, missing-tool and unexpected-tool rejection, and reads of both ordinary project files and `.github/workflows/{deploy,rollback}.yml`. This supports local profile/path behavior only; **hosted inference and authenticated hosted tool access were not run or certified**. No root cause is claimed for the historical run.

## Verification

- Candidate base: `7b30feaf60e7b6038e2bd80c14974d7ff270330e`.
- Pinned local interpreter: `/Users/roman/.local/share/uv/tools/mistral-vibe/bin/python` (the installed Vibe 2.26.1 environment; CPython 3.12.13).
- Full `npm run verify:release` after the final source change: passed under Node 24.21.0; 65 Node test files / 650 tests, 77 Python tests, lint, typecheck, build, acceptance checks, secret scan, and SBOM generation (193 locked entries).
- The initial sandboxed full run had seven failures caused by restricted process/PID inspection (`EPERM`); rerunning the same verification with the required local process-inspection permission passed. The passing run log is recorded in the accompanying manifest.
- `git diff --check` passed. `package.json` and `package-lock.json` are unchanged. No dependency install, package, commit, push, or hosted request was performed.

The acceptance script's displayed release-gate labels are existing repository evidence; this task did not newly perform any hosted gate named there. They must not be read as hosted certification from this investigation.

## Patch artifact

The source patch SHA-256 is `f638bea48dc93b90337f762924cddc166ecb757e2aa5240135e64fac0fe7cd76`. The patch is available at `docs/reviews/practical-tool-fix-2026-10-13/candidate.patch` in the parent checkout and at `/private/tmp/practical-tool-diagnosis-candidate.patch` in the local environment. The final release-verification log is `/private/tmp/practical-tool-diagnosis-verify-release.log`.
