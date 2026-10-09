# Article: vibe-supervisor on dev.to

Everything for the launch article lives here. It is not part of the npm package (`files` is an allowlist).

| File | What it holds |
|---|---|
| [plan.md](plan.md) | Goal, reader, story, title and tags, outline, assets, what blocks publishing, open questions |
| [final.md](final.md) | Revised rc.17 article, with DEV front matter, an evidence-based failure story and open engineering questions |
| [draft.md](draft.md) | Draft 2 with `[author]` and `[...]` placeholders, the base for a 1.0 version once Phase D has numbers |
| [evidence.md](evidence.md) | Every benefit and number the article may use, with its conditions and source; the claims it must never make |
| [research.md](research.md) | DEV's publishing and AI-disclosure rules, writing practice, the landscape, sources |
| [experiment.md](experiment.md) | Optional planted-bug comparison of Codex alone and Codex with Vibe |
| [review.md](review.md) | Fact-check of plan, evidence and draft 1 against the repository, editorial findings, decisions for the author |

## Status (2026-10-09)

- [final.md](final.md) now opens with the failed soak and separates supervision, task completion and independent acceptance. The title is "My first agent delegation soak test failed on run 1". The architecture and full correction workflow appear early; release chronology is shortened. The closing names three concrete design questions for developers, including people without a provider account.
- The seven checks remain, with corrected snapshot limitations, coordinator verification risks, prompt-injection boundaries, explicit changed soak criteria, conservative measurements and the stale rc.12 desktop connection observed during rc.17 preflight. New source-grounded points are in [evidence.md](evidence.md#development-focused-revision-2026-10-09). Recommendations are labelled as design work, not implemented capabilities or new hosted results.
- Tags remain `showdev, mcp, ai, security`. Full hosted soak and current rc.17 native acceptance remain open. Optional installation steps are pinned to reviewed main commit `87c6bf217add26cd34989b0526899e12ae5eabb7` and stop at setup dry-run.
- DEV recommendations and policy caveats were rechecked on 2026-10-09: see [research.md](research.md#development-interest-recheck-2026-10-09). The older AI guideline still restricts promotion of a program; the newer disclosure announcement does not explicitly remove that wording. No open-source exception is assumed. This revision centers engineering lessons and requests for evidence, but this is not a moderation clearance. Before posting, the author must review the current policy and disclosure tier, verify the article in their own voice, confirm public repository links/description, and preview the Liquid formatting. Optional cover size is 1000 × 420.
- At 1.0, rebuild from draft.md with the Phase D numbers: the soak results, the D21 check, the install from the GitHub Release, and a clean-account install.

## Working rules

- A number goes into the draft only after it is in [evidence.md](evidence.md) with its conditions.
- Hosted measurements and the experiment run on the target machine only, never on the preparing machine.
- Recheck [research.md](research.md) against DEV's current guidelines before publishing.
