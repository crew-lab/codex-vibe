# Development strategy

How vibe-supervisor is developed and released from 2.0 on. [Handoff.md](../Handoff.md) holds the current status; this page holds the rules and the road ahead.

## Direction

vibe-supervisor is one thing: a local MCP server that lets Codex delegate one bounded review or one isolated edit to Mistral Vibe, as a client of Vibe's `vibe-app-server` protocol ([ADR 0004](adr/0004-app-server-client.md)). The five MCP tools and the boundaries in [AGENTS.md](../AGENTS.md) are fixed. Work goes into making that one path correct, observable and verified, not into new surfaces.

- **One engine.** No second backend, selector or fallback. A future Vibe engine is supported by moving this client, not by adding another.
- **One Vibe version.** Each release pins exactly one Vibe release. A new Vibe release is a new supervisor candidate.
- **One supported line.** Only the latest 2.x release is supported. 1.0.0 was the last 1.x release; 1.0.1 was never released and there is no 1.x maintenance line.
- **Enforcement the supervisor owns.** The client decides every approval, reads the effective configuration back before the first turn, and fails closed on anything it cannot account for. It never imports or patches Vibe.

## Releases

| Release | Content | Gate |
| --- | --- | --- |
| 2.0.0 | The app-server engine; legacy engine removed; handoff re-validation, effect-bound approvals, the review file listing | Every gate in [acceptance.json](acceptance.json) verified on the target machine; frozen archive; owner's publish authorization |
| 2.0.1 | Only 2.0 remains: no other supervisor or Vibe version is described or accepted, and the development history leaves the tree | 2.0.0 published and its target evidence summarized in `acceptance.json` |
| Next Vibe release | A new candidate pinned to it | Conformance check, one review and one edit on the target |

**2.0.0, from the preparing machine:** apply the cold review, set release wording and the changelog, bump the version in `package.json`, `package-lock.json` and `.codex-plugin/plugin.json` together, record `npm run verify:release` on Node 20.19.0, merge to main, and package with `npm run package:rc` and a populated npm cache. **From the target machine:** the [compatibility](compatibility.md#unverified-gates) gates, through the target brief and `scripts/v2-conformance-check.mjs`, each with the owner's authorization; then a clean-account installation.

**2.0.1, in order:**
1. Move first what the code and docs rely on: the Vibe tag commit and source hashes into `compatibility.md`, the evidence placeholders into AGENTS.md, the disconnect procedure next to its scripts, and the 2.0.0 target results into `acceptance.json`.
2. Remove `docs/history/`, `docs/reviews/`, ADR 0003, the historical acceptance sections, the 1.x upgrade notes, every changelog entry before 2.0.0, saved-1.x-record handling, and every reference to the legacy engine, release candidates or earlier versions in code, tests, scripts, the skill and docs. Git history keeps all of it.
3. Rename the `v1-*` scripts and tests.
4. Owner: delete the stale remote branches. `codex/unified-harness-v2` goes last, after its remaining ideas below are ported.

**After 2.0.1**, each with a precondition:
- **A shipped root of trust:** a pin manifest derived from the published Vibe wheel, so the pin no longer trusts the first manifest generated on the target. Needs the owner's authorization to download the wheel.
- **Search for reviews:** a supervisor-owned, read-only search tool exposed to Vibe over MCP. Only after real runs confirm how MCP tools appear on the server.
- **Ceilings in the run record:** `limits.max_tokens` and `limits.max_cost_usd` saved per run.
- **Fixes from target evidence:** unknown history entry kinds, the effect of thinking off, the experiments fetch, nested `run_typescript` shapes.

## Working rules

- **Verification is local.** There is no GitHub CI: the token's `workflow` scope was skipped. Every change ends with `npm run verify:release`; a release adds `npm run package:rc` with a populated cache and Node 20.19.0.
- **Vibe is never run on the preparing machine.** Questions about Vibe are answered from its tagged source; behaviour is proven only on the target machine, with the owner's authorization and budget.
- **Fakes prove the client, not Vibe.** The scripted fake server encodes facts read from the Vibe source. A gate is verified only by target evidence.
- **Agents work in parallel on disjoint files.** Each agent owns named files, commits nothing, and reports what it could not verify. The coordinator runs the full checks before every commit, and nothing is committed while a check fails.
- **Branches.** Work happens on a branch and reaches main by merge after the full checks and a cold review. Push with `make push` (main) or `make push-branch BRANCH=<name>`.
- **No credentials** in any committed file, prompt, transcript or report. Evidence uses placeholders from the start.
