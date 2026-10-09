---
title: "7 checks before one coding agent delegates to another"
published: false
description: "My 100-run agent soak test died on run 1 because my MCP server called a turn limit a crash. Seven checks I now make before Codex hands code to Mistral Vibe, and what I cut to keep it stable."
tags: showdev, mcp, ai, security
---

{% card %}
**TL;DR** I built vibe-supervisor, a local Model Context Protocol (MCP) server that lets Codex hand code reviews and edits to Mistral Vibe. This post is about the seven boundaries I had to make true before trusting one agent to drive another; they transfer to any MCP server or agent setup. MIT licensed, macOS only, release candidate 0.9.0-rc.17. "Real run" below means Vibe 2.25.8 on my Mac through the official MCP test client, as opposed to the fake backends my tests use. All real runs so far fit inside the monthly credit of a free Mistral account.
{% endcard %}

On 2026-10-07 I started my first 100-run soak test of a tool that lets one coding agent delegate to another. It died on run 1. Nothing had crashed: Mistral Vibe had used its 12-turn budget (a turn is one model request with its tool calls) in 27.4 seconds, printed `<vibe_stop_event>Turn limit of 12 reached</vibe_stop_event>`, and exited with code 1. My supervisor saw the non-zero exit and reported `VSUP_BACKEND_CRASHED`. I had shipped a release candidate that called a limit a crash, and a partial review had come within one field of looking like a finished one.

Wiring one agent into another is a few lines of configuration in any current tool. Knowing what the second agent did, and did not do, is the hard part, whether your coordinator is Codex, Claude Code, Cursor or a script you wrote. The seven checks below are what I needed to be true. Each one shows how I tested it and where the test is still thin.

## 1. Read-only has to be checked, not promised

A review profile that exposes only `read_file` and `grep` is a promise, and a tool that turns out to write breaks it silently. So the supervisor snapshots the workspace when a review starts and compares it when the run ends: files Git can see are hashed with SHA-256, everything else is compared by size, modification time and inode. The result carries `integrity.status` (`verified`, `changed` with the paths, or `unverified` with a reason) and `write_tool_observed`, true if the run's own events show a write-capable tool call.

The blind spot: a write to an ignored path such as `node_modules/` that keeps size, time and inode would be missed. In the real runs on 2026-10-07, reads outside the workspace and of `.env` were refused (on the ACP backend), `write_file` was an unknown tool in a review, and both reviews found the planted arithmetic bug in a nested file of a synthetic repository without changing it. That is two runs on my own fixture, so treat it as a smoke test.

## 2. Edits come back as a patch from a throwaway worktree

For an edit, the supervisor creates a detached Git worktree from the base you name, gives Vibe `read_file`, `grep`, `write_file` and `edit` inside it and nothing else, and exports the result as a patch. Small patches come back inline, larger ones are saved next to the run. Nothing is applied, committed, merged or pushed; you read the patch and decide.

Uncommitted changes in your checkout are not in the worktree, which caught me out once. Cleanup is a check in its own right: the worktree is removed only when a fresh export still matches the saved patch and no ignored files are left behind. On 2026-10-07 a real edit's eleven-file patch applied to a clean clone, its four test cases passed, and the worktree was removed.

The guard on the way out bit me too. Before a patch is exported it is checked for credentials, and my first check matched ordinary code such as `password: string`. The export failed, and because cleanup needs an export, the worktree stayed behind. A cold review before 1.0 caught it: the check now looks only at added lines and at credential shapes (bearer tokens, key prefixes, private-key headers, literal values assigned to secret-looking names), and lets placeholders and type annotations through. The same review found that an edit started from a subdirectory of a repository handed the worker the whole repository; that is now refused before any worktree exists.

The order of the last steps matters as much. On 2026-10-09 a prepared ACP edit went through the full loop on rc.13: Vibe fixed a function, Codex applied the patch in a separate verifier clone, tests and an independent read-only reviewer accepted it, Codex sent one correction in the same session, and only then closed the run and removed the worktree. In the next, real task the coordinator closed the run before its checks, the checks then rejected the candidate, and there was no session left to correct it in; the fix had to be written by hand. I count that run as a partial pass, not a pass.

Takeaway: the worker's output should be an artifact you review, never a change you have to undo, and the session stays open until you have accepted it.

## 3. No shell for the worker

Shell and network tools are off, and there is no setting to turn them on; `allow_shell: true` is rejected as an unknown field. Vibe cannot run your tests, so Codex does, against the worktree path the start reply names, and sends corrections if they fail. Slower than a worker with a shell, but a reviewer that can run arbitrary commands is a different risk.

The lesson that transferred to my other setups: a worker without a shell must separate checks it proposed from checks it executed, and the coordinator must not accept "I ran the tests" from a process that could not have.

Self-reports about process fail the same way. In a pilot on 2026-10-08 I told a review to read at most three files. It found the bug, answered in 21.5 seconds, and said it had stayed within the limit; its own session history showed five reads. Instruction compliance is now something the soak counts from the records and reports next to the result, never something the worker's answer can certify.

