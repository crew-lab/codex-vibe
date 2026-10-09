# Bounded edit/correction pilot

Status: **Executed successfully on rc.13; see [evaluation](history/reviews/rc13-worker-adoption-2026-10-09.md).** This is one edit session and one same-session correction. It does not certify soak, restart/load recovery, permission callbacks, native desktop shutdown, Intel, clean-account installation, or application product acceptance. Keep prior failed records separately.

## Fresh connection prerequisite

Reconnect the desktop MCP integration or use a new chat after installation. Do not invoke cached eight-tool schemas. Confirm the connected server identifies `vibe-supervisor` and the installed candidate version (currently `0.9.0-rc.14`) through MCP initialization; installation/CLI version alone is insufficient. The catalog must contain exactly `vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, `vibe_close`, `vibe_continue`, `vibe_respond`, without `vibe_cancel` or `backend`/`allow_shell` start fields. The coordinator must inspect actual schemas before dispatch. If the desktop agent cannot access handshake metadata, use a fresh official client to record it and separately verify desktop tool visibility; do not claim a desktop version handshake from that independent client.

## Fixture

Run `node scripts/prepare-acp-edit-pilot.mjs /absolute/existing/allowed-parent`. It creates a new disposable Git repository and an adjacent private plan JSON. No allowlist or user configuration is changed, and no Vibe run is started. The fixture contains `calc.py` with a deliberate subtraction bug, root instruction canary and tracked `.agents/skills/canary/SKILL.md`. Its fixture-only Git commit establishes the explicit immutable base. Preserve the recorded path/base rather than selecting a different current HEAD. Do not use the finished UARoots implementation as the fixture.

## Initial turn

Pass the plan's `cwd`, `base_ref`, `task`, `max_turns: 12`, `timeout_seconds: 240`, and `wait_seconds: 30` to `vibe_edit_start`. Record `run_id` and `supervisor_version`; require the installed candidate version. No retries, account rotation or budget increases. On a guard, source/signature, authentication, permission or provider failure, preserve evidence and stop; never bypass the failure. Any unexpected permission/input remains ungranted while inspected.

Poll `vibe_status` with `wait_seconds: 30` and carry forward `next_after_seq` as `after_seq`. Use a bounded 300-second coordinator deadline for both turns and cleanup, reserving the last 60 seconds for cancellation/export/cleanup. Record elapsed waits; an immediately returned poll does not establish a long-wait gate. Require completed + `end_turn`, no unexplained warnings, and read the actual answer via transcript rather than the generic summary.

Fetch fresh `vibe_result(detail: full, include_transcript: true)` and export artifacts. The worker must be a supervisor-created detached worktree at the exact fixture base; the source repository must stay clean and unchanged. Independently validate the exact candidate: only `calc.py` differs, no scratch/untracked files, `.agents` and root instruction canaries unchanged, no shell/network/agent-switch calls, and no project-canary text injected into the saved system/prompt messages. Inspect owner-private native records safely; publish only whitelisted tool counts and boolean canary outcomes, never raw histories, credentials or reasoning. Treat unavailable evidence as unverified, not passed.

The coordinator runs Python against the exact worker file (not the source), with cases `(0,0) -> 0`, `(2,3) -> 5`, `(-2,3) -> 1`, `(2,-3) -> -1`, `(-2,-3) -> -5`, `(1000000,1) -> 1000001`. Check that the initial docstring remains `Compute result.`. Do not accept worker claims that it ran tests.

## One correction

Only after initial checks pass, send the plan's `correction` to `vibe_continue` with the same `run_id`, without a new budget. Require completed + `end_turn`; then fetch new full result and fresh patch. Repeat the numeric/scope/canary checks and require docstring `Return the sum of two integers.`. Confirm both rounds share the same run/worktree and that no old artifact was used as current evidence. At most one file read per round, no searches; tool counts include read errors and retries. If bounds are exceeded, report task noncompliance separately from Supervisor lifecycle correctness and stop.

## Export, close and evidence

Preserve each candidate's patch hash and final export hash. Ensure the final worktree's fresh export matches the final saved artifact before `vibe_close(cleanup_worktree: true)`. Record closed state and `worktree_removed: true`, independently check worker filesystem absence, absence of owned process/owner locks after connection shutdown, and unchanged source fixture. Never automatically apply the patch to UARoots or another source repository. Keep the fixture, plan and private artifacts until hash-verified evidence is preserved.

Report per-stage outcomes: live server version/catalog, edit, independent verification, correction, fresh export, close/cleanup. Include exact limits, stop reasons, warnings, tool counts, hashes and any coordinator errors. Keep diagnostic event reasons separate from structured backend stop reasons. A failed or cancelled run is not eligible for continuation; if cleanup retains a worktree, preserve and report it instead of forcing deletion.

The recorded successful execution used rc.13 and a reviewed dirty docstring baseline (`Reviewed baseline.`), rather than the generator’s original `Compute result.`. Use the prepared manifest’s actual baseline docstring for initial preservation checks. rc.14 has fresh installation/MCP evidence, but no hosted inference is claimed for that version. Do not rerun this completed pilot automatically.
