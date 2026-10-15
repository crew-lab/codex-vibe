---
title: "Delegating between coding agents without taking their word for it"
published: false
description: "vibe-supervisor 2.0 lets Codex hand one bounded review or one isolated edit to Mistral Vibe. Seven wire-protocol guesses the source corrected, what a cold review found after 1,204 green tests, and a checklist for any agent-to-agent setup."
tags: showdev, mcp, ai, security
# canonical_url: leave unset unless this is cross-posted from a site you own
# cover_image: https://REPLACE-WITH-1000x420-IMAGE-URL (concept in editor-notes.md; or upload in the editor)
---

Every one of the seven facts below would have broken every real run of our tool, and the test suite was green the whole time. We found them by reading the tagged source of the program we were talking to instead of guessing its wire format. Then a cold review of the finished branch, by a reviewer with no design context, found eleven more problems after 1,204 tests had passed.

[vibe-supervisor](https://github.com/crew-lab/codex-vibe) 2.0 is the tool. It is a local MCP (Model Context Protocol) server that lets OpenAI Codex hand one bounded code review, or one edit in a throwaway Git worktree, to Mistral Vibe and get back something it can check. The tool has a narrow audience. The lessons apply to any setup where one agent drives another, and the checklist at the end is meant to be copied.

Disclosure first, because it shapes everything else: this project was built largely by orchestrated AI agents (Claude and Codex) under a human owner who set the scope, read every cold review and authorized every hosted run and release. "We" in this article means that arrangement. The article was drafted the same way, from the project's recorded evidence.

{% card %}
**What it is:** five MCP tools, macOS Apple silicon, Node 20.19 or later, Mistral Vibe 2.26.1 exactly. A review can only read files. An edit comes back as a patch that is never applied, committed or pushed for you. Shell and network tools are off. It is an application policy boundary, not an OS sandbox: Vibe runs as you, and what it may read is sent to Mistral. MIT licensed, independent of Mistral AI and OpenAI.
{% endcard %}

## The problem

When Codex delegates to another agent, what comes back is text: what the worker did, which files it read, whether the tests pass. Every statement is a claim by the thing you are checking. Nothing bounds what the worker could do, nothing records what it did do, and a stop at a limit looks like either success or a crash.

Running the worker in a second terminal and pasting the result is the honest baseline, and small MCP servers that wrap the Vibe CLI and pass text through exist. As far as we found, no other Codex-to-Vibe path supervises the run: decides each approval itself, pins the engine, and returns an unapplied patch from a detached worktree. That supervision is what 2.0 is about.

## What changed in 2.0

1.0 drove Vibe through its legacy headless mode, with a Python shim that patched Vibe's internals. Vibe's own source called that mode a temporary escape hatch, so we moved off it. 2.0 is a client of `vibe-app-server`, the newline-delimited JSON-RPC boundary Vibe's own interfaces use, one server process per run. The five MCP tools and every boundary stayed; the engine underneath is new, so no 1.0 evidence transfers.

As a client, the supervisor owns what the shim used to do: it reads the effective configuration back before the first turn, answers every approval request itself with deny as the default, requires every tool effect in the history to match an approval it gave, and hashes the installed Vibe files against a pin manifest before each spawn. Drift fails closed. That is the whole design, and most of it was wrong the first time we wrote it down.

## Seven guesses the source corrected

Vibe is never run on the machine that writes the code; questions about it are answered from the tagged source (`v2.26.1`, commit `4ae5c59`), with each file's SHA-256 recorded next to the answer. Here is what reading it changed.

1. **Wire fields are camelCase.** The Python attribute is `file_path`; the wire carries `filePath`, because the app-server models serialize by alias. A client matching the attribute name sees no path in any effect.
2. **Every tool has two names.** `enabledTools` takes the config names `read_file`, `write_file` and `edit`; approval callbacks and effects name the same tools `file_system.read_file`, `file_system.write_file` and `file_system.search_replace`. A handler keyed on the short names denies everything.
3. **`read_file` defaults to `always`.** An `always` permission, or an allowlist match, skips the approval callback entirely. So the agent profile sets `permission = "ask"` on every tool it grants and carries only a denylist (`.git`, `.vibe`, `.agents`, `.env*`, key and certificate files). `ask` is the one setting that routes every call through the handler.
4. **Vibe can allow a call without asking.** Scratchpad paths, session grants and a bypass gate all produce an executed effect with no callback. So an effect counts as approved only when its metadata is exactly decision `execute`, type `ask`, source `user`, linked to a handler approval for the same tool and callback. Null metadata is unapproved; any other executed effect ends the run.
5. **There is no run export.** The legacy mode wrote an `export.json` with usage and cost. `vibe-app-server` writes nothing, so usage is rebuilt from `session/statsUpdated` and `runtime/read`, cost from Vibe's pricing formula, and the counters reset at a context handoff, which the client carries across.
6. **The read-back lacks what you expect.** `config/effective/read` has no `max_turns`, and the server redacts MCP `args` and `env`. A read-back that requires either fails every start.
7. **After a handoff, the ids swap roles.** On `session/compacted` and `session/contextCleared` the new session is `sessionId` and the old one `oldSessionId`. Follow the wrong one and you audit a session that no longer exists.

The protocol tests run against a scripted fake server, and a fake encodes what you believe: it proves the client against your beliefs, never against the vendor. Ours is written from the source answers with their hashes and refuses snake_case keys, so a client that drifts back to the attribute names fails the fixture. Grep-based audits miss behaviour; read the tagged source and write down what you read.

## Two implementations are a check

Two 2.0 engines existed on the same day: this branch, written by Claude agents, and a parallel one written by Codex, both clients of the same Vibe version. Read against the source, the Codex branch would have failed every real start at read-back: it required `max_turns` in the effective configuration and compared the MCP arguments the server redacts. It also mapped `rate_limited` where the code is `rate_limit`, left experiments and auto-update on, and ran with thinking `high`, which puts reasoning on disk. Its fake server mirrored its own shapes, so its tests were green too.

It was still worth having. Three of its pieces were stronger and were ported: re-validation after a session handoff with usage carried across, more read-back checks, and effect-to-callback fingerprints, so one approval binds one effect and its exact input. Each branch caught errors the other made. That is the best argument we know for a second, independent implementation of anything with a wire format.

## What a cold review found after 1,204 green tests

Before every merge, a reviewer with no design context reads the diff the way an outside contributor would. The 2.0 branch review came after the full suite passed: 1,204 tests in 80 files at commit `2006e98`. It found eleven numbered findings; ten were fixed and one, the reach of the pin, stayed as a documented limit. Among them:

- The reaper, the separate process that kills the worker group if the supervisor dies, stopped when a failed start could not confirm the worker's exit.
- Approvals were still granted after a stop, and a budget or deadline stop skipped the history audit yet was reported `completed`.
- A protocol fault could be hidden by a later cancel, and an executed-then-cancelled effect was not checked against the approval ledger.
- The event watermark advanced past queued notifications, so a gap could go unnoticed.
- Worker stdout was held twice, with quadratic copying.

None of these is a protocol fact. They are what a suite written by the same minds as the code does not test for: the author asserts the happy path, the cold reviewer asks what happens when the start fails halfway or the cancel arrives after the fault. A green suite tells you the code does what you believed. A cold review tells you what you did not believe.

## What the supervisor enforces, and what it cannot

For anyone copying the pattern, the enforcement points, from preventive to detective:

- **Startup read-back.** The session request sets the worker workspace, a supervisor-written agent profile, the enabled tools, no workspace roots, no MCP servers and no trust of the workspace; the `VIBE_*` environment turns off subagents, shell, connectors, telemetry, experiments, skills and session logging. After `session/start` the supervisor requires exactly what it sent. A missing field or any difference fails the run before the first turn.
- **Approval handler.** Approves only the profile's tool on a path that resolves, through `realpath`, inside the worker workspace and hits no denylisted name. The server never times out a pending approval, so the supervisor answers deny after 5 seconds. It never grants a session or permanent approval.
- **Event validator.** An executed effect the handler did not approve is fatal, as is one whose input differs from the approved fingerprint, an unknown history entry kind, or a gap in event ids. A session handoff is accepted only with no open callback and no unfinished effect, and the configuration is read back again.
- **Pin and privacy.** The installed `mistral_vibe` files are hashed against a manifest before each spawn, and the server must report exactly 2.26.1. Session logging and thinking are off, and Vibe's throwaway store lives under a private `TMPDIR` deleted at close.

And the limits, in the same font size. The model's tool catalogue still lists `write_file`, `edit`, the shell tool and `run_typescript` in every run, reviews included; the protocol cannot hide them. They are refused when called and recorded as `tool_denied` events, and the unchanged-source check after a review is the proof that nothing was written. The validator is detective: by the time it sees an effect, Vibe has already decided it, so it can stop the run and record the breach but not undo it. The pin covers only the files Vibe's own `RECORD` lists, not dependencies, the interpreter or bytecode, and it detects change, not a malicious original. None of this is an OS sandbox.

## Try it

You need macOS Apple silicon, Node 20.19 or later, Git, and Vibe 2.26.1 exactly (`uv tool install mistral-vibe==2.26.1`, then sign in once in the browser). Install the release tarball into a private prefix after checking its checksums (the README has the steps). The configuration is strict TOML and the allowlist starts empty:

```toml
version = 1
allowed_workspace_roots = ["~/src/my-project"]

[paths]
vibe = "vibe"
vibe_pin_manifest = "/Users/you/Library/Application Support/VibeSupervisor-oneshot/vibe-pin-manifest.json"
```

The CLI writes most of that for you, then the pin manifest, then checks the install without launching Vibe:

```sh
CONFIG="$HOME/Library/Application Support/VibeSupervisor-oneshot/config.toml"
vibe-supervisor allow --config "$CONFIG" ~/src/my-project
vibe-supervisor pin-manifest --config "$CONFIG"
vibe-supervisor doctor --config "$CONFIG" --json
```

`setup` registers the server in Codex's `config.toml` as `serve --stdio --isolated --config <path>`, one private storage directory per connection. From Codex, every delegation starts with a readiness call that launches nothing:

```json
{ "workspace": "/Users/you/src/my-project", "operation": "review" }
```

It returns the server version, whether the workspace is eligible and why not, and a receipt valid for ten minutes that the start presents. Then one bounded review or edit, status polling, the result, and `vibe_close`. The shipped skill carries two task templates; the tasks that produced accepted answers were narrow and named their inputs.

## Honest limits

**Answer quality is mixed.** The usefulness log holds six real-project runs, all on the 1.x engine: three accepted, three not. Every accepted run had a narrow scope and an enumerated set of inputs or rejections to satisfy. The edit that failed and the edit that passed differ only in how explicitly the edge cases were listed. Six runs are a pattern to test, not a rate, and 2.0 has no entries yet.

**Cost is unknown.** 1.x recorded no usage; early edits cost about $0.02 each as Vibe reported them, and nothing later was measured. 2.0 rebuilds usage and cost from session statistics and can enforce token and dollar ceilings, but no run on a real Vibe has produced a figure. [UPDATE AT PUBLISH: replace with recorded 2.0.0 target figures if any exist.]

**One platform.** macOS Apple silicon; Linux and Windows code paths exist and are unclaimed until someone records evidence.

**It depends on Mistral's protocol.** `vibe-app-server` has no version field, and Mistral's README does not name it as a supported boundary for third-party clients. So the pin is the compatibility check: each new Vibe release is a new candidate with its own manifest and conformance check, and anything else fails closed. If the protocol changes, this tool stops until it is revalidated. That is intended, and it is the risk.

**Verification is bounded.** [UPDATE AT PUBLISH: state the 2.0.0 target-gate results from `docs/acceptance.json`; while they are open, say that every 2.0 gate is unverified and nothing has run against a real Vibe.]

## The checklist

{% card %}
1. Read the worker's source at the pinned tag and record the hashes. A fake built from guesses proves only your guesses.
2. Own every approval. Deny by default, and put your own deadline on decisions the server never times out.
3. Read the effective configuration back before the first turn; any difference fails the run.
4. Bind each approval to one effect by fingerprint. An executed effect without a matching approval ends the run; so do unknown event kinds and gaps in event ids, because that is where a call could hide.
5. Pin the exact version, hash the install, and say what the hash does not cover.
6. The worker's output is an artifact you review. A patch is returned, never applied.
7. Interrupted runs are failed, never replayed.
8. A stop at a limit is neither success nor failure; the stop reason travels with the result.
9. Count the worker's claims against the event log. A summary's numbers are not evidence.
10. Cold-review before every merge. A green suite is what you believed; the review is what you did not.
{% endcard %}

## Your turn

The repository holds the source answers with their hashes, the acceptance record with every gate and its status, and the usefulness log with the rejected runs next to the accepted ones.

{% embed https://github.com/crew-lab/codex-vibe %}

Two questions for anyone running a different coordinator or worker. When your sub-agent executes a tool call, what proves that you approved that exact call? And when your suite is green, who reads the diff without knowing what it was meant to do?

*This is an independent project, not affiliated with Mistral AI or OpenAI. Written with AI assistance from the project's recorded evidence; the author read the text and checked its claims against the cited files before publishing.*
