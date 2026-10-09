# Implementation handoff

Status as of **2026-10-09**: release candidate `vibe-supervisor@0.9.0-rc.17`, private, unpublished, ESM, MIT (`Copyright (c) 2026 crew-lab`). Not a production 1.0 certification. Repository: GitHub `crew-lab/codex-vibe`. The full earlier handoff, with the architecture notes, Vibe interactions under test, the Phase D test plan and every result so far, is kept in [the rc.15 snapshot](docs/history/handoff-rc15-2026-10-09.md); older history is in [docs/history/](docs/history/).

## Where it stands

The goal for 1.0 is a supervisor that works stably, so new surface waits until the remaining gates pass. On every real run so far the supervisor has held: no wrong state, leak, lost run or broken boundary. Phase D failures were supervisor reporting bugs since fixed, test-driver problems or model behaviour. One silent 15-minute stall is unexplained; the progress watchdog (600 s) now ends such a run with `VSUP_NO_PROGRESS` ([analysis](docs/history/reviews/vibe-2.25.8-silent-stall-analysis-2026-10-08.md)).

- **rc.10** fixed the pre-1.0 cold review F1 to F6 ([report](docs/history/reviews/1.0-cold-review-2026-10-08.md); F7 to F15 are after 1.0).
- **rc.11 to rc.14**, from the target machine: a real project `.agents` directory is accepted while pinned Vibe project discovery is disabled; run records carry the creating supervisor version; the rc.13 hosted ACP edit-and-correction pilot passed ([evaluation](docs/history/reviews/rc13-worker-adoption-2026-10-09.md)). rc.14 hosted inference and native desktop reload are unverified.
- **rc.15** removed `backend = "auto"` and the probe cache, cut the CLI to `setup` (with `--dry-run`), `allow`, `doctor`, `serve` and `runs`, and moved the coordinator tools to `scripts/` ([scripts/README.md](scripts/README.md)).
- **rc.16** removed the shim that accepted settings keys from before rc.6 and the config options with no recorded use; such keys are now rejected like any unknown key. See [CHANGELOG.md](CHANGELOG.md) for the exact list.
- **rc.17** fixed three stability defects: retention now sweeps run directories whose record cannot be loaded (deleting only a missing or non-JSON record, never one with a live worktree); shutdown on disconnect has a 10 s deadline, after which the supervisor's own worker process groups are terminated and the owner lock released; an undeliverable automatic policy denial resolves the ACP permission request instead of hanging the turn. Both skills are refreshed from the target machine's skills work ([receipt](docs/history/reviews/rc15-skills-refresh-2026-10-09.md)) and rewritten for the current command set.

The "rc.15" installed on the target machine at `~/.local/share/vibe-supervisor/rc15` was built there from rc.14 plus the skills; it is not main's rc.15 and still has `auto` and the removed CLI commands. Replace it with rc.17. Upgrading an existing install to rc.17: `backend = "auto"` must become `programmatic` or `acp`; scripts that called `init` or `configure-codex` must call `setup`; a configuration that still sets a removed key fails validation, and `vibe-supervisor doctor` names it.

## What 1.0 still needs

