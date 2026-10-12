---
title: "Getting one coding agent to delegate to another without lying to it"
published: false
description: "vibe-supervisor 1.0 lets Codex hand one review or one isolated edit to Mistral Vibe. What I got wrong on the way, and the checks I would make in any agent-to-agent setup."
tags: showdev, mcp, ai, security
---

<!-- Draft for 1.0. Every [EVIDENCE: …] placeholder is filled from the target-machine sitting before publishing; nothing here may claim more than evidence.md records. -->

On October 7 I started a 100-run soak test of a tool that lets one coding agent hand work to another. It failed on run 1. Mistral Vibe had reached its 12-turn budget in 27.4 seconds and exited with code 1, and my supervisor reported `VSUP_BACKEND_CRASHED`. Nothing had crashed. I had turned an incomplete review into the wrong kind of failure.

Five days and twenty release candidates later, [vibe-supervisor](https://github.com/crew-lab/codex-vibe) 1.0 does less than that first version did, and it is better for it. It is a local MCP server that lets Codex delegate one bounded code review, or one edit in a throwaway Git worktree, to Mistral Vibe 2.26.1, and get back a result it can check. This post is about the checks, because they apply to any setup where one agent drives another.

{% card %}
**What it is:** five MCP tools (`vibe_review_start`, `vibe_edit_start`, `vibe_status`, `vibe_result`, `vibe_close`), macOS Apple silicon, Node 20.19 or later, Vibe 2.26.1 exactly. A review only reads and searches; an edit comes back as a patch that is never applied, committed or pushed for you. Shell and network tools are off. It is an application policy boundary, not an OS sandbox: Vibe runs as you, and what it may read is sent to Mistral.
{% endcard %}

## 1. A stop at a limit is neither success nor failure

The soak that died on run 1 taught me this, and Vibe taught it to me twice. Vibe 2.25.8 signalled a turn limit with exit code 1 and a marker; 2.26.1 exits with code 3, prints `Stopped: turn_limit`, and may put a workspace trust warning first. Both times my supervisor first called it a crash. Now a turn limit is reported as `completed` with `stop_reason: max_turn_requests` and an incomplete-result warning, but only when the exit code, the marker and the configured limit all agree. Anything else stays a failure.

Even that check had a trap: my own launcher prints a notice on stderr when it cannot find a Keychain credential, and the strict check treated that line as a conflicting diagnostic. A genuine turn-limit stop would have been recorded as a crash in exactly the runs I was about to test.

Find out how your worker says "I stopped at a limit". Test that your coordinator treats it as neither success nor failure, and test it with whatever else your own wrapper prints.

## 2. Ask the connection, not the config file

The incident that changed the design was boring. An allowlist was updated on disk to approve a new project, and the next delegation was refused before anything started. The running server still held the policy it had read at startup; eight of eleven session snapshots on disk had the old list.

Two lessons. A server that caches policy will eventually disagree with the file you just edited. And checking that the tools exist, or that an old run is readable, says nothing about whether the next task will start.

So the server now rereads the selected configuration before every start, and the allowlist applies without a restart; any other changed setting returns `VSUP_RESTART_REQUIRED` instead of being half-applied. `vibe_status` gained a readiness mode: given a workspace and an operation, it reports the server's version and instance, the policy revision, whether the workspace is eligible and why not, and a short-lived signed receipt. A start can present the receipt, and anything that changed since the check, including the commit an edit will start from, rejects the start before any model call.

The rule I now follow: every delegation begins with a readiness check on the actual connection. A missing tool is a connection failure, a blocker is a preparation failure, and neither is a result from the worker. In particular, neither is a reason to quietly hand the task to a different agent.

## 3. An edit is a patch you review, and the patch must be complete

Edits run in a detached worktree the supervisor creates; the result is a patch. That part worked from the start. Making the patch complete took longer.

A cold review found that if the worker changed a file within the same second and kept its size, the export could treat it as unchanged. Git trusted its own index timestamps. Another review found that in a repository with `core.ignoreStat=true`, every edit to a tracked file was invisible, so the patch came back empty, and verified cleanup then compared an empty export with an empty export, found them equal, and removed the worktree with the edits in it.

That second one is the lesson. The safety check agreed with the bug, because both used the same blind spot. Export and cleanup now work on a private copy of the index with those shortcuts disabled, and a regression test reproduces each case.

## 4. Never accept a worker's account of its own process

The worker has no shell, so it cannot run your tests; the coordinator does, on the exported patch, in a separate copy. A worker that claims "tests pass" is reporting something it could not have done.

The same goes for process claims. In one pilot I told a review to read at most three files. It found the planted bug in 21.5 seconds and said it had stayed within the limit. Its own session history showed five reads. Instruction compliance is now something the evidence counts, never something the answer certifies.

## 5. Shutdown and restart are features

Codex quits, laptops sleep, servers restart. Every run is on disk. After a restart an interrupted run is marked failed and is never resumed or replayed, because replaying an uncertain task is worse than asking again. Shutdown has a deadline, ends only the worker processes the supervisor started itself, and releases its lock.

One surprise from a deterministic rehearsal: the MCP SDK's stdio client escalates to SIGKILL about four seconds after closing the server's stdin, well inside my server's own ten-second shutdown deadline. A slow edit shutdown can be killed mid-way. The next start takes over the stale lock and marks the run failed, which is the designed path, but it is worth knowing what your client will do to your server.

On the real thing: [EVIDENCE: active disconnect run ID and outcome].

## 6. Delete what no real run needs

Between the first soak and 1.0 I removed more than I kept: a second backend that kept a Vibe session open for follow-up corrections, continuation and session recovery, a run queue, idle sessions, permission and input callbacks, an automatic backend choice, several CLI commands and a handful of configuration options. Thousands of lines went. Every boundary stayed.

The flaky tests were the other half. Eleven of twenty-five repeated runs of the suite failed somewhere, across eleven tests. All but one were the tests, not the product: wall-clock budgets under load, a race where the test made a directory read-only just as the supervisor itself restored its permissions, a client that killed the server it was testing. One was real: `doctor` gave Vibe's version check 2.5 seconds, and on a Mac where security software scans every newly written executable before its first run, that was not enough. After the fixes the suite passed ten consecutive runs.

## What it costs

[EVIDENCE: the five hosted runs: timings, stop reasons, Vibe's own cost figures, with conditions.]

All my real runs have fit inside the monthly credit of a free Mistral account: mine shows 8.50 a month, in euros, and [EVIDENCE: credit used at publishing]. Check your own account; Mistral's pricing page lists limited coding sessions on the free plan but not a credit amount.

## Steal this checklist

{% card %}
1. **A stop at a limit is neither success nor failure**, and you have tested how your worker signals it.
2. **Readiness is checked on the live connection**, against the current policy, before every delegation; connection and preparation failures are not worker results and do not trigger a silent substitute.
3. **The worker's output is an artifact you review**, exported completely, and your cleanup check does not share the exporter's blind spots.
4. **Process claims are counted from evidence**, never taken from the worker's answer.
5. **Runs survive a restart without replay**, and shutdown is bounded and only touches what it started.
6. **Every option is a path you must test on real runs**; remove the ones nobody uses.
{% endcard %}

## Try it

macOS Apple silicon, Node 20.19 or later, Git, and Vibe 2.26.1 (`uv tool install mistral-vibe==2.26.1`, then log in once with `vibe`). Install the release tarball from [EVIDENCE: GitHub release URL] after checking `SHA256SUMS`, then:

```sh
vibe-supervisor setup --workspace /absolute/path/to/repo --dry-run
vibe-supervisor setup --workspace /absolute/path/to/repo --yes
```

Restart Codex, ask it to check readiness for that repository, then ask for a review of one file. A clean-account installation is planned for 1.0.1. This is an independent project, not affiliated with OpenAI or Mistral AI.

{% embed https://github.com/crew-lab/codex-vibe %}

## Your turn

When your sub-agent stops at a limit, what does your coordinator actually see? And when your cleanup check says everything matches, are you sure it is not making the same mistake as the thing it checks?

*This article was written with AI assistance and checked against the project's recorded test evidence.*
