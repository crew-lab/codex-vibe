# dev.to article plan: vibe-supervisor

First written 2026-10-07, updated 2026-10-08 after rc.8, after the fact-check in [review](review.md), and again for the DEV-reader revision (see [review, Revision for DEV readers](review.md#revision-for-dev-readers-2026-10-08)). Rules from DEV are in [research](research.md); every claim and number is in [evidence](evidence.md); the current text is [final](final.md), with [draft](draft.md) kept as the 1.0 base.

## Goal and reader

- **Goal:** build interest among DEV readers, most of whom will never install the tool: they leave with a checklist they can apply to their own agent setup and a reason to star or comment. Secondary: the few who use Codex on macOS with Vibe access install it, try one review and one edit, and open issues.
- **Primary reader:** a DEV reader who uses Claude Code, Cursor, Copilot or Codex, may build MCP servers, and is curious or worried about letting one agent call another. Almost none have Vibe. The post has to pay them back in transferable patterns, not in features.
- **Secondary reader:** a macOS developer who uses Codex daily and wants a second reviewer. Note for the text: only Codex desktop (patched rc.2, 2026-10-05) and the official MCP client (rc.7, 2026-10-07) were exercised; Codex CLI was not, so the post must not claim it was tested.
- **Angle:** seven things that have to be true before one coding agent hands work to another (read-only that is checked, edits as patches in a throwaway worktree, no shell, honest stop reasons, runs that survive restarts, replies that name the next call, waiting inside the tool call), each shown with vibe-supervisor as the worked and tested example. The product is the evidence, not the pitch; this also keeps the post inside DEV's AI-assisted rule against promoting your own program.
- **Promise in one sentence:** here is what I had to make true before I trusted one agent to drive another, how I checked it, and the test that showed one check was a lie.
- **Post type:** a #showdev post whose core is a reusable checklist with a real failure story. The deep engineering story becomes Part 2.

## The story that carries it

Two real failures from the target-machine sessions make the post more than a feature list, and both are honest about what went wrong:

1. The first 100-run soak (rc.7, 2026-10-07) stopped on run 1: a broad review hit Vibe's 12-turn limit in 27.4 seconds, Vibe printed `<vibe_stop_event>Turn limit of 12 reached</vibe_stop_event>`, exited 1, and the supervisor called it `VSUP_BACKEND_CRASHED`. The fix reports `completed` with `stop_reason: max_turn_requests` and a partial-result warning, recognized only when exit code, final message, stderr marker and configured turn count agree; the retry on the patched build hit the same limit in 15.2 seconds and was reported truthfully. The review default became 20 turns and the soak tasks were scoped.
2. A real deployment task on rc.4 (ACP, 2026-10-08) saw a continuation that "remained exhausted". Reading Vibe 2.25.8's published source showed its turn budget is cumulative per session and survives `session/load`, so continuing a spent session can never do work. rc.8 refuses that continuation with `VSUP_TURN_LIMIT_REACHED` and asks for a larger `max_turns`, which it sends with `session/set_config_option` before the prompt. That gate is tested against fakes only until Phase D step D21 runs on the target machine.

## Title, tags, cover

Title options for the DEV revision, under about 70 characters, each a specific claim, story or payoff rather than an announcement:

1. **7 things to check before one coding agent hands work to another** (chosen, 64 characters: a payoff every reader can use, a number DEV readers scan for, and it matches the seven numbered sections)
2. My 100-run agent soak died on run 1. The bug was a lie about a limit (the story hook; strongest for #ai readers, but it hides what the post teaches)
3. Codex calling Mistral Vibe over MCP: read-only that is actually checked (carries the search terms, but reads as a product post to the majority who have neither)

The search terms (Codex, Mistral Vibe, MCP) live in the description and in the first three paragraphs instead of the title. Earlier options, kept for the 1.0 post: "Codex + Mistral Vibe over MCP: read-only reviews, edits as patches"; "I gave Codex a second code reviewer with read-only access to my repo".

Description for the social card: "Lessons from an MCP server that lets Codex delegate reviews and edits to Mistral Vibe: read-only that is checked, edits as patches, honest stop reasons, and the soak test that died on run 1."

Tags: `showdev, mcp, ai, security`.

- `showdev`: the home tag for a project post; its guidelines ask for community-minded rather than salesy, which the checklist angle satisfies.
- `mcp`: the smallest tag but the most precise audience; people building MCP servers are the ones who can steal the reply-shape and wait-inside-the-call patterns.
- `ai`: the reach tag for readers who run agents without building servers.
- `security` replaces `opensource`: the transferable core is a boundary checklist (verified read-only, no shell, filtered environment, honest failure reporting), which is what the #security readership reads for; `opensource` adds no reader the embed card does not already tell, and `programming` is too broad to earn a place on its tag page. The honesty paragraph (application-level policy, not an OS sandbox) keeps the tag defensible.

Cover, 1000 × 420: the flow Codex → vibe-supervisor → Mistral Vibe ending in a patch file. No OpenAI or Mistral logos; the project is independent and the post says so.

## Outline

The outline below is draft 2's, kept as the base for the 1.0 post. The DEV revision in [final](final.md) reorders it around the seven checks: TL;DR card; the soak hook; one H2 per check with the vibe-supervisor evidence and its conditions (check 4 holds both turn-limit failures); the architecture diagram; a "Steal this checklist" card; costs; what this is not; try it with rc.8 status; a closing that asks a question of readers who will never install it and announces Part 2.

About 2,300 words (roughly a 9-minute read) with a table of contents. `[author]` marks text only the author can write.

| # | Section (H2) | Words | Content |
|---|---|---|---|
| 0 | TL;DR card | 60 | What it does, for whom, status (macOS, version, MIT), the install line |
| 1 | Opening, no heading | 120 | The problem in two or three sentences: `[author]` why a second reviewer, and the moment wiring one in looked risky. Then a 30 to 45 second GIF |
| 2 | What goes wrong when one coding agent drives another | 200 | Writes landing in your checkout during a review; shell and network access; secrets in logs and in `ps`; runs lost on restart; a coordinator that does not know when to wait or close; "completed" that really stopped early |
| 3 | A delegated review, seen from Codex | 250 | The review prompt; start with `wait_seconds`, `vibe_status`, result, `vibe_close`; a real trimmed result with `stop_reason`, `integrity` and `next_action` highlighted |
| 4 | Edits come back as a patch | 200 | The edit prompt; worktree from `HEAD`; the patch; Codex runs the tests because the worker has no shell; close with cleanup |
| 5 | How the pieces fit | 150 + diagram | Codex, MCP over stdio, the supervisor, the launcher shim, Vibe 2.25.8, Mistral. Programmatic versus ACP in two sentences |
| 6 | Guardrails, and what they do not cover | 250 | One line per guardrail, then the honesty paragraph |
| 7 | Two things that broke on real runs | 250 | The story above: the turn-limit "crash" and the cumulative budget |
| 8 | Overhead, measured | 150 + tables | Numbers from [evidence](evidence.md); soak figures after Phase D |
| 9 | Trade-offs I chose | 200 | No shell; the exact Vibe pin; never auto-apply; metadata-only checks for ignored paths; programmatic by default; one supervisor per data directory; legacy harness only; macOS only |
| 10 | When not to use it, and the alternatives | 150 | See [research](research.md#landscape) |
| 11 | Try it | 200 + commands | Prerequisites, install from the release with the checksum check, `setup`, restart Codex, first prompt. Every command run on a clean macOS account; no "five minutes" claim until D20 passes |
| 12 | Status | 80 | What 1.0 covers; link to the unverified gates; not affiliated with OpenAI or Mistral AI; issues welcome |
| 13 | Closing | 60 | Repository card; one specific question for the comments; the AI disclosure sentence |

## Assets

- A GIF or short video recorded on the target machine: one review, then one edit and its patch.
- An architecture diagram with alt text.
- The 1000 × 420 cover.
- One real result JSON from Phase D, redacted.
- The measurement tables with Phase D values.
- Optional: the [experiment](experiment.md) table.

## Before publishing

1. A v1.0.0 GitHub Release with the tarball and `SHA256SUMS`. None exists yet: the release workflow waits for the `workflow` token scope.
2. Phase D passed on rc.8 and its numbers copied into [evidence](evidence.md).
3. The Vibe version stated plainly in the prerequisites (2.25.8 for 1.0 unless 2.26.0 is revalidated).
4. Repository polish: the GitHub description still reads "Codex ASP client for Mistral Vibe"; add topics, a social preview image and the GIF in the README.
5. Every command run on a clean macOS account.
6. A fact-check pass against [evidence](evidence.md); the AI label, tags and cover set; `canonical_url` if cross-posted.
7. A publishing slot when the author can answer comments.

## Series

1. This post.
2. "Engineering a crash-safe MCP supervisor": the lifecycle, the PID-reuse lock, snapshots from 30.2 s to 2.6 s, fsync batching, what the cold reviews found.
3. Phase D results or the experiment.

## Open questions

1. Personal DEV account or an organization page?
2. Publish at 1.0 only, or earlier as a release candidate asking for testers?
3. Run the experiment?
4. Who writes what? The draft is AI-Assisted; the `[author]` parts and a pass in your own voice keep it within DEV's rules.
5. Cross-post from a personal blog with `canonical_url`?
