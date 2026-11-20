# Vibe 3.1.3 trial on main 70b2c16

A clean checkout of `70b2c16` passed release verification: 134 test files, 2,012 tests passed and one skipped. The 2.2.2 archive and its matching preparation kit were built with `package:rc`; installed-candidate preparation passed with Vibe 3.1.3 and no findings. Candidate SHA-256: `35f2389097d816c633d9868973cf4b6706c1e121fe8aab74749b30802d7b2498`. The hosted trial used `mistral-medium-3.5` and a standalone connection.

The prior stock-export sample `next-6` record does not contain the underlying wire error code, and its saved run was not found on this machine. Its independent patch check passed 20 tests, while execution failed. The new late-provider-error behavior cannot yet be related to that wire code.

| Task | Independent result | Execution | Seconds | Model calls | Tokens |
| --- | --- | --- | ---: | ---: | ---: |
| review-stock | 4/4 | completed, end_turn | 19.9 | 2 | 14,401 |
| review-total | 9/9 | completed, end_turn | 47.9 | 2 | 21,866 |
| edit-shipping | 14/14 | completed, contract passed, end_turn | 9.9 | 4 | 29,694 |
| edit-reserve-all | 17/17 | completed, contract passed, end_turn | 16.6 | 7 | 59,341 |

Both reviews read exactly their three named files, with no extra reads, and used thinking `high`. Both edits used thinking `off`, passed their contracts and independent tests, and were assessed accepted. Its sanitized record is in `records/`. This is a partial trial: the hard-edit samples, late-stall observation, thinking comparison and native Codex delegation checks are not established by this result.
