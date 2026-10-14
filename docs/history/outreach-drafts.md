# Outreach drafts (vibe-supervisor)

Drafts only. Nothing here has been posted, filed, or submitted.

Facts checked read-only on 2026-10-14: Vibe v2.26.1 is still the latest Vibe release (2026-10-09);
Multica issue 3513 is open with 0 comments; the MCP registry is in preview (latest registry release v1.8.1).

---

## 1. Mistral Vibe: GitHub Discussion (Ideas category), not an issue

Where and when: github.com/mistralai/mistral-vibe, Discussions, category Ideas (`discussions/new?category=ideas`).
The repo disables blank issues; the only issue form is "Bug Report", and `CONTRIBUTING.md` and `config.yml` send feature
requests and feedback to the Ideas discussion form (fields: Component, Problem statement, Proposed solution, Additional context).
A Q&A category also exists. Post the same day as the Show HN, or earlier: the answers shape the 1.1 plan.

Title: `[Feature Request]: Third-party clients of vibe-app-server: protocol stability, tool enforcement, legacy harness removal`

Component: `CLI`

Problem statement

I maintain vibe-supervisor (MIT), a local MCP server that lets Codex delegate one bounded review or one isolated edit to `vibe -p`. It pins Vibe 2.26.1 and forces `--legacy-harness`. Thank you for documenting `--output-dir`, `--time-limit` and the exit codes. ADR 0009 makes `vibe.app_server` the boundary every surface uses, so I plan to move the supervisor from `vibe -p --legacy-harness` to being a client of `vibe-app-server` over stdio, and have five questions.

Proposed solution

1. Is the `vibe-app-server` JSON-RPC protocol supported for third-party clients, and is it versioned so a client can check compatibility before starting a session?
2. `--legacy-harness` is described as a temporary escape hatch kept until the legacy runtime is removed. Is there a planned removal timeline, and will there be a deprecation period?
3. On the legacy path, does `export.json` from `--output-dir` fill `usage` and `cost_usd`? The README documents both and the schema allows null; I have not yet observed a legacy run's export.
4. On the Unified Harness, reading the 2.26.1 source, `enabled_tools` denies tools at execution but the catalogue the model sees still lists `write_file`, `edit`, the shell tool and `run_typescript`, and there is no `grep` builtin. Is there a supported way for a client to narrow the catalogue itself, to disable subagents, background processes, managed shell, plugins and skills for a session, and to keep reasoning out of the session store?
5. Is the headless contract (exit codes, outcomes, `export.json` `schema_version` 1) considered stable across releases?

Additional context

vibe-supervisor: https://github.com/crew-lab/codex-vibe (release v1.0.0). It returns a patch that is never applied, runs with shell and network tools off, and refuses any Vibe version other than the pinned one. It supports macOS Apple silicon only and is independent of Mistral AI. If useful, I can share its compatibility notes for the 2.26.1 legacy path as a reference for other programmatic consumers: https://github.com/crew-lab/codex-vibe/blob/v1.0.0/docs/compatibility.md

---

## 2. GitHub repository description and topics

Where and when: repo Settings, General (or `gh repo edit crew-lab/codex-vibe --description "..." --add-topic ...`). Do it now; it is wrong today and every other post links to the repo. Current value: "Codex ASP client for Mistral Vibe"; current topics: none.

Description (see character count below):

```
Local MCP server that lets Codex delegate one bounded review or one isolated edit to Mistral Vibe 2.26.1. Edits run in a detached Git worktree and return a patch that is never applied. Shell and network tools are off. macOS Apple silicon only. Application policy, not an OS sandbox.
```

Topics (9): `mcp`, `mcp-server`, `model-context-protocol`, `codex`, `mistral`, `mistral-vibe`, `code-review`, `git-worktree`, `coding-agents`

---

## 3. MCP registry entry (post after stable 1.0.1)

Where and when: official registry, via `mcp-publisher` (registry.modelcontextprotocol.io). Post after stable 1.0.1, and only after the blockers below.

Read from `modelcontextprotocol/registry` docs (`official-registry-requirements.md`, `package-types.mdx`, `authentication.mdx`, draft `server.schema.json`):