## 4. Stop reasons have to be honest

Vibe runs in two modes. One-shot: the supervisor sends a task, Vibe answers once and exits. ACP (Agent Client Protocol): a session stays open so Codex can send corrections. Each mode gave me a version of the same bug, Vibe reaching its turn budget and the supervisor not saying so.

**The soak that stopped on run 1.** The plan was 60 one-shot reviews, 30 one-shot edits and 10 ACP runs with stop-on-fail; the opening shows how far it got. The fix is narrow on purpose. A stop is classified as `completed` with `stop_reason: max_turn_requests` and a partial-result warning only when all four agree: exit code 1 with no signal; Vibe's final message ends with the stop marker; the same marker stands alone on stderr; the turn count in the marker matches what the supervisor configured. Anything else keeps the crash classification. The retry hit the same limit in 15.2 seconds and was reported truthfully, so the soak still failed, this time for the right reason: the task was too broad for the budget. I raised the default review budget from 12 to 20 turns and scoped the soak tasks to a starting file.

**The continuation that could never work.** The second came from a real deployment task on an earlier candidate in ACP mode. A run used up its turns without producing a patch, and every correction sent to that session came back exhausted. Vibe 2.25.8's source explained why: it counts turns per session, not per prompt, and keeps the count across `session/load`, so once the budget is spent every further prompt ends with `max_turn_requests` and does nothing.

The supervisor now refuses a plain `vibe_continue` on such a run with `VSUP_TURN_LIMIT_REACHED`, before anything reaches Vibe, and asks for a `max_turns` above the run's current limit (the new value is the session's total ceiling, so raising a spent 12 to 20 buys roughly eight more turns); at 50, the supervisor's maximum, you start a new run.

On real Vibe on 2026-10-08 the three refusals held, and nothing reached Vibe: the event log stayed at exactly 12,545 bytes. The first raised continuation still failed. I had capped a session at 3 turns inside a nine-file chain of reads, then raised it to 10 and asked for something different. The new message and the new ceiling both arrived; Vibe simply went back to the old chain and ran out again. Three controlled runs then passed, one of them after a restart: a correction that said explicitly that the old task was cancelled, and a four-file chain continued with the same objective, all ending in `end_turn` with the expected file written. The lesson is about prompts as much as code. A session keeps its earlier objective in context, so a correction that changes direction has to say the old one is over.

Silence needs a stop reason too. In one soak attempt an edit produced no event for 15 minutes: the worker held an open HTTPS connection and wrote nothing, and nothing local explained it. The supervisor now has a progress watchdog: a worker that shows no activity for 600 seconds ends with `VSUP_NO_PROGRESS` and a note of what it last saw, before Vibe's own 720-second read timeout would fire. That bounds the stall; it does not explain it.

Find out how your worker signals "I stopped at a limit", then test that your coordinator treats that signal as neither success nor failure. Mine did not, twice. On rc.8 the one-shot case now passes on real Vibe: a review capped at 2 turns came back `completed` with `max_turn_requests`, the partial warning and a matching saved result.

## 5. A run has to survive a restart

Codex quits, the laptop sleeps, the server restarts. Every run is recorded on disk, and after a restart the supervisor only reads those records; a run that was still going becomes `recoverable`, and a continuation reloads its session on demand. The original task is never resubmitted, because replaying an uncertain task is worse than asking. In the real runs on 2026-10-07, restarts after a completed run and during a running one both recovered, with the supervisor up in 98 ms. Those restarts were graceful, as when Codex quits; a `kill -9` mid-run is still untested on real Vibe. On 2026-10-08, disconnecting the official MCP client while a review was running left it `recoverable` after a restart, disconnecting with an idle session removed its worker, and servers whose runs were closed exited 3 to 5 ms after the client did.

Shutdown itself needed a bound. If Codex disconnected while a run was stuck in a Git export, the server could wait forever, keep its lock, and refuse the next Codex start. Since rc.17 shutdown has a 10-second deadline: after it, the supervisor ends only the worker processes it started itself (never a process ID read from disk), releases the lock and exits, and the interrupted run is recovered on the next start. Run directories whose record cannot be read are now cleaned up by retention, but only when the record is missing or not JSON; one written by a newer release, or one that still owns a worktree, is kept and reported. These three changes are tested against fake backends only so far.

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
2. **Edits land in a throwaway worktree** and come back as a patch; nothing is applied, committed or pushed for you, and the session stays open until you accept the patch.
3. **No shell for the worker**, and the coordinator knows it has to run the tests itself.
4. **A stop at a limit is neither success nor failure.** Find your worker's limit signal and test that your code sees it.
5. **Runs are on disk** and recoverable after a restart, without replaying the task or restoring a pending grant.
6. **Every reply names the next call**, and every error names its remedy.
7. **Waiting happens inside the tool call**, bounded, with the client's tool timeout longer than the wait.
{% endcard %}

