---
title: "Delegating between coding agents without taking their word for it"
published: false
description: "vibe-supervisor lets Codex hand one bounded review or one isolated edit to Mistral Vibe, one single-use grant per start. Seven wire-protocol guesses the source corrected, what cold reviews found after green suites, two accepted runs with their numbers, and a checklist."
tags: showdev, mcp, ai, security
# canonical_url: leave unset unless this is cross-posted from a site you own
# cover_image: https://REPLACE-WITH-1000x420-IMAGE-URL (concept in editor-notes.md; or upload in the editor)
---

Every one of the seven facts below would have broken every real run of our tool, and the test suite was green the whole time. We found them by reading the tagged source of the program we were talking to instead of guessing its wire format. Then a cold review of the finished branch, by a reviewer with no design context, found eleven more problems after 1,204 tests had passed. Three releases later, two runs through the real connection were accepted by an independent check. This is what it took, and what is still not proven.

[vibe-supervisor](https://github.com/crew-lab/codex-vibe) is the tool. It is a local MCP (Model Context Protocol) server that lets OpenAI Codex hand one bounded code review, or one edit in a throwaway Git worktree, to Mistral Vibe and get back something it can check. The tool has a narrow audience. The lessons apply to any setup where one agent drives another, and the checklist at the end is meant to be copied.

Disclosure first, because it shapes everything else: this project was built largely by orchestrated AI agents (Claude and Codex) under a human owner who set the scope, read every cold review and authorized every hosted run and release. "We" in this article means that arrangement. The article was drafted the same way, from the project's recorded evidence.

{% card %}
**What it is:** five MCP tools, macOS Apple silicon, Node 20.19 or later, Mistral Vibe 3.0.2 exactly. Every start needs a single-use grant. A review can only read files. An edit comes back as a patch that is never applied, committed or pushed for you. Shell and network tools are off. It is an application policy boundary, not operating-system isolation: Vibe runs as you, and what it may read is sent to Mistral. MIT licensed; an independent project, not affiliated with Mistral AI or OpenAI. The current release is 2.2.0, published 2026-10-27 as a pre-release after two accepted native runs. [UPDATE AT PUBLISH: state whether 2.2.0 is marked latest.]
{% endcard %}

## The problem

When Codex delegates to another agent, what comes back is text: what the worker did, which files it read, whether the tests pass. Every statement is a claim by the thing you are checking. Nothing bounds what the worker could do, nothing records what it did do, and a stop at a limit looks like either success or a crash.

Running the worker in a second terminal and pasting the result is the honest baseline, and small MCP servers that wrap the Vibe CLI and pass text through exist. As far as we found, no other Codex-to-Vibe path supervises the run: decides each approval itself, pins the engine, authorizes each start once, and returns an unapplied patch from a detached worktree. That supervision is what the tool is about.

## From a patched shim to a protocol client

1.0 drove Vibe through its legacy headless mode, with a Python shim that patched Vibe's internals. Vibe's own source called that mode a temporary escape hatch, so we moved off it. Since 2.0 the supervisor is a client of `vibe-app-server`, the newline-delimited JSON-RPC boundary Vibe's own interfaces use, one server process per run. The five tools and every boundary stayed; the engine was new, so no 1.0 evidence transferred. That rule has held since: evidence belongs to the exact archive it was recorded on.

As a client, the supervisor owns what the shim used to do: it reads the effective configuration back before any turn, answers every approval request itself with deny as the default, requires every tool effect in the history to match an approval it gave, and hashes the installed Vibe files against a pin manifest before each spawn. Drift fails closed. That is the whole design, and most of it was wrong when we wrote it down.

## Seven guesses the source corrected

Vibe is never run on the machine that writes the code; questions about it are answered from the tagged source, with each file's SHA-256 recorded next to the answer. These seven were read at Vibe `v2.26.1` (commit `4ae5c59`). When the pin moved to 3.0.2 the app-server files were read again at that tag (commit `36f7b3a`), and the primitives the facts rest on are still there: the approval callback, the approval type and source on each effect, sequential event ids, the redacted effective configuration.

1. **Wire fields are camelCase.** The Python attribute is `file_path`; the wire carries `filePath`, because the app-server models serialize by alias. A client matching the attribute name sees no path in any effect.
2. **Every tool has two names.** `enabledTools` takes the config names `read_file`, `write_file` and `edit`; approval callbacks and effects name the same tools `file_system.read_file`, `file_system.write_file` and `file_system.search_replace`. A handler keyed on the short names denies everything.
3. **`read_file` defaults to `always`.** An `always` permission, or an allowlist match, skips the approval callback entirely. So the agent profile sets `permission = "ask"` on every tool it grants and carries only a denylist (`.git`, `.vibe`, `.agents`, `.env*`, key and certificate files, plus any exclusions you configure per root). `ask` is the one setting that routes every call through the handler.
4. **Vibe can allow a call without asking.** Scratchpad paths, session grants and a bypass gate all produce an executed effect with no callback. So an effect counts as approved only when its metadata is exactly decision `execute`, type `ask`, source `user`, linked to a handler approval for the same tool and callback. Null metadata is unapproved; any other executed effect ends the run.
5. **There is no run export.** `vibe-app-server` writes nothing, so usage is rebuilt from `session/statsUpdated` and `runtime/read`, cost from Vibe's pricing formula, and the counters reset at a context handoff, which the client carries across.
6. **The read-back lacks what you expect.** `config/effective/read` has no `max_turns`, and the server redacts MCP `args` and `env`. A read-back that requires either fails every start.
7. **After a handoff, the ids swap roles.** On `session/compacted` and `session/contextCleared` the new session is `sessionId` and the old one `oldSessionId`. Follow the wrong one and you audit a session that no longer exists.

The protocol tests run against a scripted fake server, and a fake encodes what you believe: it proves the client against your beliefs, never against the vendor. Ours is written from the source answers with their hashes and refuses snake_case keys. A parallel engine written by Codex from the same source, green on its own fake, would have failed every real start at read-back; comparing the two branches caught errors in each, and three of its pieces were ported. Even then, the installed server found three beliefs both fakes had encoded wrongly: a null harness-provenance field, a managed-configuration refresh from a remote endpoint whenever a provider key is present, and Vibe's packaged skills listed with every skill disabled. Each became a repair; the supervisor now serves Vibe a disabled policy from its own loopback endpoint and reads that URL back before any turn. Read the tagged source, write down what you read, and expect the running program to correct you once more.

## What cold reviews found after green tests

Before every merge, a reviewer with no design context reads the diff the way an outside contributor would. The 2.0 engine review came after the full suite passed: 1,204 tests in 80 files at commit `2006e98`. It found eleven numbered findings; ten were fixed and one, the reach of the pin, stayed as a documented limit. Among them: the reaper, the separate process that kills the worker group if the supervisor dies, stopped when a failed start could not confirm the worker's exit; approvals were still granted after a stop, and a budget stop skipped the history audit yet was reported `completed`; a protocol fault could be hidden by a later cancel.

The review of the 2.1.0 pre-release, again after a green suite, found three more. A deadline or cancel that landed while the supervisor was still reading a completed turn's final history killed the server, so a completed run could end as failed. A review's grant was bound to file timestamps, so any editor or build touching the tree spent a single-use attempt; it is now bound to the content of the files Git does not ignore. And a correction mode that was switched off everywhere had still edited the shared finalization path: deferring a feature means removing its code from shared paths, not just its entry point. The fixes made a new candidate whose evidence had to be earned again, and 2.1.0 stayed published with a known-issue note.

None of these is a protocol fact. They are what a suite written by the same minds as the code does not test for: the author asserts the happy path, the cold reviewer asks what happens when the start fails halfway or the cancel arrives after the fault. A green suite tells you the code does what you believed. A cold review tells you what you did not believe.

## How a start works now

A readiness check used to be enough to start a run. Since 2.1 every start carries a grant that authorizes exactly one attempt of exactly one request. From Codex:

1. `vibe_status` in workspace mode. It launches nothing and reports whether the workspace is eligible and why not, which build the connection runs, whether the version-matched preparation check has passed, the server's own Node executable, and a receipt valid for ten minutes.
2. `vibe-supervisor task authorize`, run by the coordinator with the exact request as a private JSON file, an owner reference, an expiry within 24 hours, the same configuration and the server's Node executable. It writes a private grant and returns `authorization_id` and `attempt_id`. It starts no worker.
3. The start tool, with the same request plus the two ids and the receipt. The grant stores a hash per bound field: every field of the request, the edit's base commit or the review's file contents, the candidate archive, the Node runtime, the pin manifest and the policy. If one differs, the start is refused with `details.differing_fields` naming the fields, never their values. A grant authorizes one start; a competing consumer is refused; nothing refunds, retries or replays it, and no MCP tool can create one.
4. Status polling on the same connection, the result, then `vibe_close`, optionally with an assessment bound to the patch and contract hashes.

That is also the current friction: the grant is a hand-assembled command, and one wrong field is a refusal. 2.2.0 made the refusal explain itself; nothing yet prevents it. 2.2.0 also added `allowed_write_paths` for edits, a list of files and directory prefixes outside which every write is denied while the run continues, bound into the grant like everything else.

## What two accepted runs proved, and what they did not

2.2.0 was qualified on 2026-10-27 with two owner-authorized starts through the native Codex connection, on the exact archive later published: Node 24.21.0 on macOS arm64, an isolated Vibe 3.0.2 (the machine's `vibe` on `PATH` had already moved to 3.0.3 and was not used).

- **An edit on a one-file fixture.** The worker read a contract and one source file and changed a single comparison from `>` to `>=`. The frozen acceptance contract passed on the exported patch; the coordinator applied that patch in a disposable copy and ran ten independent numeric cases, and the original fixture was unchanged. 8.1 seconds, 3 model calls, 22,275 tokens, an estimated USD 0.015.
- **A review of two documents in a real project.** Three conclusions were accepted after the coordinator checked each excerpt against its source. A concurrent commit changed the repository's HEAD during the run; all 274 project-file hashes stayed identical and no write tool was observed. 13.6 seconds, 2 model calls, 40,194 tokens, an estimated USD 0.044.

The approval ledgers show two or three approved reads each, one approved edit, zero denials; both workers exited, private state was removed and the slot was released. The runtime reported the model as `mistral-vibe-cli-latest`, alias `mistral-medium-3.5`, thinking off; the provider and the underlying weights are unverified. The cost is Vibe's pricing formula applied to reported tokens, not a bill.

What they do not prove: general reliability, a clean-account installation, how a nested `run_typescript` call is gated, anything about the second backend, or that Codex gets better answers by delegating. Before them the record was mixed: the 2.0.1 hosted review stayed inside every boundary and reversed two of five cases, the 2.0.1 edit missed its contract, the 2.1.0 fixture edit was accepted, and the six real-project runs on the 1.x engine split three accepted, three not. The accepted tasks were narrow and named their inputs. A pattern to test, not a rate.

## What the supervisor enforces, and what it cannot

For anyone copying the pattern, the enforcement points, from preventive to detective:

- **Startup read-back.** The session request sets the worker workspace, a supervisor-written agent profile, the enabled tools, no workspace roots, no MCP servers and no trust of the workspace; the `VIBE_*` environment turns off subagents, shell, connectors, telemetry, experiments, skills and session logging. After `session/start` the supervisor requires exactly what it sent; any difference fails the run before any turn.
- **Approval handler.** Approves only the profile's tool on a path that resolves, through `realpath`, inside the worker workspace and hits no denylisted name, no configured exclusion and nothing outside `allowed_write_paths`. The server never times out a pending approval, so the supervisor answers deny after 5 seconds. It never grants a session or permanent approval.
- **Event validator.** An executed effect the handler did not approve is fatal, as is one whose input differs from the approved fingerprint, an unknown history entry kind, or a gap in event ids. A session handoff is accepted only with no open callback and no unfinished effect, and the configuration is read back again.
- **Pin and privacy.** The installed `mistral_vibe` files are hashed against a manifest before each spawn, and the server must report exactly 3.0.2. Session logging and thinking are off, and Vibe's throwaway store lives under a private `TMPDIR` deleted at close. An interrupted run is marked failed at restart; nothing is resumed or replayed from saved state.

And the limits, in the same font size. The model's tool catalogue still lists `write_file`, `edit`, the shell tool and `run_typescript` in every run, reviews included; the protocol cannot hide them. They are refused when called and recorded as `tool_denied` events, and the unchanged-source check after a review is the proof that nothing was written. The validator is detective: by the time it sees an effect, Vibe has already decided it, so it can stop the run and record the breach but not undo it. The pin covers only the files Vibe's own `RECORD` lists, not dependencies, the interpreter or bytecode, and it detects change, not a malicious original. The grant ledger is private local state; whoever can rewrite it can defeat the accounting. None of this is operating-system isolation.

## Try it

You need macOS Apple silicon, Node 20.19 or later, Git, and Vibe 3.0.2 exactly (`uv tool install mistral-vibe==3.0.2`, then sign in once in the browser or provide `MISTRAL_API_KEY`). Install the release archive into a private prefix after checking its checksums, and keep the `preparation-kit-2.2.0/` folder that ships beside it; the README has the steps. The configuration is strict TOML with an empty allowlist, and the CLI writes it for you, then the pin manifest, then checks the install without launching Vibe, then runs the one no-inference conformance check that every later start requires:

```sh
CONFIG="$HOME/Library/Application Support/VibeSupervisor-oneshot/config.toml"
vibe-supervisor allow --config "$CONFIG" ~/src/my-project
vibe-supervisor pin-manifest --config "$CONFIG"
vibe-supervisor doctor --config "$CONFIG" --json
vibe-supervisor prepare check --kit /path/to/preparation-kit-2.2.0 --config "$CONFIG"
```

`setup` registers the server in Codex's `config.toml` as `serve --stdio --isolated --config <path>`, one private storage directory per connection. From Codex, every delegation begins with a `vibe_status` readiness call (`workspace` and `operation`) that launches nothing, then the grant, from the exact request you are about to send, with the Node executable that readiness reported:

```sh
vibe-supervisor task authorize --config "$CONFIG" --runtime-node "$NODE_FROM_READINESS" \
  --request ./request.json --owner-reference "review of parseLimit" \
  --expires-at "$(node -p 'new Date(Date.now() + 30 * 60 * 1000).toISOString()')"
```

Then one bounded review or edit with the returned ids, status polling, the result, and `vibe_close`. The shipped skill carries two task templates; the tasks that produced accepted answers were narrow and named their inputs.

## Honest limits

**Answer quality is mixed.** The record above is the whole record. The supervisor reports what the worker did, not whether its answer is right; the acceptance contract, the export and your own checks decide.

**Cost is barely measured.** Two figures exist, both from 2026-10-27 on 2.2.0 with Vibe 3.0.2: about USD 0.015 for the fixture edit and USD 0.044 for the two-document review, as the runtime estimated them from reported tokens. Per-run token and dollar ceilings and a per-root daily budget exist; a ceiling can overshoot by one model call. [UPDATE AT PUBLISH: add any later recorded figures with their conditions, or leave these two.]

**One platform.** macOS Apple silicon; Linux and Windows code paths exist and are unclaimed until someone records evidence.

**It depends on Mistral's protocol.** `vibe-app-server` has no version field, and Mistral's documentation does not name it as a supported boundary for third-party clients. 3.0.0 removed three app-server RPCs. 3.0.3, four days after 3.0.2, renamed the edit tool on the approval wire from `file_system.search_replace` to `file_system.edit` with no changelog line; under the pin, an edit on 3.0.3 would be denied every edit, which is the pin doing its job. So we stay on 3.0.2 and re-pin on a trigger, not per release. A source review on 2026-10-27 looked for a steadier surface and found none: ACP runs the same app-server with fewer controls, the headless prompt mode decides every approval itself, the agent socket and `run-server` are not supported entry points, and Codex can delegate to another agent only through an MCP server.

**A second backend exists, frozen.** Google Antigravity's CLI can be selected as the worker behind an explicit experimental flag. Its tool gate is a hook the vendor's process must load and obey, the repository holds no evidence yet that it does, and everything that worker reads goes to Google. Not for production; frozen at one CLI version; gone in the next minor if nobody opts in.

**Verification is bounded.** Two accepted native runs on one archive, plus a no-inference conformance check, native readiness and a client disconnect on earlier archives. Not observed: a clean-account installation (no spare account exists), the gating of a nested `run_typescript` call, whether thinking off stops reasoning generation, and the experiments fetch. And one plain fact: the gate ledger in `docs/acceptance.json` still names 2.1.0 as the candidate while the 2.2.0 trials sit under `research/evidence/`; a ledger that lags two releases protects nobody, and bringing it up to date is step one of what comes next. [UPDATE AT PUBLISH: re-read `docs/acceptance.json` and the evidence folder for the release being announced; say whether the ledger now carries 2.2.0 and its two trials, and name anything else that changed.]

## What comes next

Not features. About ten real starts through Codex on real work, each logged with its export and its usefulness entry, because every priority is a guess until that log exists. Then the start friction, without touching the grant: readiness returning the exact `task authorize` command bound to the connected server. Reviews cannot search; the cheap experiment is having Codex search first and pass the hits as context files, and a read-only search sidecar is built only if the nested-call gate proves deniable and that experiment does not close the gap.

## The checklist

{% card %}
1. Read the worker's source at the pinned tag and record the hashes. A fake built from guesses proves only your guesses, and the running program will still correct you.
2. Own every approval. Deny by default, and put your own deadline on decisions the server never times out.
3. Read the effective configuration back before any turn; any difference fails the run.
4. Bind each approval to one effect by fingerprint. An executed effect without a matching approval ends the run; so do unknown event kinds and gaps in event ids, because that is where a call could hide.
5. Authorize each start once, bound to the exact request. A refusal names the field, never the value, and nothing is replayed.
6. Pin the exact version, hash the install, and say what the hash does not cover.
7. The worker's output is an artifact you review. A patch is returned, never applied.
8. Interrupted runs are failed, never replayed.
9. A stop at a limit is neither success nor failure; the stop reason travels with the result.
10. Count the worker's claims against the event log. A summary's numbers are not evidence; a correct patch was once rejected from its own abbreviated summary.
11. Cold-review before every merge. A green suite is what you believed; the review is what you did not.
{% endcard %}

## Your turn

The repository holds the source answers with their hashes, the acceptance record with every gate and its status, and the sanitized evidence of the two accepted runs beside the record of the rejected ones.

{% embed https://github.com/crew-lab/codex-vibe %}

Two questions for anyone running a different coordinator or worker. When your sub-agent executes a tool call, what proves that you approved that exact call? And when your suite is green, who reads the diff without knowing what it was meant to do?

*This is an independent project, not affiliated with Mistral AI or OpenAI. Written with AI assistance from the project's recorded evidence; the author read the text and checked its claims against the cited files before publishing.*