- The registry hosts metadata only. A package must be on npm, PyPI, NuGet, Cargo, OCI (Docker Hub, ghcr.io, Quay, and a few others), or be an MCPB bundle hosted on GitHub or GitLab releases. **A plain GitHub release tarball is not an accepted type.** The 1.0.0 asset `vibe-supervisor-1.0.0.tgz` is an `npm pack` tarball, so it does not qualify as is.
- npm would need `"private": true` removed and `mcpName` added to `package.json`, and an owner decision to publish (AGENTS.md says private and unpublished). Not recommended.
- The matching path is MCPB (`registryType: "mcpb"`): a `.mcpb` bundle (zip with `manifest.json`, spec 0.3, server type `node`, production `node_modules` included) attached to a GitHub release, URL containing "mcp" (the `.mcpb` extension satisfies it), plus `fileSha256`. Nothing in the repo builds a `.mcpb` today. Needed: a bundle build step, a manifest (with a user-config field for the `--config` path), a release asset, and a validation with `mcpb`/`mcp-publisher validate`. I did not verify the manifest details beyond the spec's basic example, so treat the bundle as unproven.
- The registry does not verify the hash; clients do.
- Name: GitHub authentication requires `io.github.<owner>/...`. The owner is the organization `crew-lab`, and an org namespace requires the publisher to be an **Owner** of the org (plain membership is not enough). Otherwise use the personal namespace.
- `description` is limited to 100 characters. The registry is marked preview.
- The package cannot install Vibe (`uv tool install mistral-vibe==2.26.1`) or sign in; the user does that first.

Draft `server.json` (version and URL assume a 1.0.1 release that also carries a `.mcpb` asset; the hash is a placeholder to compute with `openssl dgst -sha256 vibe-supervisor-1.0.1.mcpb`):

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.crew-lab/vibe-supervisor",
  "title": "Vibe Supervisor",
  "description": "Codex delegates one bounded review or isolated edit to Mistral Vibe; patch returned, never applied.",
  "repository": {
    "url": "https://github.com/crew-lab/codex-vibe",
    "source": "github"
  },
  "websiteUrl": "https://github.com/crew-lab/codex-vibe",
  "version": "1.0.1",
  "packages": [
    {
      "registryType": "mcpb",
      "identifier": "https://github.com/crew-lab/codex-vibe/releases/download/v1.0.1/vibe-supervisor-1.0.1.mcpb",
      "fileSha256": "REPLACE_WITH_SHA256_OF_THE_BUILT_MCPB",
      "transport": {
        "type": "stdio"
      }
    }
  ]
}
```

---

## 4. Multica issue 3513 comment

Where and when: https://github.com/multica-ai/multica/issues/3513 ("[Feature]: Add support for Mistral Vibe runtime", open, no comments, created 2026-05-29). Post any time after 1.0.0; no need to wait for 1.0.1. Do not copy Multica code into this MIT project.

```
Not a patch for this request, only a reference for whoever picks it up.

I maintain vibe-supervisor (MIT), an MCP server that lets Codex run one bounded review or edit through Vibe 2.26.1 headless (`vibe -p`). Two parts may help a safe adapter: the launcher, which gives each run a private HOME and VIBE_HOME, filters the child environment, passes the prompt by file instead of argv and resolves the credential (src/backends/runtime/vibe_supervisor_launcher.py), and the readiness contract, where a status call checks eligibility and issues a short-lived receipt before any run starts (docs/reference.md, "Workspace readiness").

Vibe's own README documents `--output-dir` (export.json with usage, cost and outcome) and exit codes 0 to 4.

One caution: Vibe's source calls `--legacy-harness` temporary, so pin the version and recheck after upgrades.

https://github.com/crew-lab/codex-vibe
```

---

## 5. Show HN

Where and when: news.ycombinator.com/submit, URL = the article once published (after stable 1.0.1, with the AI-assisted label), otherwise the repo. Same week as the Mistral discussion. Post the comment immediately after submitting.

Title (80 characters max): `Show HN: Eight checks for letting one coding agent delegate to another`

First comment:

```
Author here. I built a local MCP server that lets Codex hand one bounded review, or one edit in a throwaway Git worktree, to Mistral Vibe. The tool has a narrow audience; the checklist I ended up with should transfer:

1. A stop at a limit is neither success nor failure.
2. Check readiness on the live connection before every delegation; no silent substitute.
3. Worker output is an artifact you review, exported completely.
4. Your cleanup check must not share the exporter's blind spot (mine did, and could have removed a worktree holding an edit).
5. Count process claims, never believe them.
6. Interrupted runs are failed, never replayed.
7. Delete options no real run needs.
8. Agents sharing a repo fetch and check before fixing.

Limits: macOS Apple silicon only, Vibe 2.26.1 exactly (anything else fails closed), one run at a time. Not an OS sandbox: Vibe runs as you and what it reads goes to Mistral. Mistral's source calls the engine I use a temporary escape hatch, so an adapter is next. Answer quality is mixed: six real-project runs, three accepted, three not. Cost is not recorded yet.

What is missing from your setup?

https://github.com/crew-lab/codex-vibe
```
