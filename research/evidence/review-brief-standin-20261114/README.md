# Review briefs scored with stand-in workers, 2026-11-14

The exact worker input for each brief (the supervisor's Vibe review rules, the task prompt, and the three fixture files as `read_file` would return them) was given to a small general model with no tools, and the answer was scored by `scripts/quality-pack.mjs check`. The answers here are those files, unedited. They quote only the quality pack's public fixture.

This is a floor test of a brief: it shows that a brief is fragile, not that Vibe will pass it. The stand-ins passed `review-stock` on the old brief, where Vibe 3.1.2 failed 0 of 15.

- `total-v0`, `stock-v0`: the briefs as they were at `54f1b37`.
- `total-v1`, `stock-v1`: a literal answer template, quoted source lines, working first.
- `total-v2`: `total-v1` plus the totals observed by running the code and a fill-in form. `total-v2` and `stock-v1` are the briefs now in `scripts/quality-pack/tasks/`.

Scores below are from the checker as it is now (it reads only the filled-in form). With the checker as it was at `54f1b37`, `total-v2` passed 1 of 5: four answers repeated the `Input N:` headings in their working.

| Answer | Task | Verdict | Failed checks |
| --- | --- | --- | --- |
| `stock-v0.run1.txt` | review-stock | pass |  |
| `stock-v0.run2.txt` | review-stock | pass |  |
| `stock-v0.run3.txt` | review-stock | pass |  |
| `stock-v1.run1.txt` | review-stock | pass |  |
| `stock-v1.run2.txt` | review-stock | pass |  |
| `stock-v1.run3.txt` | review-stock | pass |  |
| `stock-v1.run4.txt` | review-stock | pass |  |
| `total-v0.run1.txt` | review-total | fail | threshold-at-5000 |
| `total-v0.run2.txt` | review-total | pass |  |
| `total-v0.run3.txt` | review-total | fail | threshold-at-5000 |
| `total-v1.run1.txt` | review-total | pass |  |
| `total-v1.run2.txt` | review-total | fail | input-2-actual |
| `total-v1.run3.txt` | review-total | fail | input-1; input-2; input-3 |
| `total-v1.run4.txt` | review-total | pass |  |
| `total-v2.run1.txt` | review-total | pass |  |
| `total-v2.run2.txt` | review-total | pass |  |
| `total-v2.run3.txt` | review-total | pass |  |
| `total-v2.run4.txt` | review-total | pass |  |
| `total-v2.run5.txt` | review-total | pass |  |
