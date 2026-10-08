---
title: "Codex + Mistral Vibe over MCP: read-only reviews, edits as patches"
published: false
description: "An MIT-licensed MCP server that lets Codex hand reviews and edits to Mistral Vibe. Reviews are read-only; edits come back as patches."
tags: showdev, mcp, ai, opensource
cover_image: TODO
---

<!-- Draft 1, 2026-10-08. [author] marks what only the author can write. Every number must match evidence.md before publishing. AI disclosure: AI-Assisted. -->

{% card %}
**TL;DR** vibe-supervisor is a local MCP server that lets Codex hand code reviews and edits to Mistral Vibe. Reviews only get read and search tools. Edits run in a throwaway Git worktree and come back as a patch you apply yourself. macOS, Vibe 2.25.8, MIT licensed, version [VERSION].
{% endcard %}

[author: two or three sentences in your own words. Why you wanted a second reviewer from a different model family inside Codex, and the moment you realised that wiring one agent into another needed more than a config line.]

![30-second recording: Codex starts a Vibe review, waits, reads the findings, then delegates a fix and shows the patch](TODO-gif "Codex delegating a review and an edit to Vibe")

## What goes wrong when one coding agent drives another

Giving Codex a tool that starts another agent is a few lines of MCP configuration. Living with it is harder. These are the failures I wanted to rule out before I trusted it with a real repository:

- The second agent writes into your working tree while it is supposed to be reviewing it.
- It gets a shell or network access because its default configuration allows them.
- Credentials end up in a log, in a transcript or in the process list.
- Codex restarts, and the run, its session and its half-finished patch are gone.
- The coordinating model does not know whether to wait, poll or give up, and burns tokens polling.
- A run says "completed" when the worker actually stopped at a limit halfway through.

Each one has a guardrail below, and two of them bit me on real runs anyway.

## A delegated review, seen from Codex

From Codex you ask in plain words, with an absolute path and a concrete scope:

> Use Vibe to review `/absolute/path/to/repo` for correctness bugs in the authentication module. Read only. Report findings with file and line, and tell me if the review stopped early.

Codex then makes three tool calls. It starts the review with `vibe_review_start` and `wait_seconds` between 120 and 300, so the call itself blocks until the run needs attention. If the run is still going, it calls `vibe_status` with the same wait. When the run settles, the reply already carries a compact result, and Codex closes the run with `vibe_close`.

The result is small on purpose. These are the fields Codex has to check before it believes anything (shape only; the values are illustrative):

```json
{
  "state": "completed",
  "stop_reason": "end_turn",
  "summary": "…",
  "warnings": [],
  "integrity": { "status": "verified", "write_tool_observed": false },
  "next_action": "Read the result, then call vibe_close when you no longer need the run."
}
```

[replace with a real, redacted result from the Phase D session]

`stop_reason` says whether Vibe finished its answer or stopped at a limit. `integrity` says whether the workspace changed while the review was reading it. `next_action` is one sentence telling the coordinator what to call next, so it does not need a skill installed to drive the loop correctly.

## Edits come back as a patch

An edit request looks the same, with a Git base:

> Use Vibe to fix the input validation bug in `/absolute/path/to/repo/src/validate.ts` in an isolated worktree from `HEAD`. Show me the patch and run the tests yourself before I apply anything.

The supervisor creates a detached Git worktree from that base, gives Vibe read, search, write and edit tools inside it and nothing else, and exports the result as a patch. Small patches come back inline; larger ones are saved next to the run. Nothing is applied to your checkout, committed, merged or pushed.

Vibe has no shell, so it cannot run your tests. Codex does that, against the worktree, and asks for corrections if they fail. One thing caught me out early: the worktree starts from the base you name, so uncommitted changes in your checkout are not in it.

When you are done, `vibe_close` with `cleanup_worktree: true` removes the worktree, but only after a fresh export still matches the saved patch and no unexplained files are left. Otherwise it keeps the worktree and tells you why.

## How the pieces fit

![Diagram: Codex talks MCP over stdio to vibe-supervisor; the supervisor keeps an allowlist, run records and worktrees, and launches Vibe 2.25.8 through a launcher shim with a private home; Vibe talks to Mistral](TODO-diagram "How vibe-supervisor sits between Codex and Vibe")

Codex starts `vibe-supervisor` as an MCP server over stdio. The supervisor checks that the workspace is under an allowlisted root, records every run on disk, and launches Vibe through a small Python launcher shim. The shim refuses any Vibe other than 2.25.8, gives each run a private `HOME` with only the supervisor's own agent definitions, keeps the task text out of the process list, and filters what Vibe writes to its own session history.

There are two ways to talk to Vibe. The default runs it once per task in programmatic mode, which is enough for most reviews and edits. The opt-in ACP mode (Agent Client Protocol) keeps a session open, so Codex can send corrections to the same worker with `vibe_continue`.

## Guardrails, and what they do not cover

