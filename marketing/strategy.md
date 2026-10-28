# Marketing strategy

Rewritten 2026-10-28 for the owner, replacing the 2026-10-14 plan. This directory is outside the package `files`, so nothing here ships. Claims about the tool come from the repository as of this date (README, Handoff, the [development strategy](../planning/development-strategy.md), [security](../docs/security.md), [compatibility](../docs/compatibility-v3.md), the [2.2.0 evidence](../research/evidence/v2.2.0-local-workflow-20261027/README.md) and the 2026-10-28 re-pin assessment under `research/`). External facts (star counts, maintainer response rates, channel rules) were last checked read-only on 2026-10-14 and are not rechecked here; the [interest note](interest.md) keeps them with their dates. Nothing has been posted, submitted or sent.

## 1. Where the product is, in marketing terms

- **One user.** The owner. v2.2.0 is a pre-release after two accepted native fixture trials (one edit, one review) on archive `6b0a120d…` with Vibe 3.0.2 under Node 24.21.0; the owner decided to mark it latest without a clean-account install. The one attempt at real work was refused on a grant mismatch before any model turn. There are no users beyond the owner and no partnerships.
- **Two claims with different evidence.** The *supervision* claim (deny by default, read-back before any turn, effects matched to approvals, pin drift fails closed, interrupted runs never replay) has held on every target sitting since 2.0.1 and in both 2.2.0 trials. The *usefulness* claim (Codex gets a better answer by delegating) has no real-use data: the 2.0.1 review reversed two of five cases and its edit missed its contract; the 2.1.0 fixture edit and both 2.2.0 trials were accepted. Mixed, and a pattern rather than a rate. Marketing must never let the evidenced claim carry the unevidenced one.
- **A steep install.** macOS Apple silicon; Node 20.19 or later; `uv tool install mistral-vibe==3.0.2` exactly; a pin manifest generated on the same machine; a version-matched `prepare check`; a hand-assembled single-use grant per start (the friction fix is Direction step 4). Every requirement is a reason the tool is trustworthy and a reason a stranger will not finish installing it.
- **A fast-moving dependency.** The 3.0.3 release followed 3.0.2 by four days and renamed the edit tool on the approval wire without a changelog line; `initialize` still carries no protocol version; the server refreshes an organization-managed configuration whenever a provider key is present. The supervisor stays on 3.0.2 and re-pins on a trigger (D6). Any public text that implies "works with Vibe" without the exact version is wrong the week after it is posted.
- **Antigravity is frozen** (D5). No Antigravity audience, forum reply or install note exists in this plan.

## 2. Audience

**Who can install it today:** a developer who works inside OpenAI Codex, has a Mistral account, runs macOS on Apple silicon, and wants a second opinion from another model family on one file or one small change without letting the second agent touch the checkout. This set is small, and the install cuts it further. It is the only audience the tool itself can serve, and it is not yet worth paying to reach: the owner has not finished being that user.

**Who can read it today:** engineers building any agent-to-agent delegation who want a worked example of making it checkable: what a headless client of a coding agent must declare, deny and read back, and what failed when it did not. This audience is larger, does not need to install anything, and the material for it (enforcement points, lessons, the source-read protocol facts) is already evidenced. It is the audience of the one write-up this plan allows.

**Who is not an audience yet:** security-minded teams. A team adopts a tool with a maintenance commitment, a threat model it can map to its own, and a cadence it can follow; a single-owner tool with a four-day-cadence dependency and documented mixed answers is not that. The security community can be a *reader* of the pattern later (section 6, step 8), not a buyer.

**"Reference implementation of a safety-first supervisor pattern"** is not a credible phrase yet and is retired from every asset. "Reference" implies that others refer to it; none do. The honest phrase is "a worked example, with its enforcement points named and its failures listed". The supervision evidence supports that much; the usefulness evidence supports nothing more.

## 3. What is said, and how

**One-sentence description.** vibe-supervisor is a local MCP server through which Codex delegates one bounded code review or one isolated edit to Mistral Vibe 3.0.2 and gets back something it can verify: a read-only review, or a patch from a detached worktree that is never applied. An independent project, not affiliated with Mistral AI or OpenAI.

