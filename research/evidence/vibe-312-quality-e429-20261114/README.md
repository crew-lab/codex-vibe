# Vibe 3.1.2 quality-pack run and agy 1.5.8 diagnostics on `e429a9b`, 2026-11-14

Candidate `c3f0ea7ba7ce4fec4d6601365c799777e9e07d273f547a52fee90ef443411ffc` (built from `e429a9b`) passed preparation against Vibe 3.1.2 on Node 24.22.1.

## 1. Quality-pack results (12/12 passed)

All 12 trials in `records/` completed normally (`stop_reason: "end_turn"`). Every review ran with requested and observed `thinking: "high"` and read only the three named `context_files` (`unread: []`, `extra: []`).

| File | Task | Verdict | Stop reason | Thinking | Named / Read | Model calls | Prompt / Completion tokens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `records/review-total-1.json` | `review-total` | pass | `end_turn` | `high` | 3 / 3 | 4 | 23,868 / 5,412 |
| `records/review-total-2.json` | `review-total` | pass | `end_turn` | `high` | 3 / 3 | 4 | 23,869 / 6,753 |
| `records/review-total-3.json` | `review-total` | pass | `end_turn` | `high` | 3 / 3 | 4 | 23,881 / 9,056 |
| `records/review-total-4.json` | `review-total` | pass | `end_turn` | `high` | 3 / 3 | 4 | 23,890 / 6,294 |
| `records/review-total-5.json` | `review-total` | pass | `end_turn` | `high` | 3 / 3 | 4 | 23,905 / 6,277 |
| `records/review-stock-1.json` | `review-stock` | pass | `end_turn` | `high` | 3 / 3 | 2 | 11,295 / 6,070 |
| `records/review-stock-2.json` | `review-stock` | pass | `end_turn` | `high` | 3 / 3 | 2 | 11,295 / 6,081 |
| `records/review-stock-3.json` | `review-stock` | pass | `end_turn` | `high` | 3 / 3 | 2 | 11,295 / 5,976 |
| `records/review-stock-4.json` | `review-stock` | pass | `end_turn` | `high` | 3 / 3 | 2 | 11,295 / 6,026 |
| `records/review-stock-5.json` | `review-stock` | pass | `end_turn` | `high` | 3 / 3 | 2 | 11,295 / 6,055 |
| `records/edit-shipping-1.json` | `edit-shipping` | pass | `end_turn` | `off` | - | 5 | 36,987 / 1,073 |
| `records/edit-reserve-all-1.json` | `edit-reserve-all` | pass | `end_turn` | `off` | - | 6 | 51,179 / 2,212 |

## 2. Re-scored 30 pre-`e429a9b` reviews

`old/` holds the 30 saved summaries (`.txt`) and `quality-pack.mjs check` outputs (`.json`) across the baseline, thinking-off, and thinking-high isolated runs predating `e429a9b`. All 30 scored `passed: false` (0/30).

## 3. Thinking confirmation from the earlier `thinking-high` batch

Run `4acc9415-0ccf-46a2-991f-7ee3ed0961dc` (`think-high-review-total-1` on candidate `6717dfd56b15580217e875f80423b5373a48ac966ae4c137a38315932b96ab18`) recorded:
- `requested_thinking: "high"` (`source: "supervisor-session-config"`)
- `thinking: "high"` (`source: "runtime/read"`)
- `reasoning_observation`: `streamed_entries: 2`, `history_entries: 2`, `history_audited: true`

## 4. Calendar-date replay and correction

- **Initial replay (`6af4334a-3427-4d73-8153-f39e4f327a2d`):** Completed with `end_turn`, but its patch used `const [year, month, day] = value.split('-').map(Number);` and failed TypeScript compilation (`TS18048` / `TS2769`) because `noUncheckedIndexedAccess` is enabled and the brief omitted the TypeScript strict-indexing guidance. Run closed `deferred`.
- **Single correction (`7f1b4533-5e62-4ae7-8a58-5f568eaee615`):** Fixed `usage.ts` and `usefulness.ts` with explicit `parts[0]`/`parts[1]`/`parts[2]` narrowing. `npm run build`, `npm run lint`, `npm run typecheck`, `cli-dates`, and `hygiene` all passed (`dates=0 hygiene=0`). However, the request capped `max_turns` at `12` instead of the default `20`; after finishing both edits and reading them back, Vibe twice attempted `file_system.bash` (denied by policy) and exhausted all 12 turns (`stop_reason: "turn_limit"`), so the run was closed `rejected`.

## 5. Antigravity 1.5.8 diagnostics and live review attempt

- **Strict-mode preparation (`report_sha256: 745c651a2c18bd98d2e7b4bccc27c7ce83e6050746680ec191412d3849d24b58`):** Failed `probe_control_not_executed` (`agy_strict_permissions_blocked_control_read`). Even though `/permissions` readback passed and the `PreToolUse` hook logged `approve`, headless `agy` auto-denied `read_file` under `toolPermission: "strict"`. Probe `diagnostics` are saved in `agy-strict-diagnostics.json`.
- **Skip-permissions preparation and live review (`9067c914-2171-4700-82e2-3bad4ebcf0a5`):** Preparation passed with `antigravity_skip_permissions = true`. Live `review-stock` reached Google inference and failed with `VSUP_ANTIGRAVITY_EXEC_FAILED` because `generativelanguage.googleapis.com` returned HTTP 400 `API_KEY_INVALID` for the configured key.

## 6. Antigravity 1.5.9 `tool_info.parameters` fix and live `review-stock` pass

- **Initial retry with valid `GEMINI_API_KEY` (`a128ce7c-dfc6-49eb-ae34-980bdffd7a80` / `b69db930-ee6b-4f71-8f55-939bb95016a6`):** Authenticated cleanly and executed `read_file` three times, then failed hook-ledger reconciliation with `VSUP_INTERNAL` (`executed tool call 'read_file' lacks both call ID and canonical arguments fingerprint`) because `agy` 1.5.9 emits `step_update.tool_info.parameters` instead of top-level `args` / `call_id`.
- **After `parseCallObj` fix (`0f0cb3af-a48d-44e0-94fe-f0f3a7ad17d4`, candidate `9468b08a495be3ea82b6c97f336645937869db2d7574366d0f4996e10ab5284c`):** Preparation passed with `antigravity_skip_permissions = true` (`report_sha256: 2431b21f58fd237022ef299a69e6b8e67d177dbdab3a6c4ff54efead20c803c4`). Live `review-stock` completed normally (`stop_reason: "end_turn"`, `integrity.status: "verified"`, 3 `read_file` calls approved and matched in `approvals.json`, `prompt_tokens: 13961`, `completion_tokens: 4157`) and passed all 4 quality-pack checks in `records/agy-review-stock-1.json`.
