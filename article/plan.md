# dev.to article plan: vibe-supervisor

First written 2026-10-07, updated 2026-10-08 after rc.8 and again after the fact-check in [review](review.md). Rules from DEV are in [research](research.md); every claim and number is in [evidence](evidence.md); the current text is [draft](draft.md).

## Goal and reader

- **Goal:** Codex users install vibe-supervisor, try one review and one edit, and open issues. Secondary: credibility for the engineering.
- **Primary reader:** a macOS developer who uses Codex (CLI or desktop app) daily, knows Git, has heard of MCP, and wants a second reviewer or a helper for edits. May never have used Mistral Vibe. Note for the text: only Codex desktop (patched rc.2, 2026-10-05) and the official MCP client (rc.7, 2026-10-07) were exercised; Codex CLI was not, so the post must not claim it was tested.
- **Secondary reader:** someone building MCP servers or multi-agent setups, reading for the safety and recovery design.
- **Promise in one sentence:** Codex can hand reviews and edits to Mistral Vibe through one MCP server, and nothing the second agent writes reaches your checkout until you apply the patch yourself.
- **Post type:** a #showdev launch post with an engineering core (problem, how it works, trade-offs, how to try it, limitations). The deep engineering story becomes Part 2.

## The story that carries it

Two real failures from the target-machine sessions make the post more than a feature list, and both are honest about what went wrong:

1. The first 100-run soak (rc.7, 2026-10-07) stopped on run 1: a broad review hit Vibe's 12-turn limit in 27.4 seconds, Vibe printed `<vibe_stop_event>Turn limit of 12 reached</vibe_stop_event>`, exited 1, and the supervisor called it `VSUP_BACKEND_CRASHED`. The fix reports `completed` with `stop_reason: max_turn_requests` and a partial-result warning, recognized only when exit code, final message, stderr marker and configured turn count agree; the retry on the patched build hit the same limit in 15.2 seconds and was reported truthfully. The review default became 20 turns and the soak tasks were scoped.
2. A real deployment task on rc.4 (ACP, 2026-10-08) saw a continuation that "remained exhausted". Reading Vibe 2.25.8's published source showed its turn budget is cumulative per session and survives `session/load`, so continuing a spent session can never do work. rc.8 refuses that continuation with `VSUP_TURN_LIMIT_REACHED` and asks for a larger `max_turns`, which it sends with `session/set_config_option` before the prompt. That gate is tested against fakes only until Phase D step D21 runs on the target machine.

## Title, tags, cover

Title options, under about 70 characters:

1. **Codex + Mistral Vibe over MCP: read-only reviews, edits as patches** (recommended: says what and how, and carries the search terms)
2. I gave Codex a second code reviewer with read-only access to my repo
3. What I built before letting one coding agent drive another

Description for the social card: "An MIT-licensed MCP server that lets Codex hand reviews and edits to Mistral Vibe. Reviews are read-only; edits come back as patches."

Tags: `showdev, mcp, ai, opensource`. Swap `opensource` for `security` if the guardrails section ends up the strongest part.

Cover, 1000 × 420: the flow Codex → vibe-supervisor → Mistral Vibe ending in a patch file. No OpenAI or Mistral logos; the project is independent and the post says so.

## Outline

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