## Smaller is part of stable

Between rc.10 and rc.14 the project kept growing: a third backend mode that probed for the best one, aliases, coordinator tools in the CLI, config options nobody had set. On 2026-10-09 I had a review list what no real run depended on, and cut it in three release candidates: the automatic backend choice and its probe cache, six CLI commands and aliases (`setup`, `allow`, `doctor`, `serve` and `runs` remain, and `setup --dry-run` shows what it would write), four unused config options, and a compatibility shim for settings removed months earlier, which now fail validation by name instead of being silently ignored. About 770 lines of code and tests went, net. Every boundary from the checklist stayed. The next cut waits on data: if the ACP backend passes the soak, the one-shot backend goes too.

Takeaway: every option is a path you have to test on real runs; the ones nobody uses are only risk.

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

On rc.8 (2026-10-08, same setup) two more edits took 23.2 s for an exact single-file write and 10.8 s for adding a file. Vibe reported about $0.02 per edit on rc.2 and $0.035 for one 20-turn review on rc.8; those are Vibe's own figures, not billing data.

Money is the pleasant surprise. Le Chat is now part of Vibe, and Mistral's free plan includes limited coding sessions in the terminal. My account is a free one: it shows a monthly credit of 8.50 (in euros on my account), and after every real run up to rc.8, soak attempts included, 1.20 of it was used. The full 100-run soak is estimated at 2 to 4 dollars at the rates seen so far, so it should fit in one month's free credit. Mistral's pricing page does not state the credit amount, so check your own account before relying on it.

The 100-run soak has still not passed, and the latest attempts added more lessons. In the first, 19 runs passed and the 20th, an edit, produced no event at all for 15 minutes: the worker held an open HTTPS connection and wrote nothing. The driver closed it, exported an empty patch and removed the worktree; the cause is still unknown and it has not recurred. In the second, the first review spent its 20 turns on 16 `grep` calls and 4 file reads and never wrote an answer. The supervisor reported that truthfully, and the soak correctly refused to count it. A review task without an explicit "stop searching and answer" is not a fair test of anything, so the soak now uses bounded tasks, counts truthful truncation separately, and reports instruction compliance without gating on it (see check 3). The next attempt runs on rc.17. I will publish its numbers whether they are good or not.

## What this is not

It is not an operating-system sandbox. It is an application-level policy: it validates workspaces, filters the worker's environment and tools, and bounds its time, turns and output, but Vibe still runs as your user, and the file content it is allowed to read is sent to Mistral. Redaction catches known secret formats; an unusual one can slip through. Treat a delegated run like running someone else's code with your permissions, on a repository you are willing to share with the provider.

## Try it

It is macOS only, and you need Node.js 20.19 or newer, Git, and Mistral Vibe; a free Mistral account is enough to try it. It refuses any Vibe except 2.25.8 (2.26.0 stays refused until I rerun the real tests on it). If that rules you out, the honest baseline is Vibe in a second terminal; codex-subagents-mcp, mcp-delegate and the agent bridges offer delegation with fewer guardrails.

These are the README steps; I have run them on my own machine but not yet on a fresh macOS account. One honest note: until a fix on 2026-10-08, the `vibe-supervisor` command installed through `npm link` printed nothing at all, because the check for "am I the main module" compared a resolved path with the unresolved link. My smoke test started the server through Node directly and missed it; it now runs the installed command. Use the current main branch:

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

`setup` adds the workspace to the allowlist, runs a health check, and shows the Codex configuration change before writing it (`--dry-run` only shows it). Restart Codex and try the review prompt from check 6.

Verified on real Vibe through the official MCP client: reviews, edits, the one-shot turn limit, raised continuation live and after a restart, restart recovery, idle timeout, disconnect cleanup, a continued session ending by the supervisor's own deadline (`VSUP_TIMEOUT` after 61.3 s) instead of being killed by the launcher, and an ACP edit with a same-session correction, verified export and cleanup; Codex desktop registration on an earlier build. Not yet: anything on rc.17 itself (the changes since rc.13 are tested against fakes), the 100-run soak, a full pass inside the Codex desktop app, permission callbacks, and a clean-account install. The repository's compatibility notes keep that list. This is an independent project, not affiliated with OpenAI or Mistral AI.

{% embed https://github.com/crew-lab/codex-vibe %}

## Your turn

If you use Codex on a Mac, a free Mistral account is enough: try one review and one edit and open an issue with what happened, especially anything that ended in a state you did not expect. If you cannot run it, tell me in the comments which of the seven checks your own setup already does, and which one it fakes.

And a question for everyone: when your sub-agent in Claude Code, Cursor or Copilot stops at a limit, what does your coordinator actually see?

Part 2 is the engineering: how a run reaches exactly one end state whatever dies, how a restarted server proves it owns a run, and how the review snapshot went from 30.2 s to 2.6 s.

*This article was written with AI assistance and checked against the project's recorded test evidence.*
