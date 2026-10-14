---
title: "Getting one coding agent to delegate to another without lying to it"
published: false
description: "vibe-supervisor 1.0 lets Codex hand one review or one isolated edit to Mistral Vibe. What I got wrong on the way, and the checks I would make in any agent-to-agent setup."
tags: showdev, mcp, ai, security
---

On October 7 I started a 100-run soak test of a tool that lets one coding agent hand work to another. It stopped at run 1. Mistral Vibe had reached its 12-turn limit after 27.4 seconds and exited with code 1, and my supervisor reported `VSUP_BACKEND_CRASHED`. Nothing had crashed. I had turned an incomplete review into the wrong kind of failure.

[vibe-supervisor](https://github.com/crew-lab/codex-vibe) 1.0 came out of that, after 28 release candidates in eleven days. It is a local MCP (Model Context Protocol) server that lets Codex hand one bounded code review, or one edit in a throwaway Git worktree, to Mistral Vibe 2.26.1, and get back something it can check. The tool has a narrow audience. The checks apply to any setup where one agent drives another.

{% card %}
**What it is:** five MCP tools, macOS Apple silicon, Node 20.19 or later, Vibe 2.26.1 exactly. A review only reads and searches. An edit comes back as a patch that is never applied, committed or pushed for you. Shell and network tools are off. It is an application policy boundary, not an OS sandbox: Vibe runs as you, and what it may read is sent to Mistral.
{% endcard %}

## The problem

When Codex delegates to another agent, it gets back text saying what the worker did and whether the tests pass. Every statement is a claim by the thing you are checking.

Running the worker in a terminal and pasting the result is the honest baseline. What it lacks is a contract for when the worker stops at a limit, the connection is down, the app restarts mid-run, or a safety check is wrong in the same way as the thing it checks. Here is the checklist I ended up with, and how this tool does each item.

## The checklist

### 1. A stop at a limit is neither success nor failure

Vibe 2.25.8 signalled a turn limit with exit code 1 and a marker. Version 2.26.1 exits with code 3 and prints `Stopped: turn_limit`, sometimes after a workspace trust warning. Both times my supervisor called it a crash.

Now a turn limit is reported as `completed` with `stop_reason: max_turn_requests` and an incomplete-result warning, but only when the exit code, the marker and the configured limit all agree. Anything else stays a failure.

Even that had a trap: my own launcher prints a notice when it finds no Keychain credential, and the strict check read that line as a conflicting diagnostic. Find out how your worker says "I stopped at a limit", and test it with whatever else your own wrapper prints.

### 2. Ask the connection, not the config file

An allowlist was updated on disk to approve a new project, and the next delegation was refused. The running server still held the policy it read at startup.

The server now rereads the selected configuration before every start, so an allowlist change applies without restarting Codex. Any other changed setting returns `VSUP_RESTART_REQUIRED` instead of being half-applied. `vibe_status` has a readiness mode: given a workspace and an operation, it reports the server version, the policy revision, whether the workspace is eligible and why not, and a signed receipt valid for ten minutes. A start can present the receipt, and anything that changed since rejects the start before any model call.

A missing tool is a connection failure. A blocker is a preparation failure. Neither is a worker result, and neither is a reason to quietly hand the task to a different agent.

### 3. The worker's output is an artifact, and it must be complete

An edit runs in a detached worktree the supervisor creates, and the result is a patch. Making it complete took longer than making it exist. A cold review found that if the worker changed a file within the same second and kept its size, the export could treat it as unchanged, because Git trusted its own index timestamps. The export now forces a re-hash on a private copy of the index.

### 4. The safety check must not share the exporter's blind spot

The next cold review found the worse case. In a repository with `core.ignoreStat=true`, edits to tracked files were invisible, so the patch came back empty. Verified cleanup then compared an empty export with an empty export, found them equal, and could remove the worktree with the edits in it.

The check agreed with the bug because both used the same blind spot. Export and cleanup now work on a private index copy with those shortcuts cleared. If your cleanup decision relies on the same code path as your export, it is not a check.

### 5. Count process claims, never believe them

The worker has no shell, so it cannot run your tests. The coordinator runs them, on the exported patch, in a separate copy. A worker that says "tests pass" is reporting something it could not have done. Process claims fare no better. In an earlier pilot I told a review to read at most three files. It found the planted bug in 21.5 seconds and said it had complied. Its own session history showed five reads. Instruction compliance is now something the evidence counts, not something the answer certifies.

### 6. Runs survive a restart without replay

Codex quits and laptops sleep. After a restart an interrupted run is marked failed and is never relaunched or replayed, because replaying an uncertain task is worse than asking again. There is one active run per server, an owner lock, and a bounded shutdown that ends only the worker processes the supervisor started. One surprise: the MCP SDK's stdio client sends SIGKILL about four seconds after closing the server's stdin, which can cut a slow edit shutdown short. The next start recovers by design.

### 7. Delete what no real run needs

Between the first soak and 1.0 I removed more than I kept: a second backend that held a Vibe session open, session recovery, a run queue, several CLI commands and a handful of options. Two candidates alone, rc.15 and rc.16, removed about 770 net lines. Every boundary stayed.

The test suite got the same treatment: in rc.26 I replaced wall-clock budgets with the properties they stood for and fixed four test races. One failure was real. `doctor` gave Vibe's version check 2.5 seconds, too little on a Mac that scans a new executable before its first run. It now gets 15.

### 8. Two agents on one repository need a fetch-before-fix rule

I built this with two agents on two machines: Claude on the preparing machine, Codex on the target machine that ran the real Vibe. One CI run went red because both agents fixed the same test runner. Now each fetches and checks open pull requests before fixing a shared problem.

## The evidence

1.0 passed four hosted gates on the target machine on October 13, recorded in `docs/acceptance.json`: native readiness on the Codex desktop connection; a five-run matrix with readiness receipts (normal review, verified edit, a review and an edit at the turn limit, a second normal review) with no retries or repairs; provider authentication during a real run; and one real client disconnect mid-run through the official client, after which the worker was gone, the lock released and the run failed and never relaunched. The failures matter more than the passes.

**The desktop disconnect was inconclusive.** In the Codex desktop attempt the worker finished before I disconnected, so it proved nothing. I adopted one official-client observation instead, by explicit decision. It is one observation, not a soak.

**The first real-project review failed.** I asked for a broad review of a small production website. The run completed safely, but its findings failed my acceptance check.

Two later reviews of the same project, each scoped to one file and one question, with ten named inputs and "no defect found" allowed, passed. I checked them independently: 11 parser and URL cases in one, 5 array-isolation cases in the other. That does not show the model is accurate in general. It shows that narrow tasks with enumerated inputs worked.

**Two real edits failed, then one passed.** The first returned an empty patch, with the worker saying its tools were unavailable. I still do not know why. The second, on 1.0.1-rc.1, required "exactly one checksum record", with the rejections described in prose. The 16 fixtures I gave passed, but one valid record followed by trailing junk was accepted. That edge was not among the named cases. I re-specified the task with the whole-file contract and each rejection spelled out, and the next run passed 18 of 18 fixtures plus an independent source review. Its summary still misstated a byte count that its code computed correctly, which is item 5 again.

The usefulness log holds six real-project runs: three accepted, three not. Six is a pattern to test, not a rate. The edit template now says "Must reject or preserve" next to "Change".

**Cost is unknown.** The supervisor does not record usage yet. Early edits cost about $0.02 each as Vibe reported, and my free Mistral account, which shows a monthly credit of 8.50 in euros, had used 1.20 after all real runs up to rc.8. I have no figure for later runs and claim no savings.

**My own cold review of rc.1 found problems.** An optional diagnostics file could make a completed run lose its transcript, and public evidence files contained private paths. One question is open: does Vibe give the model its tools only through the property my new check validates? I will answer it from Vibe's source before stable 1.0.1.

## What is next

**1.0.1** adds the effective-tool check from rc.1, documentation and task templates from the usefulness log. It is blocked on a clean macOS account install that a person must run and that has not happened yet.

**Usage from Vibe's own export.** Vibe writes an `export.json` with token usage, cost and outcome on programmatic runs. The supervisor never asked for it. Reading it is planned for 1.1 and would close the unknown cost.

**A Unified Harness adapter.** Vibe's source calls the legacy harness, which 1.0 uses, a temporary escape hatch kept until the legacy runtime is removed. That is the main risk to this project. The adapter would keep the same boundaries and pin one version. Until it exists, later Vibe releases are refused, which is intended.

## Steal this checklist

{% card %}
1. A limit stop is neither success nor failure; you tested how your worker signals it.
2. Readiness is checked on the live connection before every delegation; no silent substitute.
3. Worker output is an artifact you review, exported completely.
4. Your cleanup check does not share the exporter's blind spot.
5. Process claims are counted, not believed.
6. Runs survive restart without replay; shutdown is bounded.
7. Every option is a path you must test; remove unused ones.
8. Agents sharing a repository fetch and check before fixing.
{% endcard %}

## Try it

You need macOS Apple silicon, Node 20.19 or later, Git, and Vibe 2.26.1 exactly. The README has the steps: take the release tarball, check its checksums, install it into a private prefix and register it with Codex. A clean-account install has not been run yet. This is an independent project, not affiliated with OpenAI or Mistral AI.

- Release: [v1.0.0 on GitHub](https://github.com/crew-lab/codex-vibe/releases/tag/v1.0.0)
- Repository, with the acceptance record and dated evidence: [crew-lab/codex-vibe](https://github.com/crew-lab/codex-vibe)

{% embed https://github.com/crew-lab/codex-vibe %}

## Your turn

When your sub-agent stops at a limit, what does your coordinator actually see? And is your cleanup check making the same mistake as the thing it checks?

*This article was written with AI assistance and checked against the project's recorded test evidence.*
