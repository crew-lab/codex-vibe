# Quality pack

Four real tasks that measure whether Codex-to-Vibe produces good work, not only whether the supervisor stays in bounds. Each task runs on a small generated project, `orders`, with two planted bugs, and each result is judged by an independent check instead of the worker's summary. Run the pack on the machine that has Vibe after any change to the supervisor, the skill or the installed Vibe, and compare the results with the last run.

| Task | Kind | What it measures |
|---|---|---|
| `edit-shipping` | edit | Fix an off-by-one at a documented threshold, change nothing else, and add named `node:test` cases |
| `edit-reserve-all` | edit | An all-or-nothing operation across two source files with a new error class: a failure must leave nothing half-written |
| `review-total` | review | Find both planted defects in one function by checking it against a written specification |
| `review-stock` | review | Answer a cross-file behaviour question whose correct answer is "no defect" |

The tasks are written to the [skill's templates](../.agents/skills/vibe-supervisor/SKILL.md#write-the-task-from-a-template); the edits carry a frozen contract with a `node_test` check.

## Check review inputs

The MCP wiring test checks the `turn/start` request received by a local app-server test double. It compares the entire prompt with the expected workspace listing, ordered context paths and unchanged task text, including the supplied evidence. The fixture includes a file that must be omitted. Run it independently of model output:

```bash
npx vitest run tests/integration/app-server-wiring.test.ts -t 'delivers the ordered review context'
```

On a real review, compare the frozen request's `context_files` with the executed read paths in the run's private event log. Record missing and extra reads separately from answer quality. The paths are sent in the prompt, and the worker reads their contents through its file tool. The read events show which paths it opened. The hosted model's assembled prompt is outside the scope of these checks.

## Run it

`scripts/quality-pack.mjs` is in the source repository, not the package. Run it from a checkout.

1. Create the project under an allowed workspace root (add the directory with `vibe-supervisor allow` if needed):

   ```bash
   node scripts/quality-pack.mjs create "$ROOT/orders-quality"
   ```

2. For each task, write the request and register it, then start it from Codex with the returned `start_request` as usual ([local operation](local-operation.md)):

   ```bash
   node scripts/quality-pack.mjs request edit-shipping --cwd "$ROOT/orders-quality" > "$REQUESTS/edit-shipping.json"
   ```

   Every task starts from the same clean commit; an edit runs in its own worktree, so the project stays clean between tasks.

3. Check each result. For an edit, export the run with `--include patch` and pass the exported `changes.patch`; for a review, save the final answer text to a file:

   ```bash
   node scripts/quality-pack.mjs check edit-shipping --patch "$EXPORT/changes.patch"
   node scripts/quality-pack.mjs check review-total --answer "$ANSWERS/review-total.txt"
   ```

   An edit check applies the patch to a fresh copy outside any Git checkout, adds hidden tests and runs every test with `node --test`; it fails on a change outside the task's paths, a missing required change or any failing test. It runs the worker's code, so it uses a throwaway directory.

   The review check looks for each expected finding and the cited file. For `review-total`, the shipping finding must identify the strict comparison inside `shippingFor`. The checker also runs the three cases against a temporary copy of the bundled fixture and compares each reported tax, shipping and total with the specification and the code's actual result. Use `--findings-only` to score answers to the original brief, which did not require the per-input results. Read the answer for unsupported findings before accepting it.

`node scripts/quality-pack.mjs list` lists the tasks. Each task's brief, limits, contract, hidden tests and expected findings are under `scripts/quality-pack/`.
