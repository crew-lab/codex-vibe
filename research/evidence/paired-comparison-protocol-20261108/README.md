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
  node scripts/quality-pack.mjs check review-total --answer <file>
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

1. Verify readiness via `vibe_status`.
2. Generate single-use authorization token:
   ```bash
   node "$INSTALL_DIR/node_modules/vibe-supervisor/dist/cli.js" task authorize \
     --request "$REQUEST_JSON" \
     --owner-reference "<reference>" \
     --expires-at "$(date -u -v+15M +%Y-%m-%dT%H:%M:%SZ)" \
     --config "$CONFIG_PATH"
   ```
3. Start run via `vibe_review_start` or `vibe_edit_start` in Codex.
4. Export result:
   - For review: capture final answer text.
   - For edit: export patch:
     ```bash
     node "$INSTALL_DIR/node_modules/vibe-supervisor/dist/cli.js" runs export \
       --dir "$DATA_DIR" \
       --run "$RUN_ID" \
       --include patch \
       --out "$EXPORT_DIR"
     ```
5. Evaluate using `scripts/quality-pack.mjs check`.
6. Conclude run via `vibe_close`.

## Track B Protocol (Direct Codex + Ollama)

Record Ollama model name, parameter count, quantization, and context window size before starting.

1. **Prompt adjustment:** Remove artificial execution restrictions. Permit Codex to run local tests via `node --test` as normal.
2. Provide prompt to Codex inside `$ROOT/orders-quality-ollama`.
3. Capture outputs:
   - For review: save answer text to file.
   - For edit: generate clean diff:
     ```bash
     git -C "$ROOT/orders-quality-ollama" diff > "$EXPORT_DIR/changes.patch"
     ```
4. Evaluate using the same `scripts/quality-pack.mjs check` commands.

## Scorecard

| Dimension | Track A (Codex + Vibe 3.1.0) | Track B (Direct Codex + Ollama) |
|---|---|---|
| Ollama Model / Worker | Mistral Vibe 3.1.0 | `<model-tag>` |
| `review-total` outcome | | |
| `review-total` elapsed time | | |
| `review-total` interventions | | |
| `edit-shipping` outcome | | |
| `edit-shipping` elapsed time | | |
| `edit-shipping` interventions | | |
| Summary verdict | | |

## Decision Criteria

- **Refine supervisor:** If Track A produces verified solutions with fewer operator interventions, less cognitive load, and clean isolation.
- **Shelve supervisor:** If Track B achieves comparable correctness and speed with equal or less operator friction.
