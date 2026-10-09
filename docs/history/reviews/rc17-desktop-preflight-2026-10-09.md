# rc.17 desktop preflight — stale connection

Date: 2026-10-09. Outcome: **STOPPED before rc.17 edit/correction acceptance**. No runtime or configuration change was made during this preflight.

The installed CLI and fresh official-client initialization previously confirmed rc.17 ([installation receipt](rc17-local-installation-2026-10-09.md)). The current desktop exposed all seven ACP tools with the expected start schemas, but tool names and schemas alone did not establish its process version. The first native hosted run returned creator version **0.9.0-rc.12**, and its artifact paths independently pointed to the rc12 isolated session home. It is not rc.17 hosted evidence.

## Observed run

- Run: `d64eb230-3762-4142-b064-8393875ce2c6`; ACP, read-only review.
- Created: `2026-10-09T15:35:50.277Z`.
- Limits: six cumulative turns, 120-second timeout, 30-second bounded start wait; no increase, continuation or replacement.
- Scope: only `calc.py` in a disposable fixture. No product repository was delegated.
- Result: completed, structured `stop_reason: end_turn`, warnings `[]`, integrity `verified`, `write_tool_observed: false`, changed files `[]`.
- Full result/transcript obtained privately; no native histories or reasoning published. Findings were not promoted to rc.17 acceptance.
- `vibe_close` returned `state: closed`, creator version rc.12, `worktree_removed: false`. This was a review: no detached edit worktree was created or needed removal.

The coordinator stopped at the connection mismatch. The controlled edit and same-session correction were **NOT RUN**, as were product acceptance, soak, recovery and disconnect testing.

## Preserved fixture and evidence

Fixture: `/Users/roman/.local/share/vibe-supervisor/field-workspace/acp-edit-pilot-BffD32`; exact base `929cb6f2d82af4e685e83de029f588a3202266a4`. An independent post-close Git check showed the same HEAD and an empty tracked/untracked status, including preserved instruction canaries. The fixture and adjacent prepared plan remain for the next version-verified test; they are intentionally retained source material, not an owned worker leak.

Private full start/result/close record: `/private/tmp/rc17-desktop-preflight-20261009/private-record.json`, mode 0600, SHA-256 `0360cde7794b303ccf53ee276add4520034c58e5350d83c071cf9efd367b8043`. The supervisor's original rc12 run artifacts remain retained. No forced deletion or profile/configuration bypass was attempted.

## Next prerequisite

An independent read of the on-disk Codex registration still points to the rc17 CLI with `serve --stdio --isolated` and the rc17 template home. This establishes configured intent, not a refreshed desktop process. Restart Codex desktop completely, then use a fresh chat/connection to confirm the actual version before proceeding. An old chat may retain its previous connection even when the file is correct. Do not reinstall, broaden roots, raise limits, or replay the old run to mask this mismatch.

Documentation-only validation: JSON parsing, local Markdown links and `git diff --check`. No application tests or package rebuild are needed for this evidence update.