- Workspaces must be under an explicit allowlist, which starts empty.
- Reviews get `read_file` and `grep`. Edits add `write_file` and `edit`, inside the worktree only.
- Shell and network tools are off, and there is no setting to turn them on.
- Each run has a private home and a filtered environment; your Vibe config, project trust, hooks, skills and MCP servers are not inherited.
- Secrets are redacted from what the supervisor stores, and the model's reasoning is not stored at all.
- Time, turns and output are bounded per run.
- Permission requests from Vibe are matched to the tool call they belong to; anything unknown is refused.

What this is not: an operating-system sandbox. Vibe still runs as your user, and the file content it is allowed to read is sent to Mistral. Redaction catches known secret formats, not every possible one. Treat a delegated run like running someone else's code with your permissions, on a repository you are willing to share with the provider.

## Two things that broke on real runs

[author: one line on how it felt to watch the first soak stop on run 1.]

The first 100-run soak on a real Mac stopped on its very first run. A broad review asked Vibe to look for missing error handling across the repository. Vibe used its 12-turn budget in 27 seconds, printed a stop marker and exited with code 1. The supervisor saw a non-zero exit and reported `VSUP_BACKEND_CRASHED`. Nothing had crashed: Vibe had stopped at its limit. The supervisor now recognises that exit only when the exit code, the final message, the stderr marker and the configured turn count all agree, and reports it as `completed` with `stop_reason: max_turn_requests` and a warning that the result may be partial. The default review budget is now 20 turns.

The second came from a real deployment task. An ACP run used up its turns without a patch, and continuing the same session "remained exhausted". Reading Vibe 2.25.8's source explained it: Vibe counts turns per session, not per prompt, and keeps the count when a session is reloaded. Once the budget is spent, every further prompt returns the same stop reason without doing any work. The supervisor now refuses that continuation with `VSUP_TURN_LIMIT_REACHED` and asks for a larger `max_turns`, which it passes to Vibe before the next prompt. [Phase D, D21: confirm on a real run before publishing.]

## Overhead, measured

The supervisor should not be the slow part. On a real Mac with Vibe 2.25.8 (`mistral-medium-3.5`), through the official MCP client:

| What | Time |
|---|---|
| Review of a nested file, cold / warm | 8.9 s / 3.8 s |
| Edit producing an eleven-file patch | 12.1 s |
| `vibe-supervisor doctor` | 1.4 s |
| Supervisor startup after a restart | 98 ms |

Most of that is the model. The supervisor's own costs, measured with fake backends on the development machine:

| Path | Before | After |
|---|---|---|
| Review snapshot of a 156,169-file tree (mostly `node_modules`), per pass | 30.2 s | 2.6 s |
| Patch export with one changed and 50 new files | 1.6 to 2.1 s | 0.13 s |
| Saving 1,000 events | 4.8 s | 18 ms |

[add the 100-run soak results: failures by code, p50 and p95, after Phase D]

## Trade-offs I chose

- **No shell for the worker.** Vibe cannot run tests, so Codex does. That is slower, but a reviewer that can run arbitrary commands is a different risk.
- **An exact Vibe version.** The shim depends on Vibe internals, so any other version is refused. Vibe 2.26.0 came out in October 2026 and is not supported yet; supporting it means re-checking those internals and rerunning the hosted tests.
- **Patches are never applied for you.** You read them and apply them.
- **Ignored files are compared by metadata.** Files Git can see are hashed, so a review that changes one is caught. A write to an ignored path such as `node_modules/` that keeps size, time and inode would be missed.
- **One supervisor per data directory.** Several Codex windows need `--isolated`, which gives each its own directory.
- **macOS only**, for now.

[author: which of these you went back and forth on, and why you landed where you did.]

## When not to use it, and the alternatives

If you do not have Vibe access, use Linux or Windows, or want the helper to run your tests, this is not for you. Other MCP clients may work but only Codex is tested.

The honest baseline is running Vibe in a second terminal and pasting results back. General delegation servers such as codex-subagents-mcp, mcp-delegate and the various agent bridges let one agent call another with fewer guardrails and more flexibility. [recheck each at writing time]

## Try it in five minutes

You need macOS, Node.js 20.19 or newer, Git, and Mistral Vibe with access through a Mistral plan:

```sh
uv tool install mistral-vibe==2.25.8
vibe
```

Finish the browser login once, then install the release and check it:

```sh
shasum -a 256 -c SHA256SUMS
npm install -g ./vibe-supervisor-[VERSION].tgz
vibe-supervisor setup --workspace /absolute/path/to/your/repo
```

`setup` adds the workspace to the allowlist, records where `vibe` lives, runs a health check, and shows the Codex configuration change before writing it. Restart Codex, and try the review prompt above.

[test every command on a clean macOS account before publishing]

## Status

[VERSION] covers reviews and edits in both modes, recovery after restarts, and several Codex clients at once. What is verified and what is not is listed in one place in the repository's compatibility notes. This is an independent project, not affiliated with OpenAI or Mistral AI.

{% embed https://github.com/crew-lab/codex-vibe %}

[author: one specific question for the comments, for example: which task would you hand to a second model first, and which guardrail would you insist on?]

*This article was written with AI assistance and checked against the project's recorded test evidence.*
