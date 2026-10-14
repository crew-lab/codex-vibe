# Quality and performance audit — 2026-10-13

## Verdict

The frozen 1.0.1-rc.1 candidate has strong **local** correctness and safety evidence, with small measured local control overhead. It is not yet certified for hosted edit quality or end-to-end latency. Current native connection was rechecked and still reports 1.0.0; the six authorized candidate trials remain unused.

The historical empty-patch failure remains FAIL with root cause UNKNOWN. Effective-tool enforcement prevents an inventory mismatch from reaching model tool use, but does not guarantee that the model invokes available tools or produces a correct patch.

## Correctness and quality evidence

- Independent source review accepted the inventory guard and bounded diagnostics after initialization, exit-flush and concurrent-write defects were corrected.
- Full checks pass on Node 24.21 and exact Node 20.19: 650 Node tests and 77 Python tests per runtime, plus lint/typecheck/build/acceptance/secret scan/SBOM. Offline installed-package smoke passes.
- Actual pinned Vibe profile/file-tool tests cover both roles, missing/extra tools, ordinary and hidden workflow reads, denylisted and outside-root paths. They are local tests with network disabled, not hosted evidence.
- Frozen archive and all 140 installed entries match. The runtime patch independently applies/reverses; dependency versions, allowlists and worker shell/network boundaries are preserved.
- Diagnostics contain approved tool names and outcomes, with size/event limits and explicit truncation. Pre-invocation permission rejections remain outside this trace; absence of an invocation cannot prove the model made no request.

Evidence: [completion audit](rc1-completion-audit.md), [source review and regression results](REPORT.md), [installed-file identity](rc1-installed-files.json), [exact-floor supplement](rc1-node20-supplement.json).

## Measured local performance

The published 1.0.0 runtime, new inventory guard, and new guard with diagnostics were compared in separate private processes against installed Vibe 2.26.1 / CPython 3.12.13 on macOS arm64. Both roles were tested with three repeats each: 18 samples, 1,800 actual synthetic workflow-file reads, 10,000 inventory lookups per sample. Ordering alternated between repeats. Socket connections were disabled; credential resolution and model inference were never called.

Values below are medians across the three process samples for each role/variant; they are not hosted service percentiles.

| Local operation | Published baseline | Guard | Guard + diagnostics |
| --- | --- | --- | --- |
| Initialization, review | 209 ms | 274 ms | 206 ms |
| Initialization, edit | 206 ms | 210 ms | 207 ms |
| Workflow read, review | 0.158 ms | 0.176 ms | 0.176 ms |
| Workflow read, edit | 0.159 ms | 0.156 ms | 0.160 ms |
| Inventory lookup, review | 71.9 µs | 84.8 µs | 78.7 µs |
| Inventory lookup, edit | 78.5 µs | 79.7 µs | 80.0 µs |

The hook setup itself took 59–67 ms, including imports/source validation; it runs once per child process. The initialization results are noisy and do not establish a consistent whole-process startup delta. No large repeatable read-latency regression was observed in these samples.

Writing diagnostics with 200 invocation events took median 0.041–0.044 ms and produced 8,562–8,582 bytes. Production writes run once per second plus final flush, rather than once per tool event. Median peak RSS was about 59–60 MiB across variants, with less than 0.3 MiB difference between their recorded medians. These are local observations, not a memory guarantee.

Limits: tiny synthetic files; no provider latency, large workspace/export load, delayed stack snapshots, concurrent hosted tools, sustained soak or full filesystem latency distribution was measured here. Existing bounds/regressions cover the control contracts; actual end-to-end performance remains a hosted gate. Do not extrapolate these microbenchmarks to an all-task throughput claim.

Reproducible evidence: [raw samples](performance/samples.json), [summary](performance/summary.json), [Python probe](performance/vsup_perf_probe.py), [driver](performance/vsup_perf_driver.mjs). The driver uses private temporary profiles and synthetic files. It is verification tooling, not a production change.

## Hosted acceptance still required

Use only the [six authorized assignments](proposed-hosted-assignments.json), after a restart and native readiness reporting exact 1.0.1-rc.1. Normal tasks have 12 turns/180 seconds; low-turn tasks have one turn/180 seconds. Stop at the first unexpected failure; preserve diagnostics and exports; no retry or enlarged budget.

For the practical workflow edit, require a nonempty patch confined to the writable file, independent source review, and all 16 actual-command rollback fixtures passing in a disposable export. Luna repairs do not convert that run to PASS. Record actual duration, stop reason, warnings, available invocation evidence, patch/integrity identities and cleanup. Costs remain UNKNOWN unless supplied.

The low-turn and active-disconnect cases test incomplete settlement, no replay, termination, saved-record access and worktree retention. Any uncertain termination blocks further dispatch. Fresh-account installation remains required before stable 1.0.1. Publication is not authorized by this audit.
