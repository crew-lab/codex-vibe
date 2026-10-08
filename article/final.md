---
title: "7 checks before one coding agent delegates to another"
published: false
description: "My 100-run agent soak test died on run 1 because my MCP server called a turn limit a crash. Seven checks I now make before Codex hands code to Mistral Vibe."
tags: showdev, mcp, ai, security
---

{% card %}
**TL;DR** I built vibe-supervisor, a local Model Context Protocol (MCP) server that lets Codex hand code reviews and edits to Mistral Vibe. This post is about the seven boundaries I had to make true before trusting one agent to drive another; they transfer to any MCP server or agent setup. MIT licensed, macOS only, release candidate 0.9.0-rc.8. "Real run" below means Vibe 2.25.8 on my Mac through the official MCP test client, as opposed to the fake backends my tests use.
{% endcard %}

On 2026-10-07 I started my first 100-run soak test of a tool that lets one coding agent delegate to another. It died on run 1. Nothing had crashed: Mistral Vibe had used its 12-turn budget (a turn is one model request with its tool calls) in 27.4 seconds, printed `<vibe_stop_event>Turn limit of 12 reached</vibe_stop_event>`, and exited with code 1. My supervisor saw the non-zero exit and reported `VSUP_BACKEND_CRASHED`. I had shipped a release candidate that called a limit a crash, and a partial review had come within one field of looking like a finished one.

Wiring one agent into another is a few lines of configuration in any current tool. Knowing what the second agent did, and did not do, is the hard part, whether your coordinator is Codex, Claude Code, Cursor or a script you wrote. The seven checks below are what I needed to be true. Each one shows how I tested it and where the test is still thin.

## 1. Read-only has to be checked, not promised

A review profile that exposes only `read_file` and `grep` is a promise, and a tool that turns out to write breaks it silently. So the supervisor snapshots the workspace when a review starts and compares it when the run ends: files Git can see are hashed with SHA-256, everything else is compared by size, modification time and inode. The result carries `integrity.status` (`verified`, `changed` with the paths, or `unverified` with a reason) and `write_tool_observed`, true if the run's own events show a write-capable tool call.

The blind spot: a write to an ignored path such as `node_modules/` that keeps size, time and inode would be missed. In the real runs on 2026-10-07, reads outside the workspace and of `.env` were refused (on the ACP backend), `write_file` was an unknown tool in a review, and both reviews found the planted arithmetic bug in a nested file of a synthetic repository without changing it. That is two runs on my own fixture, so treat it as a smoke test.

## 2. Edits come back as a patch from a throwaway worktree

For an edit, the supervisor creates a detached Git worktree from the base you name, gives Vibe `read_file`, `grep`, `write_file` and `edit` inside it and nothing else, and exports the result as a patch. Small patches come back inline, larger ones are saved next to the run. Nothing is applied, committed, merged or pushed; you read the patch and decide.

Uncommitted changes in your checkout are not in the worktree, which caught me out once. Cleanup is a check in its own right: the worktree is removed only when a fresh export still matches the saved patch and no ignored files are left behind. On 2026-10-07 a real edit's eleven-file patch applied to a clean clone, its four test cases passed, and the worktree was removed.

Takeaway: the worker's output should be an artifact you review, never a change you have to undo.

## 3. No shell for the worker

Shell and network tools are off, and there is no setting to turn them on; `allow_shell: true` is rejected as an unknown field. Vibe cannot run your tests, so Codex does, against the worktree path the start reply names, and sends corrections if they fail. Slower than a worker with a shell, but a reviewer that can run arbitrary commands is a different risk.

The lesson that transferred to my other setups: a worker without a shell must separate checks it proposed from checks it executed, and the coordinator must not accept "I ran the tests" from a process that could not have.

## 4. Stop reasons have to be honest

Vibe runs in two modes. One-shot: the supervisor sends a task, Vibe answers once and exits. ACP (Agent Client Protocol): a session stays open so Codex can send corrections. Each mode gave me a version of the same bug, Vibe reaching its turn budget and the supervisor not saying so.

