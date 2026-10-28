# Who might care, and what to ask them

Rewritten 2026-10-28 for the owner, to match the [marketing strategy](strategy.md) of the same date. Research and drafts only: nothing has been posted, sent, submitted or applied for, and the owner sends everything personally. Outside the package `files`, so nothing ships.

Tags: **[V]** read on the party's own page, repository or API on 2026-10-14 and not rechecked since; **[T]** third party; **[I]** inference; **[U]** not found. Only public professional information from official sources was used; no private contact details, no personal profiles. Counts and response rates move; recheck a number before quoting it.

## 1. Mistral

Mistral is the dependency the product cannot replace: a source review on 2026-10-27 found no more stable integration surface than `vibe-app-server` (ACP runs the same server with fewer controls, `vibe -p` denies every approval itself, the agent socket and `run-server` are hidden). The asks below protect that dependency first; a partnership, if ever, comes after a second user exists.

### What Mistral gets from this project

- **A documented third-party client of `vibe-app-server`.** Every wire fact was read from the tagged source with recorded hashes ([3.0.2 basis](../docs/compatibility-v3.md), the 2026-10-28 re-pin assessment under `research/`). ADR 0009 makes the typed JSON-RPC protocol the boundary for every surface and the README names Le Chat Desktop as an embedder, so the protocol has first-party clients; ours is one they did not write, exercising the subset a headless supervisor needs [V, read at `v2.26.1`; the ADR text is to be re-read at `v3.0.2` before it is quoted].
- **Release-to-release wire observations.** The 3.0.3 release renamed `file_system.search_replace` to `file_system.edit` on the approval wire and changed its input from a batch to one flat change, with no changelog line; `initialize` still carries no protocol-version field; 3.0.0 removed three app-server RPCs. A client that pins by hash notices these the day they ship, which is worth something to a team shipping every few days.
- **Doc-versus-code mismatches with file and hash.** From the 2.26.1 audit, to be re-read at `v3.0.2`: the `initialize` result carries no protocol version although ADR 0009 says it does; ADR 0009 names `callback/respond` while the code accepts `callback/result`; a pending approval never times out; `maxPrice` and `maxSessionTokens` are ignored by the Unified server; `config/effective/read` omits `max_turns`.
- **A delegation pattern that spends Mistral credits from inside Codex.** Client-owned deny-by-default approvals, a startup read-back, effect-bound approvals and a fail-closed pin: a worked example other embedders can copy ([security](../docs/security.md#enforcement-points)) [I].

### Why Mistral might not care, or object

- The audience is one user; the repository had 0 stars and 0 forks on 2026-10-14 [V]. The team says it is "iterating quickly" and "not accepting code contributions at the moment"; it asks for bug reports, feedback and documentation fixes [V, [CONTRIBUTING](https://github.com/mistralai/mistral-vibe/blob/main/CONTRIBUTING.md)]. Bug reports are therefore the fitting ask.
- Findings presented as "what Vibe cannot do" read as critique; presented as "what a client must supply", they read as integration notes, which is also the true reading.
- Mistral has its own surfaces on the same protocol (two TUIs, ACP, Le Chat Desktop, Vibe Code Web, a VS Code extension) [V]. A supervisor is not a competitor, but a Codex-first tool is not a priority either.
- Stability is not promised to outsiders: no official page names `vibe-app-server` as a supported third-party boundary [U]; ADR 0014's compatibility policy covers API-backend and harness-runtime skew, not wire clients [V]; the hidden `--agent-socket` "may change or go away without notice" [V].

### Mistral's channels, as of 2026-10-14

| Channel | Verified facts | Fit |
|---|---|---|
| `mistralai/mistral-vibe` | Apache-2.0; 5,119 stars, 738 forks, 404 open issues and PRs, 212 discussions. CODEOWNERS `@mistralai/eng-vibe-code-cli`. Blank issues disabled; one Bug Report form (Component, Summary, Reproduction steps, Versions / environment, Logs & screenshots); the chooser sends feature requests to Discussions "Ideas" and questions to Discord [V] | The Bug Report form for doc-versus-code mismatches; Ideas for the one stability post |
| Maintainer engagement | 12 of the 100 most recently updated issues got a contributor's comment, half within 4 days, the rest in 14 to 86 days. On the 60 most recently updated discussions, 3 of 49 comments came from contributors and none from an org member (membership may be hidden) [V] | Issues get answers; Discussions mostly do not. Expect one reply in ten |
| Discord | The official server, linked from the issue chooser and the docs footer [V] | Informal; a reply there is unquotable |
| Security | Private reports to `security@mistral.ai`; "do not disclose vulnerability details in public GitHub issues, discussions, or pull requests before coordinating"; a HackerOne program [V, [SECURITY.md](https://github.com/mistralai/mistral-vibe/blob/main/SECURITY.md)] | Rung 1 |
| Ambassador program, partner form, startup program, hackathons, community showcase | Rolling ambassador applications needing prior advocacy and a six-month commitment; a partner form that "can't respond to every submission"; no official startup page found; no current hackathon; no "built with Mistral" page [V, T, U] | Off the ladder until a second user and a usefulness log exist |
| Brand | "Partners and collaborators are welcome to use our brand"; marks "are the property of Mistral"; no rule on third-party product names [V, [page](https://mistral.ai/brand)] | Section 3 |

### The ask ladder

Each rung is asked only after the one below it has an answer or has been tried. The strategy's [section 5](strategy.md#5-mistral) holds the reasoning; this is the list.

| Rung | Ask | What we offer | Who, when |
|---|---|---|---|
| 1 | A private note to `security@mistral.ai` with whichever of the three 2.26.1-era candidates (the `callbackKinds` crash, untrusted `workspaceRoots` loading project state, `self.sleep` and `subagent.*` without a callback) still reproduces at `v3.0.2`, asking whether any should stay out of a public issue | Files and hashes; a reply or two weeks before anything public | Agent re-reads and drafts; owner sends; now |
| 2 | Three Bug Reports: no protocol-version field in `initialize` versus ADR 0009; the 3.0.3 wire rename absent from the changelog, with a request that wire-visible renames and removals be listed per release; `callback/respond` versus `callback/result` | Reproduction from the tagged source; the conformance script's handshake output from the target | Agent drafts in the form's fields; owner files; after rung 1's wait |
| 3 | One Ideas post: is the protocol supported for third-party clients; will `initialize` carry a version; is the managed-configuration refresh documented for embedders and switchable; and, as a short list, catalogue narrowing, a read-only search or listing builtin, omitting reasoning from the store, budget enforcement | `scripts/v2-conformance-check.mjs` as a per-release check they can run; the write-up as a client-side integration note | Owner posts; after the write-up |
| 4 | A mention: a README line or a pinned Show and tell | The integration note | Owner; after any reply on rung 3 |
| 5 | A named contact or co-marketing | Early reports on each release's wire changes; a usefulness log | Off the ladder until a second user exists |

Expectation [I]: rung 1 may be empty after the re-read, which is recorded rather than skipped silently; rung 2 is the only rung with evidence of maintainers answering; rung 3 is unlikely to get a reply before a published SDK; rungs 4 and 5 are not planned for.

## 2. Other parties

All of these wait for the write-up or for a second user (strategy, steps 7 and 8). Kept here so the facts are not re-researched when the trigger arrives.

| Party | Why they might care | Channel and facts [as of 2026-10-14] | Waits for |
|---|---|---|---|
| **OpenAI Codex** | An MCP server used from Codex | Plugins: a root `plugin.json` with `extensions.com.openai`; public directory submission needs a remote HTTPS endpoint, local servers "follow a separate desktop-only path" [V, [build](https://developers.openai.com/codex/plugins/build)]. Open source fund: grants up to $25,000 in API credits, rolling [V] | A second user (plugin); a stranger-installable release and a usefulness log (fund) |
| **MCP registry and community** | A stdio server with an unusual contract | Registry v1.8.1, preview; MCPB bundle on a GitHub release with `fileSha256`; the contributor Discord discourages "service or product marketing" [V]; `punkpeye/awesome-mcp-servers` takes a one-line PR [V] | A second user asking for a listing |
| **Zed and ACP** | Vibe is in the ACP registry; we are not an agent, so no listing [V]. Discussion 2125 on refusal provenance and bounded `allow_always` was open with no comments [V] | The ACP org Discussions | The write-up, as one data-point comment |
| **Agent-orchestration projects** | Open Vibe-support requests with nothing behind them: Multica #3513, Paperclip #161 and #7828, inactive for months [V] | Those issues | A second user; the old comment drafts cite removed surfaces and are not to be sent |
| **Security-minded communities** | A running example of a separate guardian deciding before an action happens | OWASP GenAI Agent Control Standard asks for a second implementation "with the same kind of table" of limits [V, [repo](https://github.com/GenAI-Security-Project/agent-control-standard)]; OpenSSF SAFE-MCP SIG; the MCP Security IG [V] | The write-up and the ten-start numbers; owner-decided |
| **Newsletters and press** | MCP digests take practitioner pieces | Glama's weekly MCP newsletter accepts contributions with product mentions when the piece has value [V]; PulseMCP's submission status [U] | The write-up live for a month without a correction |
| **Workshops** | Agent-to-agent protocol security is a listed topic | AGENT-SEC 2026 at ACM CCS (deadline passed); the 2027 cycle unannounced [U] | Cut from the plan; revisit only with a usefulness log |
| **Google Antigravity** | Was a candidate second MCP client | Frozen (D5); see the [research](../research/antigravity-2026-10-14.md) | Not planned |
| **The owner's company network** | A portfolio piece | `createglobal.pro` had no A record on 2026-10-14 [V, DNS] | Cut; nothing to confirm |

## 3. Guardrails

- **No affiliation claims.** The independence line ("an independent project, not affiliated with Mistral AI or OpenAI") in every post; "for Codex" and "a client of Vibe's app-server" as descriptions, never as endorsements; no vendor logos.
- **Naming.** The repository stays `codex-vibe` (owner, 2026-10-19). Mistral's brand page sets no rule for third-party product names, so the package name stays descriptive and lowercase [V]. OpenAI's brand page returned HTTP 403 [U]; the owner reads it before anything is posted.
- **Responsible disclosure.** Anything possibly security-related goes privately to `security@mistral.ai` before any public issue [V]. None of the three candidates is a vulnerability in Vibe's threat model as we read it (the client is trusted in all three), so the note asks rather than reports. Documentation mismatches are public.
- **Tone.** Contribution, not critique: "a headless client must declare, deny and read back", not "Vibe does not enforce". Each finding carries its file and hash and "corrections welcome". No claim about Mistral's intentions beyond what an ADR says.
- **Version naming.** Vibe 3.0.2 is the only release named with the product name; another release is "the 3.0.3 release".
- **Not shared.** Credentials, session histories, account identifiers, readiness receipts, reasoning, unredacted target evidence (the placeholders in AGENTS.md apply), machine paths, the private project name, cost figures without conditions, any number not in a recorded evidence file.
- **Measuring interest.** The strategy's [four signals](strategy.md#9-success-measures): ten logged real starts, one Mistral reply on an issue, one issue or PR from a stranger, one install report from another machine. Replies are logged by role and days to first reply; stars are reported, not targeted.

## 4. Next actions

The sequence is the strategy's [ordered list](strategy.md#6-next-actions-in-order). The Mistral-specific pieces an agent can draft now, each for the owner to read and send: the re-read of the three security candidates at `v3.0.2` with hashes; the private note; the three Bug Reports in the form's fields; and, later, the one Ideas post. Nothing is scheduled or automated.

## Sources checked on 2026-10-14, and what could not be verified

Read-only, by GitHub API or page fetch: `mistralai/mistral-vibe` (metadata, CONTRIBUTING, SECURITY, CODEOWNERS, templates, the 60 most recently updated discussions and 100 issues, contributors, ADRs 0009, 0011, 0014 and 0016, README and CHANGELOG at `v2.26.1`); the Mistral ambassador, partners, brand, hackathon and docs pages and `security.txt`; the Codex plugin build page and open-source-fund doc; the MCP communication page, registry and `mcpb` releases; the ACP registry and discussions 928 and 2125; Multica #3513, Paperclip #161 and #7828; the OWASP ACS and OpenSSF AI/ML repositories; Glama's newsletter page; the AGENT-SEC 2026 page; the awesome-mcp-servers CONTRIBUTING; DNS for `createglobal.pro`. The 3.0.2 and 3.0.3 wire facts come from the tagged source read on 2026-10-27 and 2026-10-28 (the re-pin assessment under `research/`).

Not verified: anything on this page after 2026-10-14 except the tagged-source facts above; an official Mistral startup program page; Mistral's stance on third-party app-server clients (unstated anywhere read); whether org members' comments on the Vibe repository hide behind `NONE` associations; OpenAI's brand page (HTTP 403); PulseMCP's current submission status; the 2027 workshop cycle; anything about the owner's company beyond DNS; the Codex plugin directory process beyond the build page's sentences.
