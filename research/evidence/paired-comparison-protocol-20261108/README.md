# Paired comparison protocol: Codex-to-Vibe 3.1.0 vs. direct Codex + Ollama

Date: 2026-11-08

## Goal

Determine whether delegating bounded tasks from Codex to Mistral Vibe (via `vibe-supervisor`) produces more reliable results with less operator effort than having Codex perform the same tasks directly using a local model (Ollama).

## Fixtures

Both tracks start from the identical clean commit `dcc431785a4cce5e238a4603d4d0e58306913cd9` created by `scripts/quality-pack.mjs create`:

- **Track A fixture:** `$ROOT/orders-quality` (allowed in supervisor configuration; tasks run in detached worktrees).
- **Track B fixture:** `$ROOT/orders-quality-ollama` (dedicated clone for direct in-place edits and tests).

## Tasks (Quality Pack Baseline)

### 1. `review-total` (Review)
- **Scope:** Read `README.md`, `src/cart.mjs`, and `src/money.mjs`.
- **Target:** Inspect `orderTotal(lines, discountPercent)` against README rules 1 to 5 for three specific inputs.
- **Planted defects to detect:**
  1. Tax calculated on undiscounted subtotal instead of discounted subtotal (rule 3).
  2. Exactly 5000 cents charged shipping (rule 4 specifies free shipping at 5000+ cents).
- **Output:** Answer text saved to file.
- **Evaluation:**
  ```bash
  node scripts/quality-pack.mjs check review-total --answer <file> --findings-only
  ```

### 2. `edit-shipping` (Edit)
- **Scope:** Modify `src/cart.mjs` and create `tests/shipping.test.mjs`.
- **Change:** Fix off-by-one comparison in `shippingFor(subtotalCents)` so subtotal >= 5000 cents returns 0 and < 5000 returns 499.
- **Tests:** Add at least 4 named `test(...)` cases using `node:test` covering 4999, 5000, 5001, and an order totaling 5000 cents.
- **Output:** Git patch.
- **Evaluation:**
  ```bash
  node scripts/quality-pack.mjs check edit-shipping --patch <file>
  ```

## Track A Protocol (Codex -> Vibe Supervisor -> Mistral Vibe 3.1.0)

1. Verify readiness via `vibe_status` (`workspace: "$ROOT/orders-quality"`, `operation: "review"` or `"edit"`, plus `base_ref: "dcc431785a4cce5e238a4603d4d0e58306913cd9"` for edit) and record `readiness_receipt` and `task_authorize.argv`.
2. Generate single-use authorization token using the server's reported Node runtime (or run the exact `task_authorize.argv` returned by readiness):
   ```bash
   "$REPORTED_NODE" "$INSTALL_DIR/node_modules/vibe-supervisor/dist/cli.js" task authorize \
     --request "$REQUEST_JSON" \
     --owner-reference "<reference>" \
     --expires-at "$(date -u -v+15M +%Y-%m-%dT%H:%M:%SZ)" \
     --config "$CONFIG_PATH"
   ```
3. Start run via `vibe_review_start` or `vibe_edit_start` in Codex using the returned `start_request` plus `readiness_receipt`.
4. Export result:
   - For review: capture final answer text.
   - For edit: export patch:
     ```bash
     "$REPORTED_NODE" "$INSTALL_DIR/node_modules/vibe-supervisor/dist/cli.js" \
       runs --config "$CONFIG_PATH" \
       export "$RUN_ID" \
       --include patch \
       --out "$EXPORT_DIR"
     ```
5. Evaluate using `scripts/quality-pack.mjs check`.
6. Conclude run via `vibe_close`.

## Track B Protocol (Direct Codex + Ollama)

Record Ollama model name (`glm-5.3:cloud` if selectable), parameter count, quantization, and context window size before starting.