**The soak that stopped on run 1.** The plan was 60 one-shot reviews, 30 one-shot edits and 10 ACP runs with stop-on-fail; the opening shows how far it got. The fix is narrow on purpose. A stop is classified as `completed` with `stop_reason: max_turn_requests` and a partial-result warning only when all four agree: exit code 1 with no signal; Vibe's final message ends with the stop marker; the same marker stands alone on stderr; the turn count in the marker matches what the supervisor configured. Anything else keeps the crash classification. The retry hit the same limit in 15.2 seconds and was reported truthfully, so the soak still failed, this time for the right reason: the task was too broad for the budget. I raised the default review budget from 12 to 20 turns and scoped the soak tasks to a starting file.

**The continuation that could never work.** The second came from a real deployment task on an earlier candidate in ACP mode. A run used up its turns without producing a patch, and every correction sent to that session came back exhausted. Vibe 2.25.8's source explained why: it counts turns per session, not per prompt, and keeps the count across `session/load`, so once the budget is spent every further prompt ends with `max_turn_requests` and does nothing.

The supervisor now refuses a plain `vibe_continue` on such a run with `VSUP_TURN_LIMIT_REACHED`, before anything reaches Vibe, and asks for a `max_turns` above the run's current limit (the new value is the session's total ceiling, so raising a spent 12 to 20 buys roughly eight more turns); at 50, the supervisor's maximum, you start a new run. This gate is new in rc.8 and tested only against fake backends that model Vibe's counting; confirming it on a real run is still open before 1.0.

Find out how your worker signals "I stopped at a limit", then test that your coordinator treats that signal as neither success nor failure. Mine did not, twice.

## 5. A run has to survive a restart

Codex quits, the laptop sleeps, the server restarts. Every run is recorded on disk, and after a restart the supervisor only reads those records; a run that was still going becomes `recoverable`, and a continuation reloads its session on demand. The original task is never resubmitted, because replaying an uncertain task is worse than asking. In the real runs on 2026-10-07, restarts after a completed run and during a running one both recovered, with the supervisor up in 98 ms. Those restarts were graceful, as when Codex quits; a `kill -9` mid-run is still untested on real Vibe.

Takeaway: if a restart loses the run, the coordinator will start it again, and you pay for the work twice.

## 6. Every reply tells the model what to do next

The coordinator is a language model without your docs open, and it should not need a skill installed to drive the loop. So every reply carries `next_action`, one sentence naming the next call, and a result is small on purpose. This is the saved result of the 15.2-second retry from check 4, trimmed of run IDs, paths and artifact hashes (rc.7 with the fix; rc.8 rewords the summary to point at a larger `max_turns` or a new run). These are the fields Codex checks before it believes anything:

```json
{
  "state": "completed",
  "backend": "programmatic",
  "stop_reason": "max_turn_requests",
  "summary": "Vibe stopped at the turn limit before giving a final answer. Inspect the artifacts and stop_reason before trusting the result; ...",
  "changed_files": [],
  "warnings": [
    "Vibe stopped with stop reason max_turn_requests instead of end_turn; the result may be incomplete."
  ],
  "integrity": { "status": "verified", "write_tool_observed": false }
}
```

Every error code carries a remedy for the same reason: a model that reads a bare code guesses, one that reads the fix applies it.

The request side matters as much. The prompt that starts a review gives an absolute path, a scope and what to report:

> Use Vibe to review `/absolute/path/to/repo` for correctness bugs in the authentication module. Read only. Report findings with file and line, and tell me if the review stopped early.

Takeaway: write tool replies for a reader that has no docs open, because that is exactly who reads them.

## 7. Wait inside the tool call instead of polling

A coordinator that polls burns tokens and context on "still running". The start tools and `vibe_status` take `wait_seconds` from 0 to 300 and return as soon as the coordinator is needed: a new event, a state change, a pending permission request, or a settled run. A finished run returns its result inside the start reply, so the usual loop is three calls: start with a wait of 120 to 300, `vibe_status` if needed, then `vibe_close`. The client's tool timeout must exceed the longest wait; `setup` writes `tool_timeout_sec = 600` into `~/.codex/config.toml` for that reason.

