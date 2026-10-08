---
title: "Codex + Mistral Vibe over MCP: read-only reviews, edits as patches"
published: false
description: "An MIT-licensed MCP server that lets Codex hand reviews and edits to Mistral Vibe. Reviews are read-only; edits come back as patches."
tags: showdev, mcp, ai, opensource
---

{% card %}
**TL;DR** vibe-supervisor is a local Model Context Protocol (MCP) server that lets Codex hand code reviews and edits to Mistral Vibe. Reviews get read and search tools only. Edits run in a throwaway Git worktree and come back as a patch you apply yourself. macOS, Vibe 2.25.8, MIT licensed. The current build is release candidate 0.9.0-rc.8, and I am looking for people to try it before 1.0.
{% endcard %}

I wanted a second code reviewer from a different model family inside Codex, and I did not want to give it write access to my checkout to get one. Wiring one coding agent into another is a few lines of MCP configuration. Making sure the second agent cannot write where it should only read, cannot run a shell, and does not quietly stop halfway while reporting success took a supervisor, a run of hosted tests on a real Mac, and two failures I describe below.

- [What goes wrong when one coding agent drives another](#what-goes-wrong-when-one-coding-agent-drives-another)
- [A delegated review, seen from Codex](#a-delegated-review-seen-from-codex)
- [Edits come back as a patch](#edits-come-back-as-a-patch)
- [How the pieces fit](#how-the-pieces-fit)
- [Guardrails, and what they do not cover](#guardrails-and-what-they-do-not-cover)
- [Two things that broke on real runs](#two-things-that-broke-on-real-runs)
- [Overhead, measured](#overhead-measured)
- [Trade-offs I chose](#trade-offs-i-chose)
- [When not to use it](#when-not-to-use-it)
- [Try it](#try-it)
- [Status, and what I need from you](#status-and-what-i-need-from-you)

## What goes wrong when one coding agent drives another

These are the failures I wanted ruled out before I pointed this at a repository I care about:

- The second agent writes into your working tree while it is supposed to be reviewing it.
- It gets a shell or network access because its default configuration allows them.
- Credentials end up in a log, in a transcript or in the process list.
- Codex restarts, and the run, its session and its half-finished patch are gone.
- The coordinating model does not know whether to wait, poll or give up, and burns tokens polling.
- A run says "completed" when the worker stopped at a limit halfway through.

Each one has a guardrail below. The last one bit me anyway, twice, on real runs.

## A delegated review, seen from Codex

From Codex you ask in plain words, with an absolute path and a concrete scope:

> Use Vibe to review `/absolute/path/to/repo` for correctness bugs in the authentication module. Read only. Report findings with file and line, and tell me if the review stopped early.

Codex usually makes three tool calls. It starts the review with `vibe_review_start` and a `wait_seconds` of 120 to 300, so the call blocks until the run needs attention. If the run is still going when the wait ends, it calls `vibe_status` with the same wait. When the run settles, that reply already carries a compact result, and Codex closes the run with `vibe_close`.

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

`stop_reason` says whether Vibe finished its answer or stopped at a limit; anything other than `end_turn` means a partial result, and `warnings` says so in words. `integrity` says whether the workspace changed while the review was reading it, and whether the worker ever issued a write-capable tool call. `next_action` is one sentence telling the coordinator what to call next, so Codex does not need a skill installed to drive the loop.

In the hosted runs on 2026-10-05 and 2026-10-07, both reviews of a synthetic repository found the planted arithmetic bug in a nested file and left the source unchanged. That is two runs on a fixture I wrote, not a benchmark, and I make no claim here about what Vibe finds that Codex misses.

## Edits come back as a patch

An edit request looks the same, with a Git base:

> Use Vibe to fix the input validation bug in `/absolute/path/to/repo/src/validate.ts` in an isolated worktree from `HEAD`. Show me the patch and run the tests yourself before I apply anything.

The supervisor creates a detached Git worktree from that base, gives Vibe `read_file`, `grep`, `write_file` and `edit` inside it and nothing else, and exports the result as a patch. A patch of at most 4000 bytes comes back inline; a larger one is saved next to the run and the reply carries its path and size. Nothing is applied to your checkout, committed, merged or pushed.

Vibe has no shell, so it cannot run your tests. Codex does that, against the worktree path the start reply names, and asks for corrections if they fail. One thing caught me out early: the worktree starts from the base you name, so uncommitted changes in your checkout are not in it.

When you are done, `vibe_close` with `cleanup_worktree: true` removes the worktree, but only when a fresh export of it still matches the saved patch, the path is one the supervisor created, and no ignored files are left behind. Otherwise it keeps the worktree, returns `worktree_removed: false` and says why in `worktree_retained_reason`.

On 2026-10-07 the hosted edit produced an eleven-file patch in 12.1 seconds; the patch applied to a clean clone, its four test cases passed, the source checkout was unchanged and the worktree was removed.

## How the pieces fit

```text
Codex (CLI or desktop)
   │  MCP over stdio
   ▼
vibe-supervisor ── allowlist, run records, event log, Git worktrees
   │  private HOME and VIBE_HOME, filtered environment
   ▼
launcher shim ── version and signature checks, history filtering
   │
   ▼
Mistral Vibe 2.25.8 ──► Mistral API
```

Codex starts `vibe-supervisor` as an MCP server over stdio. The supervisor checks that the workspace is under an allowlisted root, records every run on disk, builds a private `HOME` and `VIBE_HOME` for the run with only its own agent profiles in it, and launches Vibe through a small Python launcher shim. The shim refuses any Vibe other than 2.25.8, checks the signatures of the internals it depends on, and filters what Vibe writes to its own session history. For a programmatic run the task text travels through a file only the shim can read and deletes before Vibe starts, so it never appears in `ps`.

There are two ways to talk to Vibe. The default runs it once per task in programmatic mode, which is enough for most reviews and edits. The opt-in ACP mode (Agent Client Protocol) keeps a session open, so Codex can send corrections to the same worker with `vibe_continue`.

## Guardrails, and what they do not cover

- Workspaces must be under an explicit allowlist, which starts empty.
- Reviews get `read_file` and `grep`. Edits add `write_file` and `edit`, inside the worktree only.
- Shell and network tools are off, and there is no setting to turn them on; `allow_shell: true` is rejected as an unknown field.
- Each run has a filtered environment; your Vibe config, project trust, hooks, skills and MCP servers are not inherited.
- Known secret formats are redacted from what the supervisor stores, and the model's reasoning is not stored at all.
- Time, turns and output are bounded per run.
- Permission requests from Vibe are matched to the tool call they belong to; anything unknown is refused with the reject option Vibe offered.

What this is not: an operating-system sandbox. It is an application-level policy. Vibe still runs as your user, and the file content it is allowed to read is sent to Mistral. Redaction catches known secret formats, not every possible one. Treat a delegated run like running someone else's code with your permissions, on a repository you are willing to share with the provider.

## Two things that broke on real runs

Both failures are the same failure in two shapes: Vibe reaching its turn budget, and the supervisor not telling the truth about it.

**The soak that stopped on run 1.** On 2026-10-07 I started the first 100-run soak on a real Mac: 60 programmatic reviews, 30 programmatic edits and 10 ACP runs, driven through the official MCP client with stop-on-fail. It stopped after one run. The first review asked Vibe to look for missing error handling across the repository. Vibe spent its 12-turn budget in 27.4 seconds, printed `<vibe_stop_event>Turn limit of 12 reached</vibe_stop_event>` to stderr and exited with code 1. The supervisor saw a non-zero exit and reported `VSUP_BACKEND_CRASHED`. Nothing had crashed. Vibe had stopped at its limit, and I had shipped a release candidate that called a limit a crash.

The fix is deliberately narrow. The supervisor now reports a turn-limit stop as `completed` with `stop_reason: max_turn_requests` and a warning that the result may be partial, and only when four things agree: the exit code is 1 with no signal, Vibe's final message ends with the stop marker, the same marker stands alone on stderr, and the turn count in the marker matches the one the supervisor configured. A marker quoted in ordinary output, a different exit code or an extra authentication error keeps the old classification. The retry on the patched build hit the same limit in 15.2 seconds and was reported truthfully, so the soak still failed, this time for the right reason: the task was too broad for the budget. I raised the default review budget from 12 to 20 turns and rewrote the soak tasks to name a starting file and the tools that exist. Both failed attempts stay in the repository's history as failures.

**The continuation that could never work.** The second came from a real deployment task on an earlier candidate, in ACP mode. A run used up its turns without producing a patch, and continuing the same session with a correction "remained exhausted". Reading Vibe 2.25.8's published source explained why: Vibe counts turns per session, not per prompt, and keeps the count across `session/load`. Once the budget is spent, every further prompt in that session ends with `max_turn_requests` without doing any work. The only way to continue is to raise the limit on the session itself.

So the supervisor now refuses a plain `vibe_continue` on such a run with `VSUP_TURN_LIMIT_REACHED`, before anything reaches Vibe, and asks for a `max_turns` larger than the run's current limit. The value is the session's cumulative ceiling, not an increment; the supervisor saves it on the run and sends it to Vibe with `session/set_config_option` before the next prompt, on a live session and after a reload. At 50, Vibe's maximum, the session cannot be extended and you start a new run. This gate is new in rc.8 and so far tested against fake backends that model Vibe's counting; confirming it on a real Vibe run is one of the checks still open before 1.0.

## Overhead, measured

The supervisor should not be the slow part. Hosted numbers first, from the rc.7 session on 2026-10-07: macOS arm64, Vibe 2.25.8 with `mistral-medium-3.5`, the official MCP client, a synthetic repository. These are settled-reply times after the start call's wait returned, not first-token latencies, and most of each is the model's time:

| What | Time |
|---|---|
| Review of a nested file, cold / warm | 8.9 s / 3.8 s |
| Edit producing an eleven-file patch | 12.1 s |
| `vibe-supervisor doctor` | 1.4 s |
| Supervisor startup after a restart, with saved runs | 98 ms |

Earlier hosted edits cost about $0.02 each as Vibe reported them (rc.2, 2026-10-05); that is Vibe's own figure, not billing data.

The supervisor's own costs, measured on my development machine with fake backends, before and after the latency work:

| Path | Before | After |
|---|---|---|
| Review snapshot of a 156,169-file tree (mostly `node_modules`), per pass, two passes per review | 30.2 s | 2.6 s |
| Patch export with one modified and 50 untracked files | 1.6 to 2.1 s | 0.13 s |
| Saving 1,000 events | 4.8 s | 18 ms |
| Server start with 200 retained runs of 1 MiB logs each | reads every log | under 300 ms |

The 100-run soak has not passed yet: both attempts on 2026-10-07 stopped on run 1, as described above. It reruns on rc.8 with the scoped tasks and the 20-turn default before 1.0, and I will publish its numbers whether they are good or not.

## Trade-offs I chose

- **No shell for the worker.** Vibe cannot run tests, so Codex does. That is slower, and a reviewer that can run arbitrary commands is a different risk.
- **An exact Vibe version.** The shim depends on Vibe internals, so any other version is refused with a message naming the pin. Vibe 2.26.0 came out on 2026-10-06 and is not supported yet; I compared the two wheels and found no broken assumption, but supporting it means rerunning the hosted tests on that version.
- **Patches are never applied for you.** You read them and apply them.
- **Ignored files are compared by metadata.** Files Git can see are hashed, so a review that changes one is caught. A write to an ignored path such as `node_modules/` that keeps size, time and inode would be missed.
- **One supervisor per data directory.** Several MCP clients at once need `--isolated`, which gives each its own directory.
- **Legacy harness only.** The supervisor forces Vibe's legacy harness; the unified one is not validated.
- **macOS only**, for now.

## When not to use it

If you do not have Vibe access, use Linux or Windows, or want the helper to run your tests, this is not for you. Codex desktop was verified with an earlier candidate and the current build through the official MCP client; other MCP clients may work, but I have not tested them.

The honest baseline is running Vibe in a second terminal and pasting results back. General delegation servers such as codex-subagents-mcp, mcp-delegate and the various agent bridges let one agent call another with fewer guardrails and more flexibility.

## Try it

You need macOS, Node.js 20.19 or newer, Git, and Mistral Vibe with access through a Mistral plan:

```sh
uv tool install mistral-vibe==2.25.8
vibe
```

Finish the browser login once; no API key is needed. There is no tagged release yet, so install from a clone (a Git URL install is not supported):

```sh
git clone https://github.com/crew-lab/codex-vibe.git
cd codex-vibe
npm ci
npm link
vibe-supervisor setup --workspace /absolute/path/to/your/repo
```

`npm ci` builds the server through the `prepare` script.

`setup` adds the workspace to the allowlist, records where `vibe` lives, runs a health check, and shows the Codex configuration change before writing it. Restart Codex so it starts the server, check that the Vibe tools are listed, and try the review prompt above. To add another repository later, run `vibe-supervisor allow <dir>` and restart the server; a running server keeps the allowlist it started with.

## Status, and what I need from you

Release candidate 0.9.0-rc.8 was verified on macOS arm64 in parts: hosted programmatic reviews and edits, ACP continuation, restart recovery and idle expiry through the official MCP client on rc.7, and Codex desktop registration on an earlier candidate. Still open before 1.0: the 100-run soak, the turn-budget gate on a real run, a full check inside the Codex desktop app, and an install on a clean account. The repository's compatibility notes keep the one list of what is and is not verified, and I would rather you read that list than take my word for it.

If you use Codex on a Mac and have Vibe access, try one review and one edit and open an issue with what happened, especially anything that ended in a state you did not expect. This is an independent project, not affiliated with OpenAI or Mistral AI.

{% embed https://github.com/crew-lab/codex-vibe %}

Which task would you hand to a second model first, and which guardrail would you insist on before letting it near your repository?

*This article was written with AI assistance and checked against the project's recorded test evidence.*