1. **Prompt adjustment:** Remove artificial execution restrictions. Permit Codex to run local tests via `node --test` as normal.
2. Provide prompt to Codex inside `$ROOT/orders-quality-ollama` in fresh task sessions so neither sees the other's answer or scoring criteria.
3. Capture outputs:
   - For review: save answer text to file.
   - For edit: stage new test file intent and generate clean diff:
     ```bash
     git -C "$ROOT/orders-quality-ollama" add -N -- tests/shipping.test.mjs
     git -C "$ROOT/orders-quality-ollama" diff > "$EXPORT_DIR/changes.patch"
     ```
4. Evaluate using the same `scripts/quality-pack.mjs check` commands.

## Scorecard

| Dimension | Track A (Codex + Vibe 3.1.0) | Track B (Direct Codex + Ollama) |
|---|---|---|
| Ollama Model / Worker | Mistral Vibe 3.1.0 | `<model-tag>` |
| `review-total` outcome | Failed. Three reads, no writes. Found the tax defect and missed the shipping threshold. | Pending |
| `review-total` elapsed time | | |
| `review-total` interventions | Refreshed stale preparation once with the connected Node runtime before dispatch. | |
| `edit-shipping` outcome | Accepted. Exact exported patch passed 14 tests and touched only the two allowed files. | Pending |
| `edit-shipping` elapsed time | | |
| `edit-shipping` interventions | | |
| Summary verdict | Launch restored and edit verified. Review coverage needs a follow-up trial. | Pending |

## Decision Criteria

Use correctness, time to a verified result and operator interventions to decide what to fix in the Mistral Vibe handoff. The scorecard uses the original briefs. Keep the revised review trial separate.

## Vibe review follow-up

Run `068d869c-466e-4472-9eff-c974341fe854` on 2026-11-08 used the same candidate, fixture base, context files and limits as the original. The revised brief required expected and actual tax, shipping and total for each input. Vibe completed normally, preserved read-only integrity and reported no defects. The independent checker rejected the answer. Running the fixture and checking the written rules gave these totals in cents.

| Case | Expected by spec | Actual from code | Vibe's reported actual |
|---|---:|---:|---:|
| 1000 × 1, 10% off | 1579 | 1599 | 1579 |
| 2500 × 2, no discount | 6000 | 6499 | 6000 |
| 3000 × 2, 50% off | 3600 | 4200 | 6600 |

The revised run covered every input and missed both defects. One run per brief leaves the effect of the wording uncertain. The run closed and the fixture stayed clean. To check answers to the revised brief, omit `--findings-only`. The default check now reproduces the fixture results and compares each reported value.

### Follow-up with observed values

Run `2101cddf-a6ea-4c23-9806-d51bd6f17ae4` used the same fixture and the revised brief with independently observed tax, shipping and total for all three inputs. Vibe reported all observed values correctly and found the tax defect. It still expected a 499-cent shipping charge at the 5000-cent threshold, where rule 4 specifies free shipping. The checker rejected the second expected row and the missing shipping finding. The run closed with verified read-only integrity and the fixture stayed clean.

The coordinator reached the checked verdict in 53 seconds from the start of setup, including 23 seconds from dispatch. The run required one task grant and no restart, retry, or output repair. This was a separate trial with observed values supplied in the brief. The original scorecard remains the basis for the pending Ollama comparison.

### Follow-up with confirmed discrepancies

Run `8eadd1df-06bc-4e5f-918b-064051bec38f` received the independently verified expected and observed values for all three cases. The brief asked Vibe to find and explain each cause in the source. It reported all values correctly and identified the tax calculation. It attributed the shipping discrepancy to `shippingFor(gross)`, although gross is the required pre-discount subtotal. The cause is the strict `>` inside `shippingFor`.

The automatic checker passed all nine checks because its shipping pattern matched the symptom. Source inspection rejected the diagnosis. The checker took 50 seconds to reach its verdict from the start of setup, including 24 seconds from dispatch. Manual source inspection was required to make the final decision. The run used one grant, closed normally, and preserved read-only integrity. Keep this trial separate from independent defect discovery.

