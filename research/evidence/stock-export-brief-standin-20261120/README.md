# The stock-export brief scored with stand-in workers, 2026-11-20

The exact worker input for `edit-stock-export` ([prompt.txt](prompt.txt): the supervisor's Vibe edit rules and the task) was given to four small general models. Each worked in its own copy of the fixture project, could read and write files there, and was told to run nothing. The patches under `answers/` are what they wrote; each was scored by `scripts/quality-pack.mjs check edit-stock-export`, with the hidden checker unchanged.

This is a floor test of a brief: it shows that a brief is fragile, not that Vibe will pass it.

The brief scored here is the one that gives the `parseArgs` option key, the expected file content and both error messages as literals. On Vibe 3.1.3 the earlier brief passed 3 of 5 on its patch; both rejections were readings that brief left open ([trial](../vibe-313-stock-export-20261119/README.md)). The earlier brief was not run through stand-ins, so this is not a before-and-after comparison.

| Answer | Model size | Verdict | Hidden tests |
| --- | --- | --- | --- |
| `standin-1.patch` | small | passed | 19 passed, 0 failed |
| `standin-2.patch` | small | passed | 19 passed, 0 failed |
| `standin-3.patch` | mid | passed | 19 passed, 0 failed |
| `standin-4.patch` | mid | passed | 19 passed, 0 failed |

All four used `options: { 'out-dir': { type: 'string' } }` and read `values['out-dir']`. The next measurement is five samples on the worker with this brief.
