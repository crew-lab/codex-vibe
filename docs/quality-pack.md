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

3. Check each result. For an edit, export the run with `--include patch` and pass the exported `changes.patch`; for a review, export with `--include answer` and pass the exported `answer.txt`, or save the final answer text to a file:

   ```bash
   node scripts/quality-pack.mjs check edit-shipping --patch "$EXPORT/changes.patch"
   node scripts/quality-pack.mjs check review-total --answer "$EXPORT/answer.txt"
   ```

   An edit check applies the patch to a fresh copy outside any Git checkout, adds hidden tests and runs every test with `node --test`; it fails on a change outside the task's paths, a missing required change or any failing test. It runs the worker's code, so it uses a throwaway directory.

   The review check looks for each expected finding and the cited file. For `review-total`, the shipping finding must identify the strict comparison inside `shippingFor`. The checker also runs the three cases against a temporary copy of the bundled fixture and compares each reported tax, shipping and total with the specification and the code's actual result. When an Expected or Actual line is missing or malformed, its detail quotes the nearest line that mentions it. Use `--findings-only` to score answers to the original brief, which did not require the per-input results. Read the answer for unsupported findings before accepting it.

## Make a record

`record` turns one export into a small JSON record that can be committed and sent back, so a failed run can be explained from more than a hash.

```bash
vibe-supervisor runs export "$RUN_ID" --out "$EXPORT" --include answer
node scripts/quality-pack.mjs record review-total --export "$EXPORT" --out records/review-total.json
```

For an edit task, export with `--include patch` instead. `--include answer` is refused when the run has no answer of the worker's own (`answer_present` is not true), so a supervisor-written summary is never graded as an answer; `record` also checks `answer.txt` or `changes.patch` against the bundle's `SHA256SUMS`. `record` refuses unless the export's `provenance.task_sha256` equals the SHA-256 of the pack's own task text, because the answer quotes source lines and a record may only be made for the pack's public fixture. The error names the task the hash did or did not match.

It runs the same check as `check` on `answer.txt` or `changes.patch`, prints the record and, with `--out`, also writes it; an existing file is never overwritten. The record holds the task id, the verdict and every check with its detail, the answer text (reviews), the stop reason, usage (tokens, model calls, tool calls), the thinking level, the supervisor version, the worker backend and version, `context_reads` when the run recorded it, `execution_state`, `answer_present` and `task_hash_matched`. It holds no path, prompt, transcript or reasoning.

## Inspect the brief

`prompt` prints what the worker receives, without a worker:

```bash
node scripts/quality-pack.mjs prompt review-total --worker vibe
```

The output has two labelled parts: the supervisor's worker rules for that worker and mode, then the task prompt as the supervisor assembles it (context paths or writable paths and the acceptance contract, then the task). Vibe receives the rules as its system prompt and the Antigravity worker at the head of its prompt. The workspace listing an edit run adds is not shown. It reads the built output, so run `npm run build` first.

## What the reviews measure

The review brief for `review-total` gives the worker the totals the coordinator observed by running the code. The task therefore measures explaining a measured difference and finding the wrong lines, not unaided arithmetic.

The checker reads the answer form and ignores the same labels in the working. Scores from before the checker change of 2026-11-13 are not comparable with later ones.

`node scripts/quality-pack.mjs list` lists the tasks. Each task's brief, limits, contract, hidden tests and expected findings are under `scripts/quality-pack/`.