The recorded executed reads were `README.md`, `src/cart.mjs` and `src/money.mjs`, in that order, with no extra reads. The same three paths were read in the observed-values trial. This is live evidence of file access. The [input wiring test](../../../docs/quality-pack.md#check-review-inputs) separately checks the exact prompt at the local app-server boundary with a test double.

The tightened checker now rejects the saved answer at `threshold-at-5000` while all six numeric checks still pass. The regression test also accepts a control with the correct source expression.

### Fresh inventory diagnosis

Both tracks received the same brief and failing assertion in separate clean copies of synthetic commit `6ba6557494c2b3b8295723d3c56b238df81c6b55`. The fixture moved the available-stock increment before the guard in `release`, which caused an existing inventory test to fail after catching the expected error. The prompt gave the expected and actual stock state without giving the cause. Moving the guard back before the increment in a disposable copy restored all three tests.

| Track | Result | Input check | Timing and interventions |
|---|---|---|---|
| Vibe 3.1.0, run `87c94b2b-b5e9-404c-89b2-fd4b464c4e63` | Correct cause and fix, inaccurate line numbers | Executed reads of exactly the three requested files | 49 seconds from authorization to verified result, 42 from dispatch. One grant, no retries. |
| Codex CLI with Ollama `gemma4:31b-cloud` | Correct cause and fix, inaccurate line number | One read command opened exactly the same three files | Successful command took 10 seconds. About 25 seconds from initiating that attempt to checking its answer, and 96 seconds from the first Ollama attempt. |

The initial Codex CLI attempt stopped on a provider mismatch. Setting the provider explicitly let it reach Ollama, which rejected `glm-5.3:cloud` under the account's free usage. The comparison used the suggested free Gemma model through the CLI. Both source copies remained clean and the Vibe run closed. These timings include different setup paths and coordinator polling. They are observations from a single fixture, with no desktop measurement.

### Historical Node 24 regression

Both reviewers received the same failing assertion and two public files from `7466850` in separate clean copies. The existing quality-pack unit test failed on Node 24.22.1. The coordinator reproduced the child process error: passing `tests/` to `node --test` exits with `MODULE_NOT_FOUND`. The edit checker also passed directory arguments and expected TAP counters from the default reporter. The historical fix in `c00c5e0` passes explicit test files and forces the TAP reporter.

| Track | Input check | Diagnosis | Setup | Execution | Verification |
|---|---|---|---|---|---|
| Vibe 3.1.0, run `de2b5a37-aea0-4160-8bce-4e1ca59e2a25` | Executed reads of exactly the two requested files | Suggested treating a missing TAP failure count as zero. Missed the directory argument and did not fix the failing unit test. | 13 s from readiness to dispatch, including coordination and one grant | 5.5 s from recorded start to finish | 2.55 s to check the proposed change |
| Codex CLI with Ollama `gemma4:31b-cloud` | One read command opened the same two files | Correctly suggested forcing TAP but kept the directory arguments, so the unit test still failed. | 0.6 s from warm CLI launch to turn start, excluding host permission and shared fixture setup | 7.3 s from turn start to completion | 2.59 s to check the proposed change |

Neither proposed change passed the original unit test or the edit checker with a known-good patch. Applying the historical fix to just the two reviewed files in the verification copy passed both, with 14 edit tests passing. Both review copies stayed clean. The Vibe run closed with read-only integrity verified. These timings describe different setup boundaries on one historical task. The next change to the Vibe brief is to include the failing child command and its error, then check whether the proposed repair makes the original test pass.

#### Vibe replay with the child error

Run `486e4c6c-e702-46c8-95fc-936e2ab2b59c` received the same two files and brief plus the coordinator's reproduction: Node 24.22.1, `node --test tests/`, exit 1 and `MODULE_NOT_FOUND`. It read both files and correctly located the directory argument at both call sites. It proposed prefixing the directory arguments with `./` and leaving the reporter unchanged.

In a fresh copy of the historical source, the proposed change left the unit test and the edit checker failing. Running `node --test ./tests/` directly still produced `MODULE_NOT_FOUND`. The historical fix with explicit test files and TAP remains the passing control. The replay took 20 s from readiness to dispatch, 31.5 s from run start to finish and 2.24 s to verify the proposal. The run closed with read-only integrity verified. The more specific brief improved localization on this replay, but the proposed repair was rejected.
