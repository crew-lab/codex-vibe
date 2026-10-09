# What DEV expects (researched 2026-10-07)

Platform rules and writing practice that shape the article. Recheck the AI rules before publishing: DEV announced revised guidelines are coming.

## Platform rules

| Rule | Consequence for this post |
|---|---|
| Since August 2026 the AI disclosure is a label picked in the editor: Hand Written (No AI), AI-Assisted (Some AI) or Fully Autonomous. Readers have a feed setting for AI content that DEV is still developing. | Pick the label honestly in the editor. A sentence in the text does not set it; one author reported being labelled "Not Disclosed" that way. A draft written with Claude is AI-Assisted at least. |
| The AI guidelines (last updated 8 April 2024) require fact-checking and content the author understands, and forbid AI-assisted posts that "Promote any business, program, or course (including your own)". | The main risk. Keep the tone of a free tool, not a product pitch; keep the author's own experience and voice; check every claim. |
| #showdev is the tag for showing projects and launches, and its guidelines ask for posts that are community-minded rather than corporate or salesy. | The right home tag; no marketing tone. |
| At most four tags; cover image 1000 × 420; front matter `title`, `published`, `description`, `tags`, `canonical_url`, `cover_image`, `series`; scheduling in the editor; `{% embed %}`, `{% details %}`, `{% card %}` tags. | See [plan](plan.md#title-tags-cover). |
| Staff pick the weekly Top 7 from tag pages (as described in 2021); trusted members and tag moderators raise or lower posts; the August 2026 announcement adds weight to human curation. | Quality and honesty matter more than reach tricks. |
| Community advice: comments move a post back up the feed. | Publish when the author can answer comments for the first hours. |

## Writing practice

From Sentry's public blog-writing guide and GrahamTheDev's 13 tips for DEV posts:

- The first two or three sentences state the problem or the conclusion. No background, no "excited to announce".
- Follow the reader's questions: what problem, how it works, trade-offs and alternatives, how to try it, known limitations.
- Numbers instead of adjectives, each with its conditions. A diagram for any system with more than two parts.
- Informative headings starting at H2 with no skipped levels; a table of contents above about 1,000 to 1,500 words; alt text on every image; MCP and ACP spelled out on first use.
- Every command and code sample tested.
- None of: seamless, robust, leverage, unlock, empower, streamline, cutting-edge. None of the AI-prose tells: staccato fragments, three-beat reveals, slogans, "That's it.", em dashes.
- The author's voice runs through the whole post, not only the opening and the closing.
- The closing gives something concrete (the repository, a specific question), not hype.

## Landscape

Other ways to let one coding agent hand work to another, to mention fairly and recheck at writing time: running Vibe in a second terminal and pasting results (the honest baseline); general delegation MCP servers such as codex-subagents-mcp, mcp-delegate and agent bridges between CLIs. No existing bridge between Codex and Mistral Vibe was found on 2026-10-07; do not claim "the first".

Mistral Vibe 2.0 (January 2026) is available on Le Chat Pro and Team plans with pay-as-you-go credits, or with an API key. Recheck prices before quoting them. Vibe 2.26.0 (2026-10-06) is newer than the supervisor's pin of 2.25.8.

## Sources

- [DEV: Guidelines for AI-assisted articles](https://dev.to/guidelines-for-ai-assisted-articles-on-dev)
- [DEV: Introducing AI Disclosure on DEV](https://dev.to/devteam/introducing-ai-disclosure-on-dev-tools-for-nuance-clarity-and-better-feeds-34mk)
- [DEV editor guide](https://dev.to/p/editor_guide) and [writing, editing and scheduling help](https://dev.to/help/writing-editing-scheduling)
- [#showdev](https://dev.to/t/showdev) and [#mcp](https://dev.to/t/mcp) tag pages
- [How does the promotion of posts work on DEV](https://dev.to/grahamthedev/how-does-the-promotion-of-posts-work-on-dev-39c) and [13 tips for high-quality DEV posts](https://dev.to/grahamthedev/how-to-write-the-highest-quality-posts-on-dev-13-top-tips-cj6)
- [Essential writing tips for DEV](https://dev.to/hanzla-baig/essential-writing-tips-for-devto-community-f2e)
- [Sentry blog writing guide](https://github.com/getsentry/skills/blob/main/skills/blog-writing-guide/SKILL.md)
- [Mistral Vibe 2.0 announcement](https://mistral.ai/fr/news/mistral-vibe-2-0) and [mistral-vibe on PyPI](https://pypi.org/project/mistral-vibe/)
- [codex-subagents-mcp](https://github.com/leonardsellem/codex-subagents-mcp)
