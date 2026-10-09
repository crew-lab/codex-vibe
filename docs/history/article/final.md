---
title: "My first agent delegation soak test failed on run 1"
published: false
description: "I built a Codex-to-Mistral Vibe supervisor. A failed soak, a misleading answer, and a stale connection taught me what to check before trusting agent delegation."
tags: showdev, mcp, ai, security
---

On October 7, I started a 100-run soak test of a tool that lets one coding agent delegate to another. It failed on run 1.

Mistral Vibe had reached its 12-turn budget in 27.4 seconds, printed `<vibe_stop_event>Turn limit of 12 reached</vibe_stop_event>`, and exited with code 1. My supervisor reported `VSUP_BACKEND_CRASHED`. Nothing had crashed. I had turned an incomplete review into the wrong kind of failure.

Fixing that classification did not make the task pass. The retry exhausted the same budget. That distinction became the most useful lesson in this project: managing a worker correctly, finishing its task, and accepting its result are three separate things.

I built [vibe-supervisor](https://github.com/crew-lab/codex-vibe) to let Codex request a second model family's review or an isolated edit from Mistral Vibe, then inspect the result. The interesting work turned out to be the boundaries around that handoff. These seven checks are useful even if you never install this particular tool.

{% card %}
**Current status:** MIT licensed, macOS, release candidate 0.9.0-rc.17. Hosted evidence comes from earlier candidates using Vibe 2.25.8, mostly through the official MCP test client. The full hosted soak has not passed. Current rc.17 native desktop acceptance remains unverified; the latest desktop preflight found an older process still connected.
{% endcard %}

## Where the handoff happens

MCP is Model Context Protocol: Codex calls the supervisor's tools over stdio. ACP is Agent Client Protocol: it lets the supervisor keep a Vibe session available for follow-up corrections. There is also a one-shot backend for tasks that do not need continuation.

```text
Codex: task, acceptance criteria, independent verification
   │ MCP over stdio
   ▼
vibe-supervisor: workspace policy, processes, records, patches
   │ private HOME / VIBE_HOME, filtered environment
   ▼
pinned launcher → Mistral Vibe 2.25.8 → Mistral provider
```

The worker proposes changes. The coordinator decides whether the exact exported candidate meets the task. The supervisor manages execution and preserves evidence. None of those roles can replace the other two.

## 1. Read-only needs enforcement and observation

Reviews expose `read_file` and `grep`, with canonical workspace grants and sensitive-path denials. Edits add `write_file` and `edit` in a detached worktree. In hosted ACP probes, outside reads and `.env` reads were refused, and `write_file` was unavailable during a review.

The supervisor also snapshots the workspace and compares it after the review. Results include `integrity.status` and whether a write-capable tool call was observed. That helps detect lasting changes; it does not prove that no write ever occurred.

There are blind spots. A write followed by restoration can leave no final difference. Another process can change the workspace while the worker is reading. Ignored files are compared by metadata, and the current optimization rehashes previously hashed files only when metadata changes. A change that preserves the compared metadata could therefore evade detection even in a Git-visible file.

Permission enforcement, tool records, and filesystem comparison answer different questions. I want all three, with their limitations visible. Calling a snapshot result `verified` must not turn it into a claim of operating-system isolation.

## 2. Return a patch and keep the session open for verification

An edit starts in a supervisor-created detached Git worktree from a named base. Uncommitted changes in the source checkout are not copied. The result is an exported patch; the supervisor never applies, commits, merges, or pushes it.

Cleanup is checked too. Removal requires a fresh export matching the saved artifact and accounting for residual files. It must not erase work that changed after the export.

The correction loop taught me why closing is an acceptance decision. On rc.13, a controlled ACP edit passed through a separate verifier clone, independent tests, a read-only review, and same-session correction before verified cleanup. In a separate product task, the coordinator closed too early. Later checks rejected the candidate, but the session was gone. The coordinator wrote the fix, so I recorded the Vibe outcome as partial.

The intended loop is:

```text
start with exact baseline and criteria
  → wait → inspect exported candidate
  → verify that candidate in a separate copy
  → send a focused correction if needed → export and verify again
  → accept or reject → close, requesting verified cleanup
```

Keep the session available through acceptance, within its existing lifetime and budget. Record which candidate each check covered; a test result for the previous patch does not validate the correction.

## 3. Worker claims are not execution evidence

I chose to disable worker shell and network tools. There is no switch to enable them; `allow_shell` is rejected as an unknown field. Vibe can propose tests but cannot run them through its available tools. The coordinator must distinguish suggested checks from checks actually executed.

That restriction moves verification; it does not make verification harmless. Generated tests, imports, and package scripts execute code when the coordinator runs them. A separate Git clone isolates the candidate's files, not its execution privileges. A disposable verification environment with restricted credentials and explicit commands is a separate boundary to design.

Self-reported instruction compliance needs the same skepticism. One hosted pilot found the planted bug in 21.5 seconds and claimed to stay within its three-read-call budget. Validated records showed five `read_file` calls. Those were five calls, not proof of five distinct files. The pilot failed its declared bound even though it found the bug.

Prompt limits express a task contract. Runtime permissions enforce available actions. Observed counts test compliance. A worker's answer cannot certify any of those by itself.

## 4. A truthful stop can still be an unfinished task

The one-shot turn-limit fix recognizes a narrow combination: exit code 1 without a signal, the expected final streamed marker, the same standalone stderr marker, and a matching configured limit. That reports `completed` with `stop_reason: max_turn_requests` and a partial-result warning. Unrelated crashes keep their classification.

Here is the important distinction, using selected fields from a saved retry result:

```json
{
  "state": "completed",
  "backend": "programmatic",
  "stop_reason": "max_turn_requests",
  "changed_files": [],
  "warnings": [
    "Vibe stopped with stop reason max_turn_requests instead of end_turn; the result may be incomplete."
  ],
  "integrity": { "status": "verified", "write_tool_observed": false }
}
```

The worker stopped and the supervisor reported it correctly. The review still lacked a final answer. Neither `completed` nor unchanged files establish task success.

ACP added another trap: Vibe 2.25.8's budget is cumulative across the session, including reloads. Sending another prompt does not reset it. The supervisor refuses continuation on an exhausted budget unless an explicitly authorized higher total ceiling is supplied, up to its maximum of 50. A new prompt also consumes accounting, so the difference between ceilings is not a guarantee of that many useful model requests.

A changed objective needs an explicit instruction to abandon the old one. In a controlled trial, the new message and ceiling both arrived, but the worker continued its old file-reading chain. Smaller follow-ups and an explicit task replacement worked in separate trials, including after reload.

An earlier edit also went silent for 15 minutes. Its cause remains unresolved. A 600-second progress watchdog now bounds inactivity with `VSUP_NO_PROGRESS`; that behavior has fake-backend coverage, not hosted confirmation of the original stall's cause.

## 5. Recover the session without replaying an uncertain task

After a restart, the supervisor reads saved records and loads an ACP session only when capabilities and supervisor-owned paths validate. Pending grants are not restored, and the original task is never automatically submitted again.

Hosted tests demonstrated graceful restart and reload on earlier candidates. Abrupt `kill -9` recovery is still unverified on real Vibe. rc.17 adds a 10-second disconnect shutdown deadline that ends only owned workers and releases the lock; those changes have fake-backend coverage.

The latest desktop preflight exposed a different identity problem. The installed CLI and a fresh official-client initialization reported rc.17. The native desktop run's creator metadata reported rc.12, with artifact paths consistent with that older process. The tools looked right, but the connected process was stale.

I stopped before edit acceptance. The next prerequisite is a refreshed desktop connection whose actual version matches the installed artifact. Configuration on disk shows intent; new-run metadata helps establish what executed. The refresh failure's precise mechanism is not yet known.

## 6. Give the coordinator useful replies without treating text as authority

Results stay compact and include state, stop reason, warnings, artifact references, and a supervisor-generated `next_action`. Errors carry remedies. The model should not have to reconstruct the protocol from a long transcript.

But a useful sentence is still guidance. It cannot authorize a larger budget, an unsafe verification command, or applying a patch. Repository contents and worker replies are untrusted data; they may contain instructions aimed at the coordinator. Filtering out project hooks and inherited skills does not remove prompt injection from files the worker can read.

A task contract should name the objective, relevant files, exact base, available tools, acceptance criteria, and stopping conditions. Corrections should send the new failure and requested change, rather than another full repository briefing.

For reviews, I want a location, trigger, consequence, and supporting evidence, or an explicit no-defect result within the stated scope. A confident answer and a clean execution record are both insufficient evidence of review accuracy.

## 7. Wait for activity, then inspect what happened

Start tools and `vibe_status` accept `wait_seconds` from 0 to 300. They return on an event, state change, pending request, or settled run. A settled start can include the result directly; otherwise the coordinator waits again and fetches details when needed. `setup` configures a 600-second client tool timeout.

This avoids repeatedly requesting unchanged status. It is not a measured token-saving claim. A new event also does not necessarily mean the coordinator must intervene; it needs to inspect the state and request before acting.

The acceptance loop still matters more than the call count: wait, inspect, verify, correct if needed, and close. Fewer calls are useful only if they preserve enough evidence to make that decision.

## What the failed soak actually tells us

The original plan mixed 60 one-shot reviews, 30 edits, and 10 ACP jobs. Later attempts exposed a silent edit stall, repeated searches without a final answer, and the pilot's incorrect read-count claim. The full plan has not passed.

The driver now reports instruction compliance separately and permits a declared amount of truthfully reported truncation in its lifecycle gate. That is a changed evaluation contract, not evidence that earlier failed tasks became successful. The three-read-call pilot remains a failed pilot under its original rules.

I need separate results for:

| Question | Evidence |
|---|---|
| Did supervision work? | Deadlines, accurate stops, recovery, bounded artifacts, owned-resource cleanup |
| Did the task finish within its contract? | Final answer, scope and call budgets, intended files changed |
| Was the output correct? | Seeded-defect and clean-control judgments; independent tests of the exact patch |

A lifecycle soak cannot establish broad review quality. Ten ACP scenarios cannot justify removing the one-shot backend that handled the other ninety jobs. A passing synthetic correction does not establish acceptance on a product repository.

As of October 9, offline rc.17 release/install checks passed. Current native desktop acceptance, full hosted reliability, clean-account installation, permission callbacks, and Intel evidence remain open. The [handoff](https://github.com/crew-lab/codex-vibe/blob/87c6bf217add26cd34989b0526899e12ae5eabb7/Handoff.md) records the sequence and links the receipts.

## Small experiments, limited cost claims

Earlier synthetic runs were quick: two rc.7 nested-file reviews had settled replies in 8.9 and 3.8 seconds, and an eleven-file edit in 12.1 seconds. These were measurements after the start call's wait returned, not complete end-to-end or first-token latencies, and not a benchmark distribution.

My account observation on October 8 showed €1.20 used from €8.50 of monthly credit through rc.8. That is one account's dated observation, not a promised allowance. Worker-reported costs are not billing data. I have not established total savings or the cost of a completed soak.

The next useful measurements are accepted outcomes, correction rounds, complete elapsed time, and usage across repeated tasks. A second model being available is not evidence that it finds defects the coordinator misses.

## Three questions worth working on

The code and [dated evidence](https://github.com/crew-lab/codex-vibe/tree/87c6bf217add26cd34989b0526899e12ae5eabb7/docs/history) are public. The parts I would most value another developer's perspective on are:

1. **Review integrity:** how should an application distinguish concurrent developer edits from worker writes, and report the blind spots of metadata-based comparisons? A small reproduction or a clearer result contract would be useful.
2. **Acceptance evidence:** how should tests, reviewer findings, and correction rounds be tied to an exact candidate so an earlier pass cannot validate a later patch? The rc.13 early-close case is a concrete starting point.
3. **Session identity and recovery:** what should a coordinator check to detect a stale connection before delegating work, and how should abrupt interruption be reproduced without replaying an uncertain task?

You do not need a provider account to inspect those designs or run fake-backend tests. macOS, Node.js 20.19 or newer, npm, and Git are the documented development prerequisites. `npm ci` builds the checkout; `npm test` runs the TypeScript suite. Hosted tests are separate and send permitted content to Mistral. The [contributor instructions](https://github.com/crew-lab/codex-vibe/blob/87c6bf217add26cd34989b0526899e12ae5eabb7/AGENTS.md) describe the boundaries.

{% details Optional: reproduce the documented installation %}
This revision discusses rc.17 at the pinned commit below. Its clean-account installation and current native hosted acceptance remain unverified. For hosted work you also need `uv`, exactly Vibe 2.25.8, and provider authentication through Vibe's supported browser login.

```sh
uv tool install mistral-vibe==2.25.8
vibe
```

After completing login:

```sh
git clone https://github.com/crew-lab/codex-vibe.git
cd codex-vibe
git checkout 87c6bf217add26cd34989b0526899e12ae5eabb7
npm ci
npm link
vibe-supervisor setup --workspace /absolute/path/to/a/disposable/repository --dry-run
```

`npm link` registers the local executable. The setup dry run previews configuration; it does not register the MCP connection. Follow the [pinned README](https://github.com/crew-lab/codex-vibe/blob/87c6bf217add26cd34989b0526899e12ae5eabb7/README.md) for explicit setup and restart steps. Check the connected version before inference. The supervisor enforces application policy, not an operating-system sandbox, and runs with your account's permissions. Only delegate content you intend to share with the provider.
{% enddetails %}

Which distinction does your agent setup expose today: worker stopped, task finished, or result accepted? If it collapses them into one success flag, what failure would make you split it?

Reproductions and design feedback can go in the comments or [repository issues](https://github.com/crew-lab/codex-vibe/issues). Please include the version, expected outcome, observed outcome, and a minimal example without credentials or private run histories. Part 2 will examine the process ownership and recovery machinery behind these checks.

*This article was developed with AI assistance and checked against the project's recorded evidence and source. This revision did not add hosted test results. The project is independent of OpenAI and Mistral AI.*