**What is distinctive and evidenced.** The client owns every approval and denies by default; the effective configuration is read back before any turn; every executed effect must match an approval by fingerprint; an unknown event kind or a watermark gap fails the run; a pin mismatch fails closed before spawn; an interrupted run fails and is never replayed; every start needs a single-use grant bound to the exact request ([enforcement points](../docs/security.md#enforcement-points)). Each of these has a target observation behind it.

**What is said about limits, in the same paragraph.** Application policy, not an operating-system sandbox; the worker runs as you and what it reads goes to Mistral; the model's tool catalogue still lists refused tools; the validator is detective for anything already executed; the pin covers only Vibe's own `RECORD`; reviews have no search tool; answer quality is mixed and not a supervisor gate; macOS Apple silicon only; Vibe 3.0.2 exactly; one run at a time; no replay.

**Wording rules.** Kept from the 2026-10-14 plan: a number appears only with its conditions (build, Vibe version, runtime, date); unknown model and cost fields are disclosed as unknown; a rejected run is reported as plainly as an accepted one; "the first" is never written as a claim; "sandbox" appears only inside the qualifier "not an operating-system sandbox"; one factual AI-assisted disclosure sentence, up front, every time: "Built largely by orchestrated AI agents (Claude and Codex) under a human owner who set scope, read every cold review and authorized every hosted run and release"; the independence line in every public asset; no vendor logos; product names used descriptively, never as a brand; the "Friendly Fire" result cited only as a class of failure the worker cannot reproduce because it has no shell and no network, never as "immune".

Proposed additions, each an owner decision (section 7): "reference implementation" is not written; supervision claims and usefulness claims are stated separately, each with its own evidence, and neither implies the other; another Vibe release is named by number only ("the 3.0.3 release"), so that no draft pasted into a scanned document reads as support for a version other than 3.0.2.

## 4. Channels

| Channel | Verdict now | Why |
|---|---|---|
| The repository itself: description, topics, README first screen, release page | Now | Free, owner-only, and the landing page for every later signal. The README's opening still describes 2.2.0 as unreleased and 2.1.1 as being qualified; a stranger who arrives from a Mistral issue reads that first |
| Mistral's issue tracker (Bug Report form) and `security@mistral.ai` | Now, as asks rather than marketing | The only channel with recorded maintainer replies (issues, not Discussions); the asks protect the dependency and cost Mistral nothing |
| dev.to, one piece, AI-Assisted label | After the ten real starts | The content exists; the limits paragraph needs a measured number instead of "mixed". DEV's AI-assisted guidelines forbid promoting one's own program, so the piece is integration notes with the tool as the example |
| Mistral GitHub Discussions (Ideas) | After the write-up | One contributor reply in roughly ten on the 2026-10-14 sample; worth one post that links a document, not five questions on their own |
| GitHub topics, a pinned "second user wanted" issue | With the write-up | The cheapest funnel a single-owner tool has |
| MCP registry, MCPB bundle, Codex plugin or marketplace, awesome lists | Waits for a second user | A listing sends installs to a tool that needs uv, an exact pin, a manifest and a hand-assembled grant; failed installs become issues that cost owner time. The development strategy already rejects the packaging until a second user asks |
| Show HN, Reddit, LinkedIn, X, newsletters | Waits for a second user and a stranger-installable release | Show HN wants a project people can try; nobody can try this without a Mistral account, Apple silicon and the install above |
| Security community (OWASP agent-control limits table, SAFE-MCP, MCP Security IG) | After the write-up, owner-decided | A limits table is something the project does well, but it needs the write-up to point at and at least the ten-start numbers |
| Talks, portfolio page, case study | Cut | No confirmed company site or audience; CFP cycles outlast the plan's horizon |
| Mistral ambassador program, partner form, Codex open source fund | Cut for now | Each needs an advocacy or usage record that does not exist |
| Antigravity forum and install note | Cut | Frozen (D5) |
| Multica, Paperclip and ACP thread comments | Deferred | The drafts cite removed surfaces; the issues had no activity for months on 2026-10-14; a comment there is a stranger's first contact with a tool whose README is stale |

## 5. Mistral

Mistral is a dependency to protect before it is a partner to court. Concrete evidence as of 2026-10-28: `initialize` carries no protocol-version field (unchanged through the 3.0.3 release); 3.0.0 removed three app-server RPCs; the 3.0.3 release renamed `file_system.search_replace` to `file_system.edit` on the approval wire and changed its input shape, with no changelog line; the server refreshes an organization-managed configuration whenever a provider key is present, which the supervisor answers with an owned loopback endpoint ([ADR 0005](../docs/adr/0005-target-conformance-repairs.md)).

**The ask ladder, reordered.** Each rung is asked only after the one below it has an answer or has been tried.

1. **Private note first, if anything reproduces.** The three 2.26.1-era candidates (a client that omits `approval` from `callbackKinds` crashes the server on its first approval; untrusted `workspaceRoots` still load project state; `self.sleep` and `subagent.*` run without a callback) were read from the 2.26.1 source and have not been re-read against the 3.0.2 basis. An agent re-reads them at tag `v3.0.2` with hashes; whatever still reproduces goes in one short note to `security@mistral.ai`, asking whether any item should stay out of a public issue. Owner sends; then a reply or two weeks. If nothing reproduces, the rung is skipped and recorded as such.
2. **Bug reports, in the form's fields, filed by the owner.** (a) `initialize` carries no protocol-version field while ADR 0009 says it does, if that ADR text still stands at the 3.0.2 tag; (b) the 3.0.3 edit-tool rename and input change on the approval wire are absent from the changelog, with the request that wire-visible renames and removals be listed per release; (c) `callback/respond` in ADR 0009 versus `callback/result` in the code, if still present at the 3.0.2 tag. Each carries the file, the hash and "corrections welcome". These are documentation mismatches, public by Mistral's own rule.
3. **A stability statement**, asked as one Discussion after the write-up exists: is `vibe-app-server` supported for third-party clients; will `initialize` carry a version; is the managed-configuration refresh documented for embedders and switchable. Offered in return: the no-inference conformance script as a per-release check they can run, and the write-up as the integration note. The earlier feature questions (catalogue narrowing, a search or listing builtin, omitting reasoning, budget enforcement) go in the same post as a short list, not as separate threads.
4. **A mention** (a README line or a pinned Show and tell) only after rung 3 has any reply.
5. **A named contact and co-marketing** are off the ladder until the tool has a second user and a usefulness log worth showing.

Tone throughout: contribution, not critique. "A headless client must declare, deny and read back", never "Vibe does not enforce". No claim about Mistral's intentions beyond what an ADR says. The independence line in every post.

## 6. Next actions, in order

Who acts: the owner for anything public, agents only draft. The gate is what must be true before the step starts; the measure is how the step is judged.

1. **Correct the public surface.** Agents draft the README opening (current release and its state, who it is for and not for, the limits paragraph, the independence line) and the repository description and topics; the owner applies them and marks v2.2.0 latest (D2). Gate: none. Measure: README and release page name the same version and state; topics set.
2. **Mistral, private first.** An agent re-reads the three security candidates against the 3.0.2 basis and drafts the note; the owner sends it. Gate: the re-read done, with hashes. Measure: an acknowledgement, or two weeks elapsed, recorded in Handoff.
3. **Mistral bug reports.** An agent drafts the three reports in the form's fields; the owner files them. Gate: step 2's wait. Measure: one maintainer reply or label within 30 days; this is the single most valuable external signal in the plan, because it says whether the boundary the product depends on has an owner who answers.
4. **Ten real starts** (Direction step 3, D3 accepted). The owner uses; the target agent records each start's export, `runs usefulness` entry and failure. Gate: the hosted allowance; the friction fix (Direction step 4) first if it lands in time, since the one real attempt was refused on a grant mismatch. Measure: ten logged starts with acceptance, stop reason and estimated cost.
5. **Decide what there is to market.** The owner reads the log and chooses the write-up's centre: the tool (if the log shows Codex getting usable answers) or the pattern and its limits (if it does not). Gate: step 4. Measure: the decision recorded in Handoff with the counts behind it.
6. **One write-up.** "What a headless client must declare, deny and read back": integration notes with the tool as the example, the ten-start counts in the limits paragraph with their conditions, the disclosure sentence, the independence line, published on dev.to with the AI-Assisted label. An agent re-bases the existing [draft](article/devto-2.0.md) on 2.2.0 and Vibe 3.0.2 (its 2.26.1 facts and test counts are stale) and fills the markers from recorded evidence; the owner reads it in their own voice and publishes. Gate: steps 1, 3 and 5; a `verify:release` count from the release commit for any test number. Measure: one technical comment or one issue from a stranger within 30 days.
7. **Point the asks at it.** The owner posts the stability Discussion (rung 3) and pins a "second user wanted" issue that asks who runs a different coordinator or worker and would try the same contract. Gate: step 6 live with no correction pending. Measure: one maintainer reply; one install report that names its machine and Vibe version.
8. **Everything else waits for a second user.** Registry and MCPB, the Codex plugin, awesome lists, Show HN, Reddit, LinkedIn, newsletters, the security-community limits table, the ACP and orchestrator comments, the ambassador application, the Codex fund. Trigger: an issue from a stranger asking for one of them, or the owner's reading of the ten-start log. Measure: none until triggered.

## 7. Owner decisions

| # | Decision | Recommendation |
|---|---|---|
| M1 | Retire the 2026-10-14 launch calendar, the 90-day metrics table (50 to 150 stars, 100 downloads, 1,000 reads) and the blog series, talk abstracts and portfolio page | Yes. None of them can be met or measured by a tool with one user, and each was a draft that rots |
| M2 | Narrow the audience statement: installers are Codex users with a Mistral account on Apple silicon; readers are engineers building delegation; security-minded teams are dropped as an audience; "reference implementation" is retired | Yes. The supervision evidence supports a worked example, not a reference |
| M3 | Nothing public before the ten real starts are logged, except step 1 (repository correctness) and steps 2 and 3 (Mistral asks) | Yes. The write-up's content does not depend on the starts, but its limits paragraph does, and a tool article that says "not yet used on real work" is weaker than one with ten counted rows |
| M4 | First contact with Mistral is the private note and the three bug reports, not the five-question Discussion | Yes. Issues got replies in the 2026-10-14 sample; Discussions mostly did not; and two of the three items carry fresh 3.0.x evidence |
| M5 | Defer every listing and every broadcast channel until a second user asks | Yes. It matches the development strategy's rejected list and avoids installs that fail into issues |
| M6 | Add the three wording rules in section 3 | Yes. Each closes a claim the project cannot support |

## 8. What stops

- Refreshing external facts weekly, maintaining a launch calendar, and writing or updating drafts for channels that are deferred (Show HN comment, Reddit and LinkedIn posts, Multica and Paperclip comments, the registry entry, the Antigravity forum reply, talk abstracts).
- The five-piece blog series. One write-up, after the ten starts.
- Claims: "reference implementation"; "safety-first" as an adjective without the list behind it; any Codex-plus-Vibe audience size; any usefulness rate before `runs usefulness` has ten real rows; anything about a Vibe release other than 3.0.2 beyond what `research/` records; anything about Antigravity.
- Demo recordings and a social preview image before usefulness is shown; both would record the fixture trials, which prove the supervisor and nothing else.
- Treating stars as a target. They are reported in Handoff when they change, not pursued.

## 9. Success measures

Four signals, each binary, fit a single-owner tool:

1. The usefulness log has ten real rows with acceptance, stop reason and estimated cost, and the owner has stated what they show.
2. One maintainer reply or label from Mistral on a filed issue.
3. One issue, discussion or pull request from someone who is not the owner or an agent.
4. One install report from another machine that names its Vibe version and its `prepare check` result.

Reported, not targeted: stars, forks, release downloads, article reads. The 2026-10-14 baseline was 0 stars and 0 forks; it has not been rechecked.

## 10. Risks and guardrails

- **Mistral's protocol.** Promise support only for the exact pin; present the pin and the fail-closed drift check as the feature; ask the stability question (rung 3) before saying anything about the future; name another release by number only.
- **Codex.** "MCP server, used from Codex"; readiness proves the catalogue on the live connection; no other client is claimed.
- **Security claims.** Every public sentence about safety carries its qualifier (section 3). Never "secure" without saying against what.
- **Trademark and naming.** The repository stays `codex-vibe` (owner, 2026-10-19); product names are descriptive; no logos; the owner reads both vendors' brand pages before the write-up goes out (OpenAI's returned HTTP 403 on 2026-10-14).
- **AI-assistance disclosure.** One factual sentence, the platform's label where one exists, the owner's own voice in the write-up; never overclaim the human share.
- **Private data.** No credential, receipt, reasoning, session history, machine path or private project name in any asset; the placeholders in AGENTS.md apply to every quoted evidence file.
- **Drafts that rot.** A draft older than the release it describes is re-based or deleted before anything is sent; the article draft currently names the superseded Vibe release and a test count from an earlier commit.