| # | Priority | Item | Where |
|---|---|---|---|
| 1 | P0 | D18 soak on rc.17: two pilot reviews, then the full 60 reviews, 30 edits and 10 ACP runs. `npm run soak:report <dir>` gives the verdict | Target machine, about 2 hours, USD 2 to 4 |
| 2 | P0 | D21 under the four-file fixture, D23 and D24 repeated on rc.17 | Target machine |
| 3 | P0 | Codex desktop steps D2, D3, D14, D16, D22 (setup, tool list after restart, two `--isolated` windows, what the model sees, quit with running and idle runs) | Target machine, a person at the keyboard |
| 4 | P0 | D20 install on a clean macOS user account | Target machine |
| 5 | P0 | Push the release workflow (needs the token's `workflow` scope, waits on `claude/release-workflow`), tag `v1.0.0`, check the GitHub Release assets | User |
| 6 | P1, decision | Intel: test on an Intel Mac or state Apple silicon only | User |
| 7 | P1, decision | Permission and elicitation callbacks cannot be triggered naturally with this profile: keep as a gate or document as a 1.0 limit | User |
| 8 | P1, decision | Stay on Vibe 2.25.8 for 1.0 ([2.26.0 comparison](docs/history/reviews/vibe-2.26.0-source-diff-2026-10-08.md)); a bump needs the version, the harness source hash and the signatures updated together | User |
| 9 | P2 | Article after 1.0 ([drafts](docs/history/article/README.md)); fix the GitHub repository description first | Author |

The step-by-step plan for 1 to 4 is the [Phase D test plan](docs/history/handoff-rc15-2026-10-09.md#phase-d-test-plan); install rc.17 wherever it says rc.10. The unverified gates are listed once, in [docs/compatibility.md](docs/compatibility.md#unverified-gates).

## Simplification plan, remaining

Phases 1 and 2 of the 2026-10-09 review are done (rc.15 to rc.17). Phase 3 waits on the hosted soak:

- One backend: if ACP passes D18, make it the default and drop programmatic (about 400 lines).
- Fold the ACP negotiation timer into the progress watchdog; regroup tests by subject instead of by review cycle.

Risk to keep in view: programmatic turn-limit detection needs Vibe's stop marker to match stdout and stderr exactly; one extra stderr line turns a turn limit into `VSUP_BACKEND_CRASHED`.

## How to work on it

- Never run a real Vibe on the preparing machine: no hosted runs, no `compat:probe`, no `VIBE_SUPERVISOR_TEST_VIBE_PYTHON`. Published Vibe wheels may be read, never executed. Hosted evidence comes from the target machine.
- The target-machine agent bases its branch on main and changes only evidence and this handoff there; runtime code and `scripts/soak.mjs` change on main.
- Record every soak attempt as a new attempt and keep earlier failures. Do not raise limits, rotate accounts or retry automatically. Hosted runs are billed; run them only with the owner's authorization.
- Results go in [docs/history/acceptance.md](docs/history/acceptance.md) and `docs/history/reviews/`; never record credentials.

## Release artifacts

`release/` is ignored by Git. The current candidate is **0.9.0-rc.17**, built on 2026-10-09 on the preparing machine (Node 24.19.0, npm 11.17.0, macOS arm64) from the `Cut 0.9.0-rc.17` commit.

```text
vibe-supervisor-0.9.0-rc.17.tgz  sha256 5e25afc6ab0c292e6db2abf5ebaccd92b2fe957c283a34c3d0156a29e235b1b0
sbom.spdx.json                   sha256 cbcd54543497f804b918927e331c9d563b6d405e6924f1d43e0576562042eab3
acceptance.json                  sha256 4901ce23e11b9d3305c28476453cc7cba745320c63145d28a5979d99db70245d; 7 deterministic checks PASS; hosted, soak and platform gates UNVERIFIED
SHA256SUMS
```

`package:rc` passed: release verification (761 tests passed and 2 skipped in 68 files, 83 Python tests, lint, typecheck, build, secret scan, SBOM) and the offline installed-package smoke test. The tarball has no `docs/history/`, `.mcp.json` or `.codex-plugin/`. A copy is kept on the preparing machine at `/Users/r.senchuk/src/github.com/whitebithq/cdx-vibe/release/0.9.0-rc.17/`; check it with `shasum -a 256 -c SHA256SUMS` before installing. Rebuild with `VIBE_SUPERVISOR_TEST_NPM_CACHE=<populated cache> npm run package:rc`; never edit archive contents.

## References

[README.md](README.md) (install and use), [docs/reference.md](docs/reference.md) (tools, configuration, CLI), [docs/functionality.md](docs/functionality.md), [docs/security.md](docs/security.md), [docs/compatibility.md](docs/compatibility.md), [docs/errors.md](docs/errors.md), ADRs [0002](docs/adr/0002-protocol-security-boundary.md) and [0003](docs/adr/0003-vibe-launcher.md).
