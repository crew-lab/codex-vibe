# Usefulness log

Whether delegated runs on real projects produced an answer the coordinator accepted. Fixture acceptance cases are not listed; they test the lifecycle, not usefulness. Each row comes from recorded evidence; private project source is not reproduced. Turns used and cost are not recorded by the supervisor yet (usage UNKNOWN), so only the limit and the wall time are given.

| Date | Version | Run | Operation and task shape | Limits, outcome | Accepted | Why |
|---|---|---|---|---|---|---|
| 2026-10-13 | 0.9.0-rc.28 | `099f19a0` | Review of a real project; task text is not in the public record | completed safely | No | Findings failed answer acceptance ([rc.28 target](reviews/rc28-target-test-2026-10-13/target-acceptance.json)) |
| 2026-10-13 | before rc.1 | `4ba5e305` | Edit involving two workflow files | empty patch; the worker said tools were unavailable | No | Cause UNKNOWN; led to the effective-tool check in rc.1 ([diagnosis](../reviews/practical-tool-access-2026-10-13.md)) |
| 2026-10-13 | 1.0.0 | `1284e7c0` | Review, one file, one question, ten named inputs, "no defect found" allowed, answer under 25 lines | `max_turns` 12, `end_turn` | Yes | 11 parser and URL cases checked independently ([report](reviews/v1-confirmation-2026-10-13/REPORT.md)) |
| 2026-10-13 | 1.0.0 | `6e141ea6` | Review, one file, same template | `max_turns` 12, `end_turn` | Yes | 5 array-isolation cases checked independently (same report) |
| 2026-10-14 | 1.0.1-rc.1 | `0dacfbbc` | Edit, read two files, change one; requirement stated as "exactly one checksum record" with the rejections named in prose | `max_turns` 12, `end_turn`, 64 s | No | The 16 given fixtures passed, but trailing junk after one valid record was accepted; the edge was not among the named cases ([rc.1 report](../reviews/rc1-hosted-2026-10-14/REPORT.md)) |
| 2026-10-14 | 1.0.1-rc.1 | `8f230f62` | The same edit, re-specified with the whole-file contract and each rejection spelled out | `end_turn`, 89 s | Yes | 18 of 18 fixtures and an independent source review; the worker's summary misstated a byte count that its code computed correctly |

## What the evidence says so far

Six real-project runs: three accepted, three not. Every accepted run had a narrow scope and an enumerated set of inputs or rejections to satisfy. The only rejected run whose task is on record, the first edit, named some of its cases in prose and missed an unnamed one. The edit that failed and the edit that passed differ only in how explicitly the edge cases were listed. Six runs are a pattern to test, not a measured rate.

Changes these rows support, and nothing more:

- The edit template should say "Must reject: <case>, <case>" alongside "Change:", the way the review template says "Evaluate these inputs". Added to the skill as "Must reject or preserve".
- Numbers in a worker's summary are not evidence; the coordinator checks the code or the patch. The skill already requires this.

Next entries come from authorized real-project runs. Record a rejected answer as plainly as an accepted one.
