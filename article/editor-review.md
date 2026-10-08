# Editor review of `final.md` (2026-10-08)

Reviewed against [plan](plan.md), [research](research.md) and [evidence](evidence.md). `wc -w` on the file: 2,753. No em dashes, none of the banned words. The "Never write" list is clean except for two borderline phrasings noted in section 5.

## 1. Verdict

Publish after a focused edit pass, not a rewrite: the structure is right for DEV, the evidence discipline is better than almost anything on #showdev, and the soak-died-on-run-1 story is a real hook. What holds it back is density: the post is 750 words over target, tells the soak story twice, leans on project vocabulary ("hosted", "programmatic", "ACP", "VSUP_*", "harness") that a Claude Code or Cursor reader has to decode, and repeats one rhetorical construction ("X, not Y") often enough to read as machine prose. Fix those, cut the duplicated sections, and this is a credible Top 7 candidate for #mcp and #ai.

## 2. Scores

| Dimension | Score | Why |
|---|---|---|
| Hook | 4 | The first paragraph is concrete and honest (27.4 s, the stop marker, exit 1, the wrong error code). It loses a point because the fourth sentence explains the point before the reader has felt it, and because the same story is retold at full length in check 4. |
| Title and description | 3 | "7 things to check" is scannable but "things" is filler; the description is 32 words and crams four payloads into one sentence. See section 6. |
| Structure and pacing | 3 | Seven numbered H2s plus a checklist card is the right skeleton. Pacing sags in check 4 (two stories, 420 words) and the post has three endings in a row (What this is not, Try it, Your turn). |
| Clarity | 3 | Every sentence is precise, but "hosted", "programmatic", "ACP mode", "legacy harness", "owner lock", `session/load` are never defined for someone who has not read the repo. A DEV reader will read "hosted probes" as "in the cloud". |
| Voice and authenticity | 3 | The honesty reads as a person. The construction "X, not Y" appears about ten times (a promise / a check, not an rm -rf / neither success nor failure / verified, not configured / Vibe's figure, not billing data / not a sandbox, it is a policy). That cadence, plus "If you take one thing from this post", is the strongest AI tell in the text. |
| Technical credibility | 5 | Conditions travel with every number, blind spots are named, and the author admits what is tested only against fakes. This is the post's main asset; do not cut it. |
| Reader value for non-users | 4 | The checklist card and check 4's closing lesson transfer. What is missing is one worked example in the reader's own stack (what the "limit" signal looks like in a tool they use) and a redacted real result rather than an illustrative one. |
| Skimmability | 4 | TL;DR card, numbered headings, two code blocks, one table, one checklist card. The 13-line table of contents is noise on DEV, where the post is already sectioned. |
| Ending and call to action | 4 | Two good questions for the comments and a specific ask for Codex users. The Part 2 teaser lists three things nobody has context for yet ("one end-of-run path", "owner lock"). |
| Length | 2 | 2,753 words against a 2,000 target. About 30 percent of the text is duplicated between the hook, check 4, "How the pieces fit" and "Try it". |

## 3. Line-level edits

Each: original (quoted), the problem, the rewrite.

1. **Title.** "7 things to check before one coding agent hands work to another"
   Problem: "things" is filler; "hands work to" is softer than what the post is about.
   Rewrite: "7 checks before one coding agent delegates to another"

2. **Description.** "Lessons from an MCP server that lets Codex delegate reviews and edits to Mistral Vibe: read-only that is checked, edits as patches, honest stop reasons, and the soak test that died on run 1."
   Problem: four payloads in one sentence; the social card truncates after about 150 characters, so the story lands last.
   Rewrite: "My 100-run agent soak test died on run 1 because my MCP server called a turn limit a crash. Seven checks I now make before Codex hands code to Mistral Vibe."

3. **TL;DR card.** "The interesting part is not the pairing but the seven boundaries I had to make true before I trusted one agent to drive another, and the test that showed one of them was a lie."
   Problem: 38-word sentence; "the interesting part is not X but Y" is a stock construction.
   Rewrite: "The pairing is a config entry. The hard part was seven boundaries I had to make true before I trusted one agent to drive another, and a test that showed one of them was false."

4. **Opening.** "On 2026-10-07 I started the first 100-run soak test of a tool that lets one coding agent delegate to another."
   Problem: ISO date in the first five words reads like a changelog; "the first" is a phrase the evidence file tells you to avoid, even if the sense is different.
   Rewrite: "Last week I started my first 100-run soak test of a tool that lets one coding agent delegate to another."

5. **Opening, last sentence.** "I had shipped a release candidate that called a limit a crash, and a partial review had come within one field of looking like a finished one."
   Problem: "within one field" is an inside reference; the reader has not seen the result shape yet.
   Rewrite: "I had shipped a release candidate that called a limit a crash. Flip one branch of that logic the other way and a half-finished review would have looked complete."

6. **Second paragraph.** "Here is what I needed to be true, how I checked it, and where the checks still fall short."
   Problem: three-beat promise, a classic AI cadence, and it repeats the TL;DR.
   Rewrite: "The seven checks below are what I needed to be true. Each one shows how I tested it and where the test is still thin."

7. **Check 1 opening.** "A review profile that exposes only `read_file` and `grep` is a promise, and a tool that turns out to write breaks it silently."
   Problem: "turns out to write" is vague; the reader wants to know what could go wrong.
   Rewrite: "Giving the worker only `read_file` and `grep` is a promise. If a tool is misregistered, or the worker finds another path to disk, nothing tells you."

8. **Check 1.** "In the hosted probes on 2026-10-07, a read outside the workspace and a read of `.env` were refused"
   Problem: "hosted" means "on the real machine with real Vibe" in this project; on DEV it means a cloud service. Used nine times.
   Rewrite: "In the runs against real Vibe on 2026-10-07, a read outside the workspace and a read of `.env` were refused". Define once in the TL;DR: "'real run' below means Vibe 2.25.8 on my Mac, not a fake backend", then drop the adjective.

9. **Check 2.** "Two things caught me out."
   Problem: fine as voice, but the two items that follow are a caveat and a design decision, not surprises.
   Rewrite: "Two details matter in practice."

10. **Check 3.** "and a reviewer that can run arbitrary commands is a different risk."
    Problem: trailing clause with no referent; "different" from what?
    Rewrite: "and a reviewer that can run arbitrary commands is a reviewer that can run `rm -rf` or `curl`."

11. **Check 4 opening.** "Both failures that shaped this release are the same failure in two shapes: Vibe reaching its turn budget, and the supervisor not telling the truth about it."
    Problem: "the same failure in two shapes" is a slogan; and the first failure was already told in the hook.
    Rewrite: "The run-1 crash from the opening and a second bug from a real deployment task share a cause: Vibe hit its turn budget and my code did not say so."

12. **Check 4, the fix sentence.** "the supervisor reports a turn-limit stop as `completed` with `stop_reason: max_turn_requests` and a partial-result warning only when exit code 1 with no signal, Vibe's final message ending with the stop marker, the same marker standing alone on stderr, and the turn count in the marker all agree with what the supervisor configured."
    Problem: 62 words, one sentence, five conditions. This is the paragraph that proves care, so make it a list.
    Rewrite: "The fix is narrow on purpose. A stop is classified as `completed` with `stop_reason: max_turn_requests` and a partial-result warning only when all four agree: exit code 1 with no signal; Vibe's final message ends with the stop marker; the same marker stands alone on stderr; the turn count in the marker matches what the supervisor configured. Anything else keeps the old crash classification."

13. **Check 4.** "The second came from a real deployment task on an earlier candidate in ACP mode (Agent Client Protocol, which keeps a session open for corrections)."
    Problem: "programmatic" was used three times before ACP is contrasted with it; the reader never learns there are two ways to run Vibe.
    Rewrite: "The second came from a real deployment task on an earlier candidate. That one used ACP (Agent Client Protocol), the mode that keeps a Vibe session open so Codex can send corrections; the soak used the one-shot mode."

14. **Check 4.** "continuing the same session with a correction "remained exhausted"."
    Problem: a quoted fragment with no source; reads as an unexplained log line.
    Rewrite: "every correction sent to that session came back with the same `max_turn_requests` stop and no work done."

15. **Check 4, closing.** "If you take one thing from this post: find out how your worker signals "I stopped at a limit", and test that your coordinator sees that signal as different from both success and failure."
    Problem: "If you take one thing from this post" is a listicle tell. The sentence after it is the best line in the post; let it stand alone.
    Rewrite: "Find out how your worker signals 'I stopped at a limit', then test that your coordinator treats that signal as neither success nor failure. Mine did not, twice."

16. **Check 5.** "The owner lock that detects a reused PID is a story for Part 2."
    Problem: teases a concept the reader has no reason to want. Same for "one end-of-run path" in the final paragraph.
    Rewrite: "How the supervisor tells a restarted server from a stale one that still thinks it owns the run is a story for Part 2."

17. **Check 6 opening.** "The coordinator is a language model without your docs open, and it should not need a skill installed to drive the loop."
    Problem: "skill installed" is Claude Code vocabulary applied to Codex; confusing for both audiences.
    Rewrite: "The coordinator is a language model that has not read your docs, and it should be able to drive the loop from the replies alone."

18. **Check 7.** "The start tools and `vibe_status` take `wait_seconds` from 0 to 300 and return as soon as the coordinator is needed"
    Problem: "the start tools" have never been named; the reader does not know what tools exist.
    Rewrite: "`vibe_review`, `vibe_edit` and `vibe_status` take `wait_seconds` (0 to 300) and return as soon as the coordinator is needed". Confirm the tool names against `docs/reference.md` before using them.

19. **How the pieces fit.** "launches Vibe through a small Python shim that refuses any Vibe other than 2.25.8."
    Problem: the reader meets "launcher shim" in the diagram with no explanation of why a Python layer exists between a Node server and a Python CLI.
    Rewrite: "launches Vibe through a small Python shim that sits in Vibe's own process, refuses any Vibe other than 2.25.8, and keeps the run's history out of your global Vibe state."

20. **What this is not.** "Other choices you may not like: an exact Vibe pin (2.26.0 came out on 2026-10-06 and is refused until I rerun the hosted tests on it), one supervisor per data directory unless you use `--isolated`, Vibe's legacy harness only, and macOS only."
    Problem: "legacy harness" and "one supervisor per data directory" mean nothing outside the repo; this sentence is a list of settings, not trade-offs.
    Rewrite: "Other choices you may not like: it refuses any Vibe except 2.25.8 (2.26.0 shipped on 2026-10-06 and stays refused until I rerun the real tests on it), it runs one Codex window at a time unless you pass `--isolated`, and it is macOS only."

21. **Try it.** "What rc.8 has proven, on macOS arm64: hosted programmatic reviews and edits, ACP continuation, restart recovery and idle expiry through the official MCP client on rc.7, and Codex desktop registration on an earlier candidate."
    Problem: a status report written for the Handoff file, not a reader; four version labels in one sentence.
    Rewrite: "Verified against real Vibe on a Mac: reviews, edits, continuation, restart recovery and idle timeout, all through the official MCP test client, plus registration in the Codex desktop app on an earlier build. Not yet: the 100-run soak, the turn-budget gate on a real run, a full pass inside the Codex desktop app, and an install on a clean account."

22. **Your turn.** "If you cannot run it, a star tells me the patterns are worth writing up further"
    Problem: asking for stars is the one line a #showdev moderator will read as promotion.
    Rewrite: "If you cannot run it, tell me in the comments which of the seven checks your own setup already does, and which one it fakes."

23. **Closing teaser.** "Part 2 is the engineering deep dive: a crash-safe MCP supervisor with one end-of-run path, the owner lock that survives PID reuse, and how the review snapshot went from 30.2 s to 2.6 s."
    Problem: "deep dive" is the one phrase in the post a reader would flag as blog-speak; two of the three items are opaque.
    Rewrite: "Part 2 is the engineering: how a run reaches exactly one end state whatever dies, how a restarted server proves it owns a run, and how the review snapshot went from 30.2 s to 2.6 s."

24. **AI note.** "*This article was written with AI assistance and checked against the project's recorded test evidence.*"
    Problem: fine, but research.md says the sentence does not set the label; make sure the editor label is set to AI-Assisted.
    Rewrite: keep, and set the label.

## 4. Structural recommendations

Target: about 2,000 words. The cuts below remove about 750 without touching any evidence.

**Cut**

- The table of contents (13 lines). DEV posts of this length with numbered H2s do not need one, and it pushes check 1 below the fold on mobile. Expected effect: the reader reaches the first check one screen earlier.
- The second telling of the soak in check 4. Keep the hook as the full story (it already has the numbers) and reduce check 4's first bold paragraph to the fix and the retry (about 120 words). Saves roughly 150.
- "How the pieces fit" prose paragraph (about 110 words). It restates check 1 (allowlist), check 2 (worktree) and the TL;DR. Keep the diagram, add the two facts that are new (private HOME/VIBE_HOME, task text never in `ps`) as two lines under it.
- The cost table's third row (98 ms) duplicates check 5. Drop it from the table.
- The TOML block. The paragraph before it already makes the point (tool timeout must exceed the wait); the block only shows the two timeout values. Replace with one sentence: "`setup` writes `tool_timeout_sec = 600` into `~/.codex/config.toml` for that reason." Saves about 40 words and a code block.
- "What this is not", second paragraph, merge into "Try it" as the prerequisites sentence. The post currently has three consecutive wind-down sections.

**Move**

- The "Steal this checklist" card should sit directly after check 7, before the diagram, and the diagram should become part of check 1 or an appendix. Readers who skim stop at the card; put it where the argument ends.
- The quoted example prompt in "Try it" is the most concrete thing in the post for a non-user. Move it up to check 6 as the request that produces the JSON reply, so the reply shape has a cause.

**Missing for a DEV reader**

- One real, redacted result. The JSON in check 6 is labelled illustrative. Replace it with an actual reply from the 15.2 s retry (the run that was reported truthfully), redacted. Expected effect: the post's central claim ("honest stop reasons") gets a primary source, and the illustrative label disappears.
- One sentence per check saying what the reader can do in their own stack. Example under check 4: "In the Claude Agent SDK the equivalent is a result message whose subtype says the turn limit was hit; check that your code branches on it." Verify any such claim about another tool before publishing; the post must not state facts about Claude Code, Cursor or Copilot from memory.
- A definition of "turn" the first time it appears: one model request with its tool calls.
- A picture. The cover (Codex, supervisor, Vibe, patch file) should also appear inline as the diagram with alt text; DEV renders the ASCII block fine, but an image is what gets shared.
- A one-line takeaway at the end of each check, in bold or as the last sentence. Checks 1, 3 and 4 have one; 2, 5, 6 and 7 do not.

## 5. Fact and claim check against evidence.md

Nothing in the text contradicts the "Never write" list in meaning. Items below are overclaims, missing conditions, or claims whose source is outside evidence.md and should be confirmed before publishing.

| Passage | Issue | Action |
|---|---|---|
| "Both hosted reviews found the planted arithmetic bug" | evidence.md says "a planted bug"; "arithmetic" is not recorded | Drop "arithmetic" or confirm from the rc-7 test record |
| "In the hosted probes on 2026-10-07, a read outside the workspace and a read of `.env` were refused, and `write_file` was an unknown tool in a review" | Condition lost: the probes ran on the ACP backend; evidence notes both backends share the tool list | Add "(on the ACP backend; both backends use the same tool list)" or say so in a footnote |
| "`allow_shell: true` is rejected as an unknown field" | AGENTS.md says it is rejected; "as an unknown field" is a mechanism not stated in evidence.md | Confirm against `docs/reference.md` or shorten to "is rejected" |
| "The plan was 60 programmatic reviews, 30 programmatic edits and 10 ACP runs" | Not in evidence.md | Confirm from the soak plan in `docs/history/`; otherwise say "100 runs mixing reviews, edits and ACP sessions" |
| "at 50, Vibe's maximum, you start a new run" | Not in evidence.md | Confirm from the Vibe 2.25.8 source comparison; otherwise cut the number |
| "`wait_seconds` from 0 to 300" and "tool_timeout_sec = 600" | From `docs/reference.md` and `src/cli/codex.ts` per review.md, not evidence.md | Acceptable; keep |
| "Node.js 20.19 or newer" | Not in evidence.md | Confirm against `package.json` `engines` |
| `uv tool install mistral-vibe==2.25.8` and the clone/`npm link` block | plan.md requires every command run on a clean macOS account; D20 is open | Either run them before publishing or add "(tested on my machine, not yet on a clean account)" |
| Diagram label "Codex (CLI or desktop)" | plan.md: Codex CLI was never tested; the post "must not claim it was tested". The label reads as support | Change to "Codex desktop" or "Codex (desktop tested; CLI untested)" |
| "the first 100-run soak test" (opening) | "the first" is on the never-write list for the product; here it is the first attempt, but a moderator scanning for it will not know that | "my first 100-run soak test" |
| "If you do not have Vibe, use Linux or Windows ... this is not for you" | Mentions Linux and Windows only to exclude them; permitted, but the sentence buries macOS-only in a list | Fine; consider leading with "macOS only" |
| "the model's reasoning is not stored at all" | AGENTS.md says reasoning filtering; evidence.md does not state "at all" | Confirm against `docs/security.md`; otherwise "is filtered out of what is stored" |
| "Earlier hosted edits cost about $0.02 each as Vibe reported them" | Matches evidence with condition | Keep |
| Numbers table (8.9 / 3.8 s, 12.1 s, 98 ms) and the 27.4 s / 15.2 s runs | Match evidence with conditions | Keep |
| "This gate is new in rc.8 and so far tested only against fake backends" | Matches evidence | Keep; this is the sentence that earns the technical-credibility score |
| TL;DR "lets Codex hand code reviews and edits to Mistral Vibe" | Fine; no client other than Codex is claimed anywhere | Keep |
| "Vibe 2.25.8's published source explained why: it counts turns per session, not per prompt, and keeps the count across `session/load`" | Matches plan.md | Keep; link the source comparison in `docs/history/` if it is public |

## 6. DEV packaging

**Title.** Recommended: **"7 checks before one coding agent delegates to another"** (55 characters). Keeps the number DEV readers scan for, says the topic in the words the audience uses ("delegates"), and matches the seven H2s.

Alternatives:

1. "My 100-run agent soak test died on run 1. The bug was a lie about a limit" (73 characters). Strongest click for #ai, weakest for search, and it hides the checklist, which is what non-users take away. Use this as the Part 2 or cross-post title.
2. "Before you let one coding agent call another, check these 7 things" (67 characters). More conversational, but "things" again.
3. "What I had to make true before Codex could hand code to Mistral Vibe" (68 characters). Honest and specific, but names two tools most readers do not use in the title, which the plan already decided against.

**Description.** "My 100-run agent soak test died on run 1 because my MCP server called a turn limit a crash. Seven checks I now make before Codex hands code to Mistral Vibe." (157 characters; the story first, the search terms second.)

**Tags.** `showdev, mcp, ai, security` stands. If the star ask is removed and the post leads with the checklist, `showdev` is defensible. If you want reach over precision, swap `security` for `programming`; I would not, because the #security page has fewer posts per day and the boundary content fits it.

**Cover.** Keep the planned flow (Codex, supervisor, Vibe, patch) but add the stop marker as the visual hook: a terminal line reading `<vibe_stop_event>Turn limit of 12 reached</vibe_stop_event>` with `VSUP_BACKEND_CRASHED` crossed out and `max_turn_requests` written in. The post's claim is "honest stop reasons"; the cover should show the lie and the correction. No vendor logos.

**Slot.** Tuesday or Wednesday, 13:00 to 15:00 UTC. Reasoning: DEV's audience skews US and European; the US morning overlaps the European afternoon, and comments in the first two hours move a post up the feed (research.md). The Top 7 is assembled midweek from the preceding days. For an author in UTC+3 that is 16:00 to 18:00 local, which leaves the evening for replies. Avoid Friday and the weekend. This is common DEV practice, not measured for this account.

**First comment, posted by the author within a minute of publishing.** Keep it as a question with a concrete offer, not a summary:

> One thing I could not fit in the post: I'd like to collect how different workers signal "I stopped at a limit". Vibe 2.25.8 prints `<vibe_stop_event>Turn limit of N reached</vibe_stop_event>` and exits 1, which is indistinguishable from a crash unless you parse it. If you run sub-agents from Claude Code, Cursor, Copilot or Codex, what does yours emit, and does your coordinator branch on it? I'll put the answers into a table in Part 2 with credit.

## 7. Prioritized to-do

**Must fix before publishing**

1. Define or replace "hosted" everywhere (edit 8); define "turn", "ACP" versus one-shot mode (edit 13), and drop "legacy harness", "owner lock", "one end-of-run path" from the body (edits 16, 20, 23).
2. Cut to about 2,000 words: remove the table of contents, the second telling of the soak, the "pieces" prose paragraph, the TOML block and the duplicate 98 ms row (section 4).
3. Resolve the diagram label "Codex (CLI or desktop)" (section 5); the CLI was not tested.
4. Confirm or soften the five claims not in evidence.md: "arithmetic", the 60/30/10 soak plan, Vibe's maximum of 50, Node 20.19, and "reasoning is not stored at all".
5. Run the install commands on a clean account or label them as untested there.
6. Remove the "a star tells me" line (edit 22) and set the AI-Assisted label in the editor.

**Should fix**

7. Replace the illustrative JSON with a real redacted reply from the 15.2 s retry.
8. Break the "X, not Y" pattern: keep it in two places at most (checks 1 and 4) and rewrite the rest (edits 3, 6, 11, 15).
9. Add a one-line takeaway to checks 2, 5, 6 and 7.
10. Add the "(on the ACP backend)" condition to the policy-probe sentence in check 1.
11. Move the example prompt up to check 6 and the checklist card to directly after check 7.
12. Retitle to "7 checks before one coding agent delegates to another" and shorten the description (section 6).

**Nice to have**

13. One verified sentence per check about the reader's own stack (what the limit signal looks like in the Claude Agent SDK or Codex), checked against current docs on publishing day.
14. The cover as an inline image with alt text, showing the stop marker and the corrected classification.
15. A 30-second GIF of one review ending in `stop_reason: max_turn_requests` with the partial warning, which demonstrates check 4 better than any paragraph.
16. Link the Vibe 2.26.0 source comparison if `docs/history/` is public, so the "counts turns per session" claim has a citation.

## Applied must-fix edits (2026-10-08)

Applied to `final.md`; should-fix and nice-to-have items were left alone.

1. **Vocabulary.** "hosted" is gone: the TL;DR defines "real run" (Vibe 2.25.8 on my Mac through the official MCP test client, not a fake backend) and every former "hosted" became "real run" or "real". "Turn" is defined at its first use in the opening. Check 4 now opens by defining one-shot versus ACP mode, and "programmatic" is replaced by "one-shot" throughout. "Legacy harness", "one supervisor per data directory", "owner lock" and "one end-of-run path" are gone (edits 16, 20, 23 applied).
2. **Length.** Removed the table of contents, the retold soak story in check 4 (kept the plan line, the four-condition fix as a list per edit 12, and the retry), the "How the pieces fit" prose paragraph (replaced by two lines of new facts under the diagram), the TOML block (one sentence per section 4) and the 98 ms table row; merged the second "What this is not" paragraph into "Try it". Those cuts saved about 300 words, not the 750 estimated, so sentences were tightened across the body as well. `wc -w` 2,531; prose estimate (no front matter, code blocks, liquid tags) about 2,350. Reaching 2,000 needs the should-fix moves (example prompt into check 6, checklist after check 7) or a cut to the questions section, which were out of scope.
3. **Diagram label.** "Codex (CLI or desktop)" became "Codex (desktop app)".
4. **Claims.** "Arithmetic" kept, the 60/30/10 plan kept, Node 20.19 kept, each now cited in evidence.md. "Vibe's maximum" became "the supervisor's maximum". "Reasoning is not stored at all" became "the supervisor does not persist the model's reasoning and filters it from Vibe's own session history". Also "the first 100-run soak test" became "my first" (never-write list).
5. **Install commands.** Labelled "These are the README steps; I have run them on my own machine but not yet on a fresh macOS account". No clean-account run was made (D20 is still open).
6. **Star ask.** Edit 22 applied; the closing AI-assistance sentence stays. The AI-Assisted label still has to be set in the DEV editor at publishing time.

Length follow-up (2026-10-08): a further tightening pass on checks 1, 2, 5 and 6, the diagram note, the install and status paragraphs and the closing questions brought the prose to about 2,100 words; the JSON warning now uses the supervisor's real warning text.
