# dev.to article plan: vibe-supervisor

Plan written 2026-10-07. Drafting can start now; publishing waits for [Before publishing](#before-publishing).

## Goal and reader

- **Goal:** Codex users install vibe-supervisor, try one review and one edit, and open issues. Secondary: credibility for the engineering.
- **Primary reader:** a macOS developer who uses Codex (CLI or desktop app) daily, knows Git, has heard of MCP, and wants a second reviewer or a helper for edits. May never have used Mistral Vibe.
- **Secondary reader:** someone building MCP servers or multi-agent setups, reading for the safety and recovery design.
- **Promise in one sentence:** Codex can hand reviews and edits to Mistral Vibe through one MCP server, and nothing the second agent writes reaches your checkout until you apply the patch yourself.
- **Post type:** a #showdev launch post with an engineering core (problem, how it works, trade-offs, how to try it, limitations). The deep engineering story becomes Part 2.

## What DEV expects as of October 2026

### Platform rules

| Rule | Consequence for this post |
|---|---|
| Since August 2026 the AI disclosure is a label picked in the editor: Hand Written (No AI), AI-Assisted (Some AI) or Fully Autonomous. Readers have a feed setting for AI content that DEV is still developing. | Pick the label honestly in the editor. A sentence in the text does not set it; one author reported being labelled "Not Disclosed" that way. |
| The AI guidelines (last updated 8 April 2024) require fact-checking and content the author understands, and forbid AI-assisted posts that "Promote any business, program, or course (including your own)". DEV says revised guidelines are coming. | The main risk. Keep the tone that of a free tool, not a product pitch; keep the author's own experience and voice; check every claim. See open question 4. |
| #showdev is the tag for showing projects and launches, and its guidelines ask for posts that are community-minded rather than corporate or salesy. | The right home tag; no marketing tone. |
| At most four tags; cover image 1000 × 420; front matter `title`, `published`, `description`, `tags`, `canonical_url`, `cover_image`, `series`; scheduling in the editor; `{% embed %}`, `{% details %}`, `{% card %}` tags. | See [Title, tags, cover](#title-tags-cover). |
| Staff pick the weekly Top 7 from tag pages (as described in 2021); trusted members and tag moderators raise or lower posts; the August 2026 announcement adds weight to human curation. | Quality and honesty matter more than reach tricks. |
| Community advice: comments move a post back up the feed. | Publish when the author can answer comments for the first hours. |

### Writing practice

From Sentry's public blog-writing guide and GrahamTheDev's 13 tips for DEV posts:

- The first two or three sentences state the problem or the conclusion. No background, no "excited to announce".
- Follow the reader's questions: what problem, how it works, trade-offs and alternatives, how to try it, known limitations.
- Numbers instead of adjectives, each with its conditions. A diagram for any system with more than two parts.
- Informative headings starting at H2 with no skipped levels; a table of contents above about 1,000 to 1,500 words; alt text on every image; MCP and ACP spelled out on first use.
- Every command and code sample tested.
- None of: seamless, robust, leverage, unlock, empower, streamline, cutting-edge. None of the AI-prose tells: staccato fragments, three-beat reveals, slogans, "That's it."
- The author's voice runs through the whole post, not only the opening and the closing.
- The closing gives something concrete (the repository, a specific question), not hype.

## Benefits and the evidence for each

The article claims only what the evidence column supports on publishing day. Phase D fills most gaps.

| Benefit | How it works | Evidence today | Wording rule |
|---|---|---|---|
| A second opinion from another model family without leaving Codex | Codex starts a review, waits inside the tool call, reads the result | Hosted review on 2026-10-05 correctly diagnosed a nested-file bug in a synthetic fixture and left the source unchanged | No "Vibe catches what Codex misses" unless the experiment below shows it |
| Edits never touch your checkout | Detached worktree from `base_ref`; a patch comes back; nothing applied, committed, merged or pushed; cleanup checks the patch before removing the worktree | Hosted programmatic and ACP edits produced correct patches; source unchanged; worktrees removed | "You get a patch and decide." Say that uncommitted changes are not copied into the worktree |
| Reviews are read-only, and checked | Read and search tools only; workspace snapshot at launch compared at the end, Git-visible files hashed | Tests; hosted review | Name the blind spot: ignored paths such as `node_modules/` are compared by metadata only |
| Least privilege by default | Empty allowlist; shell and network tools off with no switch; private `HOME` and `VIBE_HOME`; filtered environment; task text kept out of `ps`; redaction; permission requests matched to tool calls, anything unknown refused | 594 TypeScript and 66 Python tests; hosted basic flows; hosted permission callbacks not yet verified | Always pair with: an application-level policy, not an OS sandbox; Vibe runs with your account's permissions; permitted file content goes to Mistral |
| Runs survive crashes and restarts | Persisted state and events; recovery on demand; owner lock that detects reused PIDs; one end-of-run path; storage faults degrade instead of crashing | Fake backends and a cold review of each phase; hosted restart is Phase D step D11 | "Designed and tested against fakes" until D11 passes |
| Small overhead | Hybrid snapshot, temporary-index export, fsync batched to 100 ms, no probe for an explicit backend, logs loaded on demand | Table below (preparing machine, fake backends) | Supervisor overhead, not model latency. Add hosted time to first event and to completion from Phase D (P1) |
| Easy to adopt | One `setup` command; five tools (seven with ACP); every reply names the next call; every error code has a remedy | Docs; clean-account install is Phase D step D20 | "One command" only after D20 passes |
| Uses your own Vibe login, separate from Codex | Browser login, no API key | Hosted runs used browser login; Vibe reported about $0.04 for the hosted edits | Codex token savings were never measured: no savings claim. Quote cost "as reported by Vibe" from the soak |
| Several Codex windows at once | `--isolated` gives each client its own data directory and reuses free ones | Fake backends; hosted is Phase D step D14 | |
| Everything is inspectable | `transcript.md`, `events.ndjson`, `diff.patch` per run; `runs list`, `show`, `tail` | Tests | |
| Fails closed on version drift | Exact Vibe pin with version and signature checks and a remedy | Tests | Present as a trade-off: Vibe 2.26.0, released 2026-10-06, is refused today |

Measured on the preparing machine (macOS arm64, fake backends), before and after Phase B:

| Path | Before | After |
|---|---|---|
| Review snapshot, 156,169-file tree, per pass | 30.2 s | 2.6 s |
| Patch export, 1 modified and 50 new files | 1.6 to 2.1 s | 0.13 s |
| Persisting 1,000 events | 4.8 s | 18 ms |
| Server start with 200 retained runs | reads every log | under 300 ms |

Never write: "sandbox" or "sandboxed"; "secure" without saying against what; "production-ready" before 1.0; "saves tokens" or "saves money"; "the first" or "the only"; Linux or Windows support; support for MCP clients other than Codex; hosted latency or soak figures before Phase D.

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
| 2 | What goes wrong when one coding agent drives another | 200 | Writes landing in your checkout during a review; shell and network access; secrets in logs and in `ps`; runs lost on restart; a coordinator that does not know when to wait or close; "completed" that really stopped early. Each item points to the section that answers it |
| 3 | A delegated review, seen from Codex | 250 | The review prompt from the README; start with `wait_seconds`, `vibe_status`, result, `vibe_close`; a real trimmed result with `stop_reason`, `integrity` and `next_action` highlighted |
| 4 | Edits come back as a patch | 200 | The edit prompt; worktree from `HEAD`; patch inline or at `patch_path`; Codex runs the tests because the worker has no shell; close with cleanup |
| 5 | How the pieces fit | 150 + diagram | Codex, MCP over stdio, the supervisor (allowlist, run manager, event log, worktrees), the launcher shim (private home, filtered environment, version check), Vibe 2.25.8, Mistral. Programmatic versus ACP in two sentences |
| 6 | Guardrails, and what they do not cover | 250 | One line per guardrail, then the honesty paragraph: not an OS sandbox, Vibe runs as you, file content goes to Mistral, redaction is best effort |
| 7 | Built to survive restarts and failures | 200 | Recovery on demand, the PID-reuse lock, one end-of-run path, honest `stop_reason`. One or two real bugs the cold reviews caught: stderr tails that could leak an API key until the whole buffer was redacted before cutting; a backend "completed" that could override a supervisor timeout |
| 8 | Overhead, measured | 150 + tables | The table above with its conditions; from Phase D: time to first event and to completion (cold and warm), the 100-run soak (failures by code, p50 and p95), cost as reported by Vibe |
| 9 | Trade-offs I chose | 200 | No shell, so Codex runs the tests; the exact Vibe pin and why; never auto-apply; metadata-only checks for ignored paths; programmatic by default, ACP opt-in; one supervisor per data directory; legacy harness only; macOS only |
| 10 | When not to use it, and the alternatives | 150 | Not for you without Vibe access, on Linux or Windows, or if the helper must run tests. Other MCP clients are untested. Alternatives, checked at writing time: Vibe in a second terminal with copy and paste (the honest baseline), general delegation MCP servers such as codex-subagents-mcp, mcp-delegate and agent bridges |
| 11 | Try it in five minutes | 200 + commands | Prerequisites (macOS, Node 20.19+, Git, `uv tool install mistral-vibe==2.25.8`, a Mistral plan with Vibe access, browser sign-in); install from the release with the checksum check; `setup --workspace`; restart Codex; first prompt. Every command run on a clean macOS account |
| 12 | Status | 80 | What 1.0 covers; link to the unverified-gates list; not affiliated with OpenAI or Mistral AI; issues welcome |
| 13 | Closing | 60 | Repository card (`{% embed https://github.com/crew-lab/codex-vibe %}`); one specific question for the comments, such as which task you would hand to a second model and which guardrail you would require first; the AI disclosure sentence |

## Assets

- A GIF or short video recorded on the target machine: one review, then one edit and its patch.
- An architecture diagram with alt text.
- The 1000 × 420 cover.
- One real result JSON from Phase D, redacted.
- The measurement tables with the Phase D values.
- Optional: the experiment table.

## Optional: original data

A small experiment makes the post worth sharing and is the only way to back the cross-model claim. Plant about ten known bugs of different kinds in a small public repository, review it with Codex alone and with Vibe through the supervisor, and compare bugs found, false positives, time and reported cost. Present it as an anecdote, not a benchmark, and publish the repository and prompts.

## Before publishing

1. A v1.0.0 GitHub Release with the tarball and `SHA256SUMS`. None exists yet: the release workflow waits for the `workflow` token scope, so the README's releases link shows an empty page.
2. Phase D passed and its numbers copied from the evidence file.
3. A decision on Vibe 2.26.0 (released 2026-10-06): revalidate it for 1.0, or put the 2.25.8 pin prominently in the prerequisites. Anyone installing Vibe today gets 2.26.0.
4. Repository polish: the GitHub description still reads "Codex ASP client for Mistral Vibe"; add topics, a social preview image and the GIF in the README.
5. Every command run on a clean macOS account.
6. A fact-check pass against the docs; the AI label, tags and cover set; `canonical_url` if cross-posted.
7. A publishing slot when the author can answer comments.

## Series

1. This post.
2. "Engineering a crash-safe MCP supervisor": the lifecycle, the PID-reuse lock, snapshots from 30.2 s to 2.6 s, fsync batching, what the cold reviews found.
3. Phase D results or the cross-model experiment.

## Open questions

1. Personal DEV account or an organization page?
2. Publish at 1.0 only, or earlier as a release candidate asking for testers?
3. Run the experiment?
4. Who writes what? If I draft and you rewrite, the label is AI-Assisted and the promotion clause applies. You writing the opening, the story and the trade-offs lowers that risk.
5. Cross-post from a personal blog with `canonical_url`?
6. Support Vibe 2.26.0 in 1.0?

## Sources

- [DEV: Guidelines for AI-assisted articles](https://dev.to/guidelines-for-ai-assisted-articles-on-dev)
- [DEV: Introducing AI Disclosure on DEV](https://dev.to/devteam/introducing-ai-disclosure-on-dev-tools-for-nuance-clarity-and-better-feeds-34mk)
- [DEV editor guide](https://dev.to/p/editor_guide) and [writing, editing and scheduling help](https://dev.to/help/writing-editing-scheduling)
- [#showdev](https://dev.to/t/showdev) and [#mcp](https://dev.to/t/mcp) tag pages
- [How does the promotion of posts work on DEV](https://dev.to/grahamthedev/how-does-the-promotion-of-posts-work-on-dev-39c) and [13 tips for high-quality DEV posts](https://dev.to/grahamthedev/how-to-write-the-highest-quality-posts-on-dev-13-top-tips-cj6)
- [Sentry blog writing guide](https://github.com/getsentry/skills/blob/main/skills/blog-writing-guide/SKILL.md)
- [Mistral Vibe 2.0 announcement](https://mistral.ai/fr/news/mistral-vibe-2-0) and [mistral-vibe on PyPI](https://pypi.org/project/mistral-vibe/)
- Project evidence: `Handoff.md`, `docs/compatibility.md`, `CHANGELOG.md`
