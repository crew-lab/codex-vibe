# Story sources

The facts the dev.to article and its [editor notes](article/editor-notes.md) take from the development history that the 2.0.1 cleanup removed from the tree. Each row gives the fact in a sentence and where it was read. Citations are plain text: read one with `git show d360f28:<path>`, and the line number is the line in that file at commit d360f28. Nothing here ships in the package.

## The two 2.0 engines

| Fact | Citation |
|---|---|
| Two 2.0 engines existed on 2026-10-14: `claude/app-server-design` (A) and `codex/unified-harness-v2` (B, commit `c3678cc`), both clients of `vibe-app-server` for Vibe 2.26.1. A side-by-side review against the Vibe source chose A as the base and ported B's stronger pieces. | commit d360f28, `docs/history/v2-path-2026-10-14.md:3` |
| B would have failed every real start at read-back: it required `max_turns` in `config/effective/read`, which the schema does not have, and compared MCP `args` and `env`, which the server redacts. It also mapped `rate_limited` where the code is `rate_limit`, left experiments, auto-update and title generation on, ran with thinking `high`, never deleted a crashed run's private directories, and its fake server mirrored its own shapes. | commit d360f28, `docs/history/v2-path-2026-10-14.md:7` |
| Three pieces were ported from B: handoff re-validation with usage continuity, extra read-back checks (active agent, default agent, MCP discovery errors, nothing running at start), and effect-to-callback fingerprints. | commit d360f28, `docs/history/v2-path-2026-10-14.md:13-15` |

## Reading the source

| Fact | Citation |
|---|---|
| Every wire fact was read from Vibe's tagged source, `v2.26.1` = commit `4ae5c5955da8e761318916bdb1a7f46f0b50c7d0`, without installing or running anything; the SHA-256 of each file read is recorded. (The same table is now in `docs/compatibility.md`, "Source basis".) | commit d360f28, `docs/history/app-server-source-answers-2026-10-14.md:3`, `:108-135` |
| Guess 1: wire fields are camelCase because the models serialize by alias; `filePath` is the path as the model wrote it. | commit d360f28, `docs/history/app-server-source-answers-2026-10-14.md:27`, `:35` |
| Guess 2: callbacks and effects name tools `file_system.read_file`, `file_system.write_file` and `file_system.search_replace`; the model-visible names are the short ones. | commit d360f28, `docs/history/app-server-source-answers-2026-10-14.md:7-23` |
| Guess 4: an allowed or executed effect is approved only with decision `execute`, approval type `ask` and source `user`; a call that never passed the gate carries null metadata, which is treated as unapproved. | commit d360f28, `docs/history/app-server-source-answers-2026-10-14.md:76-93` |
| Guess 6: `config/effective/read` has no `max_turns`, and the server redacts MCP `args` and `env`. | commit d360f28, `docs/history/v2-path-2026-10-14.md:7` |

## The 1.x engine, as the article describes it

| Fact | Citation |
|---|---|
| Vibe's source described the legacy harness, which 1.0 used, as a temporary escape hatch kept until the legacy runtime is removed. | commit d360f28, `docs/history/outreach-drafts.md:28`; `docs/history/article/draft-1.0.md:92` |
| The 1.x supervisor never read Vibe's own `export.json` with token usage and cost, so 1.x recorded no usage. | commit d360f28, `docs/history/article/draft-1.0.md:90`; `docs/history/usefulness-log.md:3` |
| Early hosted edits cost about $0.02 each as Vibe reported (rc.2, 2026-10-05, synthetic repository, legacy engine). | commit d360f28, `docs/history/article/evidence.md:34` |

## Real-project runs

| Fact | Citation |
|---|---|
| Six real-project runs on 1.x-era versions, three accepted and three not. Every accepted run had a narrow scope and an enumerated set of inputs or rejections; the two edits differ only in how explicitly the edge cases were listed. A pattern to test, not a rate. | commit d360f28, `docs/history/usefulness-log.md:5-16` |
| The skill's edit template says "Must reject or preserve" because of those runs. | commit d360f28, `docs/history/usefulness-log.md:20` |

## Positioning and platform rules

| Fact | Citation |
|---|---|
| The independence line: the project is independent of Mistral AI (the outreach drafts add OpenAI). | commit d360f28, `docs/history/outreach-drafts.md:35` |
| The repository description was "Codex ASP client for Mistral Vibe" with no topics, and the drafted description and nine topics replace it. | commit d360f28, `docs/history/outreach-drafts.md:41`, `:43-51` |
| DEV's AI disclosure became an editor label (Hand Written, AI-Assisted, Fully Autonomous) in August 2026; the older guidelines page still forbids AI-assisted posts that promote your own program; revised guidelines were announced as coming. | commit d360f28, `docs/history/article/research.md:3`, `:9`, `:10`, `:56` |