Takeaway: a wait that returns on the first useful event costs one call where polling costs many.

## Steal this checklist

{% card %}
Before one agent hands work to another, in whatever stack you use:

1. **Read-only is verified** by a snapshot before and a comparison after, with the blind spots named.
2. **Edits land in a throwaway worktree** and come back as a patch; nothing is applied, committed or pushed for you.
3. **No shell for the worker**, and the coordinator knows it has to run the tests itself.
4. **A stop at a limit is neither success nor failure.** Find your worker's limit signal and test that your code sees it.
5. **Runs are on disk** and recoverable after a restart, without replaying the task or restoring a pending grant.
6. **Every reply names the next call**, and every error names its remedy.
7. **Waiting happens inside the tool call**, bounded, with the client's tool timeout longer than the wait.
{% endcard %}

## How the pieces fit

```text
Codex (desktop app)
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

Each run gets a private `HOME`, so your Vibe config, hooks, skills and MCP servers are not inherited. A one-shot task travels through a file the shim deletes before Vibe starts, so it never shows in `ps`. Known secret formats are redacted, and the model's reasoning is neither persisted nor left in Vibe's own session history.

## What it costs

Real-run numbers from the rc.7 session on 2026-10-07 (macOS arm64, Vibe 2.25.8 with `mistral-medium-3.5`, the official MCP client, a synthetic repository). These are settled-reply times after the start call's wait returned, not first-token latencies, and most of each is the model's time.

| What | Time |
|---|---|
| Review of a nested file, cold / warm | 8.9 s / 3.8 s |
| Edit producing an eleven-file patch | 12.1 s |

Earlier real edits cost about $0.02 each as Vibe reported them (rc.2, 2026-10-05), which is Vibe's figure, not billing data. The 100-run soak reruns on rc.8 before 1.0, and I will publish its numbers whether they are good or not.

## What this is not

It is not an operating-system sandbox. It is an application-level policy: it validates workspaces, filters the worker's environment and tools, and bounds its time, turns and output, but Vibe still runs as your user, and the file content it is allowed to read is sent to Mistral. Redaction catches known secret formats; an unusual one can slip through. Treat a delegated run like running someone else's code with your permissions, on a repository you are willing to share with the provider.

## Try it

It is macOS only, and you need Node.js 20.19 or newer, Git, and Mistral Vibe with access through a Mistral plan. It refuses any Vibe except 2.25.8 (2.26.0 stays refused until I rerun the real tests on it). If that rules you out, the honest baseline is Vibe in a second terminal; codex-subagents-mcp, mcp-delegate and the agent bridges offer delegation with fewer guardrails.

These are the README steps; I have run them on my own machine but not yet on a fresh macOS account:

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

`setup` adds the workspace to the allowlist, runs a health check, and shows the Codex configuration change before writing it. Restart Codex and try the review prompt from check 6.

Verified on real Vibe: reviews, edits, continuation, restart recovery and idle timeout through the official MCP client, and Codex desktop registration on an earlier build. Not yet: the 100-run soak, the turn-budget gate on a real run, a full pass inside the Codex desktop app, and a clean-account install. The repository's compatibility notes keep that list. This is an independent project, not affiliated with OpenAI or Mistral AI.

{% embed https://github.com/crew-lab/codex-vibe %}

## Your turn

If you use Codex on a Mac and have Vibe access, try one review and one edit and open an issue with what happened, especially anything that ended in a state you did not expect. If you cannot run it, tell me in the comments which of the seven checks your own setup already does, and which one it fakes.

And a question for everyone: when your sub-agent in Claude Code, Cursor or Copilot stops at a limit, what does your coordinator actually see?

Part 2 is the engineering: how a run reaches exactly one end state whatever dies, how a restarted server proves it owns a run, and how the review snapshot went from 30.2 s to 2.6 s.

*This article was written with AI assistance and checked against the project's recorded test evidence.*
