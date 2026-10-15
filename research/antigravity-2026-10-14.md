# Google Antigravity and vibe-supervisor (2026-10-14)

Read-only research on 2026-10-14. Nothing was installed, run, signed up for or posted; every statement comes from a page fetched that day, cited with its URL and the page's own date where it shows one. This directory is outside the package `files`, so nothing here ships.

Tags: **[V]** read on a Google or protocol-owner page; **[T]** third party (press, forum, GitHub issue, Wikipedia); **[I]** our inference; **[U]** not found. A forum user `Ambati_Rajendra` recurs below; the pages show no staff badge, so those replies stay [T] even where other users call them staff answers.

The product under study is vibe-supervisor as it stands in this tree: five MCP tools, used from Codex, driving Vibe 2.26.1 through `vibe-app-server` ([ADR 0004](../docs/adr/0004-app-server-client.md)). [AGENTS.md](../AGENTS.md) and [Handoff.md](../Handoff.md#fixed-scope-and-safeguards) fix exactly five tools and "no ACP ... or new platform scope"; anything below that touches that line is marked as an owner decision.

## 1. What Antigravity is now

**A product family.** Google's site lists the app, extensions, CLI, IDE and SDK [V, antigravity.google]; an ACP server and a hosted agent in the Gemini API exist beside them.

| Surface | Version (date) | Notes |
|---|---|---|
| App (2.0 line) | v2.23.1 (2026-10-13) | Standalone desktop app, announced 2026-05-19 as the successor to the IDE's Agent Manager: "there is no IDE" [V, [2.0 post](https://antigravity.google/blog/introducing-google-antigravity-2/), [changelog](https://antigravity.google/docs/changelog/)] |
| CLI `agy` | v1.3.1 (2026-10-07) | Replaced Gemini CLI for consumers; third parties date Gemini CLI's shutdown to 2026-06-18 [V changelog; T [Wikipedia](https://en.wikipedia.org/wiki/Google_Antigravity)]. The GitHub repo `google-antigravity/antigravity-cli` shows a README, examples and 679 open issues, no source [V, fetched 2026-10-14] |
| IDE | v2.5.5 (2026-08-13) | The VS Code-derived editor, relaunched separately in 2026-05; "not supported for enterprise customers"; no Gemini 4 Argon [V, [IDE overview](https://antigravity.google/docs/ide/overview/)]. The announced removal of the Agent Manager from the IDE has no changelog entry as of 2026-10-13 [V] |
| IDE extensions | VS Code v1.7.0 (2026-10-05); Visual Studio, JetBrains 2026.2.1+, Zed 0.140+, Xcode | Shipped 2026-08-20, one sign-in across surfaces [V, [extensions](https://antigravity.google/docs/ide/extensions/)] |
| SDK | PyPI `google-antigravity` v0.1.21 (2026-10-05) | Apache-2.0 Python wrapper around "a compiled runtime binary" in the wheels; "Cloning this repository alone is not sufficient" [V, [repo](https://github.com/google-antigravity/antigravity-sdk-python)] |
| ACP server `antigravity-acp` | 1.4.0 | Google LLC, license `proprietary`, binary zips from `dl.google.com`, `./agy_acp_server.par`, no `sha256` in the entry; backs the Zed and JetBrains integrations [V, [registry JSON](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json), [Zed listing](https://zed.dev/acp/agent/antigravity-acp)] |
| Managed Agents (Gemini API) | `antigravity-preview-09-2026`, preview | Google-hosted Linux sandbox, remote MCP only, "Features and schemas may change" [V, [custom agents](https://ai.google.dev/gemini-api/docs/custom-agents), updated 2026-10-09] |

**Cadence.** About thirty app releases from v2.0.1 (2026-05-19) to v2.23.1; about forty CLI releases from v1.1.10 (2026-08-03) to v1.3.1; the SDK roughly weekly. Config paths moved meanwhile: `.gemini/skills/` to `.agents/skills/`, `url` to `serverUrl`, per-project config to `/.gemini/config.json` in app v2.17.0 [V changelog, [migration](https://antigravity.google/docs/cli/gcli-migration/)].

**Platforms.** macOS 12+ with Apple silicon and Intel downloads (the same page says x86 is not supported), Windows 10 64-bit, Linux glibc 2.28+, Googlebook [V, [getting started](https://antigravity.google/docs/getting-started)].

**Pricing and terms.** No Antigravity-only subscription: a free weekly quota, larger five-hourly quotas on Google AI Pro and Ultra, AI credits for overage, "Bring-your-own-key ... not supported" [V, [plans](https://antigravity.google/docs/plans/)]. Third-party prices: Pro $19.99, Ultra $99.99 (5x) and $199.99 (20x, cut from $249.99) [T, [CNBC 2026-07-22](https://www.cnbc.com/2026/07/22/google-earnings-q2-goog-live-updates.html), Wikipedia]. Enterprise: Gemini Enterprise seats ($10 Standard, $15 Plus of pooled credits per month), third-party models by token, interactions "logged directly to the Google Cloud project" [V, [enterprise](https://antigravity.google/docs/enterprise/)]. Consumer terms: clause 5, "We use Interactions to evaluate, develop, and improve Google and Alphabet research" and products, with a settings opt-out; clause 6, "Using third party software, tools, or services to access the Service" is a breach, OpenClaw named [V, [terms](https://antigravity.google/terms)].

**Models.** Gemini 4 Argon (2026-10-13; Ultra and Enterprise; not in the IDE), Gemini 3.8 Flash (all tiers), Claude Sonnet and Opus 5.5 (paid Pro, Ultra, Enterprise), Claude 4.6 and GPT-OSS-120b until 2026-11-02, Nano Banana 2 for images; the SDK adds local Gemma 4 through LiteRT [V, [models](https://antigravity.google/docs/models/)].

**Agent architecture (app).** Projects group conversations across folders; an agent starts in Local or New worktree mode; subagents are Markdown with frontmatter (`tools`, `model`, `commandExecutionPolicy`, `mcpServers`, workspace `inherit`/`branch`/`share`, nesting to 10), spawned by `invoke_subagent` or `define_subagent` and messaged by conversation id; Automations (ex Scheduled Tasks); a Chrome browser subagent behind `/browser`; artifacts (plans, walkthroughs, screenshots, recordings) with a review policy of "Request review" or "Always proceed"; `/plan`, `/goal`, `/grill-me`; Remote Control; JSON command hooks (`SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`) where `PreToolUse` may return `allow`, `auto_approve`, `deny`, `ask`, `force_ask` or `deny_unless_prior_grant` and rewrite arguments; sidecars (managed background processes with an `agentapi` CLI for `new-conversation` and `send-message`, off by default); plugins (`plugin.json` with `mcp_config.json`, `hooks.json`, skills, agents, rules; an official marketplace); rules (`AGENTS.md`/`GEMINI.md`, `.agents/rules/*.md` with a `trigger`); skills (`SKILL.md`, "an open standard", under `.agents/skills/`) [V, the pages under antigravity.google/docs: subagents, hooks, sidecars, plugins, rules, skills, artifact-review].

**CLI headless mode.** `agy -p` runs one prompt; `--output-format text|json|stream-json`; `--input-format stream-json` lets a parent write `user` events and read `result` events; `--json-schema`; `--print-timeout` (page: default `5m`; CLI v1.2.6 notes: unlimited unless set); `--sandbox` (default off); `--mode default|accept-edits|plan`; `--dangerously-skip-permissions`. Envelope: `conversation_id`, `status` (`SUCCESS`, `ERROR`, `CANCELED`, `INTERRUPTED`, `INVALID`, `WAITING`, `RUNNING`), `response`, `num_turns`, `usage`, and since v1.1.27 `denied_actions`. Approvals: "There is no interactive prompt"; unapproved tools are soft-denied with exit 0 and a stderr notice; workspace reads and writes are auto-allowed; "Sending `control_request` or `control_response` events ends the session with an `ERROR` result and exit code 2", so a parent cannot answer approvals [V, [headless](https://antigravity.google/docs/cli/headless/)]. Early `-p` runs dropped stdout under a pipe; closed as fixed in 1.1.1 [T, [issue #76](https://github.com/google-antigravity/antigravity-cli/issues/76)].

## 2. Protocols and extension points

**MCP as a client: every surface.** Config `~/.gemini/config/mcp_config.json` (global), `.agents/mcp_config.json` (workspace), or a plugin's; one `mcpServers` object; local servers use `command`, `args`, `env`, `cwd`; remote ones `serverUrl` with `headers`, `oauth` or `authProviderType: "google_credentials"`; `disabled` and `disabledTools`; stdio, streamable HTTP and SSE; an MCP Store of about 76 servers [V, [MCP](https://antigravity.google/docs/mcp/)]. Approval: "Unconfigured MCP tools run in Ask mode"; rules `mcp(server/tool)`, `mcp(server/*)`, `mcp(*)` under `permissions.allow|ask|deny` in `~/.gemini/antigravity-cli/settings.json` or the app's Permission Settings; deny beats ask beats allow; the Turbo preset allows MCP; CLI `always-proceed` auto-approves MCP (v1.1.21); enterprise MCP allowlists (v2.5.0) [V, [permissions](https://antigravity.google/docs/permissions/), changelog]. Timeouts: connection 60 s (CLI v1.0.15); "MCP timeouts for server connections and tool calls" in app v2.4.3, values unstated [V]; a CLI tool call "timed out after 3m0s", a per-server `timeoutSeconds` reported to work, closed 2026-09-18 [T, [issue #780](https://github.com/google-antigravity/antigravity-cli/issues/780)]. A 100-tool-per-server cap: "enabled tools would exceed max limit of 100" [T, [forum 2026-05-08](https://discuss.ai.google.dev/t/critical-dx-issue-antigravity-ide-hardcoded-mcp-tool-limit-100-configuration-fragmentation-with-gemini-cli/143969)]. **Lazy loading:** CLI 1.3.3 puts MCP tools behind a `call_mcp_tool` wrapper by default; a server may set `_meta["antigravity/alwaysLoad"] = true` on a `tools/list` entry to be registered natively as `mcp_<server>_<tool>`; eager registration was reported to vanish after compaction; no staff reply [T, [forum 2026-10-10](https://discuss.ai.google.dev/t/eager-mcp-loading-vs-terminal-ui-rendering-in-antigravity-1-3-3-antigravity-alwaysload-multiline-output-diff-cards/187944), [issue #569](https://github.com/google-antigravity/antigravity-cli/issues/569)]. The MCP revision the client speaks and any Tasks support: [U].

**MCP as a server: none** [U after search]. The only programmatic ingress to the app is the sidecar `agentapi` [V, [sidecars](https://antigravity.google/docs/sidecars/)].

**ACP.** Official `antigravity-acp` 1.4.0: a PyInstaller bundle of about 1 GB, cold starts of 8 to 25 s reported; modes `default`, `auto_edit`, `yolo`; in `default` it sends `session/request_permission` before shell calls; model via `session/set_config_option`; `session/cancel`, `load`, `resume` [V registry; T [forum](https://discuss.ai.google.dev/t/acp-server-1-1-1-official-agy-acp-server-cold-starts-in-16s-on-every-windows-spawn/183427), [untether #982](https://github.com/littlebearapps/untether/issues/982)]. The CLI's own `--acp` request ([issue #31](https://github.com/google-antigravity/antigravity-cli/issues/31), 2026-05-20) is open with no Google reply; the server went 1.1.1 to 1.4.0 in about six weeks [T]. In ACP, `session/new` carries `cwd` and `mcpServers` (stdio: `name`, `command`, `args`, `env`), so a client may hand the agent its own MCP server; `session/request_permission` offers `allow_once`, `allow_always`, `reject_once`, `reject_always`, and the agent only "MAY" ask; tool calls are reported as `session/update` with `toolCallId`, `kind`, `status`, `locations`, `rawInput` [V, [session setup](https://agentclientprotocol.com/protocol/session-setup), [tool calls](https://agentclientprotocol.com/protocol/tool-calls)].

**A2A.** Google's I/O write-up puts A2A under its agent stack [T, cloud.google.com]; no Antigravity page mentions it; subagents message by conversation id [V]. Nothing to integrate [U].

**Gemini CLI.** Replaced; migration keeps `GEMINI.md`/`AGENTS.md`, moves MCP servers to `mcp_config.json` [V migration].

**SDK.** `LocalAgentConfig(policies, hooks, mcp_servers=[McpStdioServer(...)], workspaces)`; policies `deny("*")`, `allow("view_file")`, `ask_user(tool, handler)`, `safe_defaults`, `workspace_only()`; `@hooks.pre_tool_call_decide` returning `HookResult(allow=...)`, argument rewriting since v0.1.13; MCP `enabled_tools`/`disabled_tools` and per-server `timeout_seconds`; read-only unless `CapabilitiesConfig()`; auth by `GEMINI_API_KEY` or Vertex, not the subscription [V, [SDK overview](https://antigravity.google/docs/sdk/overview/), [policies](https://antigravity.google/docs/sdk/policies/), repo, [Cloud blog 2026-09-09](https://cloud.google.com/blog/topics/developers-practitioners/power-agent-hubs-or-custom-harnesses-with-the-antigravity-sdk)].

**Permissions and sandbox.** App presets Default (commands in the terminal sandbox without prompts; MCP and web Ask), Request Review (sandbox off, every command asks), Turbo (no isolation, full filesystem, MCP allowed); CLI `toolPermission` `request-review|proceed-in-sandbox|always-proceed|strict`, `enableTerminalSandbox` default `false`, `allowNonWorkspaceAccess`; the sandbox is Seatbelt (`sandbox-exec`) on macOS, namespaces on Linux, a preview on Windows, covers shell commands only, no network unless `read_url` allows a domain, and the agent can ask to run unsandboxed [V, [sandbox](https://antigravity.google/docs/sandbox/), [CLI reference](https://antigravity.google/docs/cli/reference/)]. Workspace `.agents/hooks.json` runs arbitrary shell [V].

## 3. What this means for vibe-supervisor

### 3a. Antigravity as the MCP client

**Configuration.** One entry, the same shape for app, CLI, IDE and the SDK's `McpStdioServer`, and passable by an ACP client in `session/new.mcpServers` [V]:

```json
{ "mcpServers": { "vibe-supervisor": {
  "command": "/absolute/prefix/bin/vibe-supervisor",
  "args": ["serve", "--stdio", "--isolated", "--config", "/absolute/path/config.toml"] } } }
```

The Keychain lookup needs no `env`. Our `setup` writes only Codex's `config.toml` (`src/cli/setup.ts`), so Antigravity is documented by hand first. The shipped skill is a `SKILL.md`, which Antigravity reads from `.agents/skills/<name>/` or a plugin [V skills]; its wording assumes Codex.

**Where our semantics meet theirs**, each a gate, none settled by reading:

| Our assumption | Antigravity | Consequence |
|---|---|---|
| The five tools are callable; readiness proves it | CLI 1.3.3 lazy-loads MCP tools behind `call_mcp_tool` [T]; app behaviour [U]; eager loading via `_meta["antigravity/alwaysLoad"]` [T, undocumented] | The skill's catalogue check must accept the wrapper; whether `@modelcontextprotocol/server` 2.3.0 can emit `_meta` from `registerTool` (today `annotations` only, `src/mcp/tools.ts`) is [U] and a code change if wanted |
| The client answers each call promptly | MCP tools are Ask: a human clicks Allow per call unless `mcp(vibe-supervisor/*)` is allowed [V]; headless `agy -p` soft-denies them [V] | A start waiting on a prompt can outlive the 10-minute receipt; headless CLI is not a target |
| Start returns fast; status and result poll | Tool-call timeout about 180 s in the CLI, `timeoutSeconds` override [T]; app [U] | Compatible; `vibe_status` waits must stay under it |
| One active run per instance | Subagents with `enable_mcp_tools` inherit the parent's MCP servers (CLI v1.2.3) [V] | Parallel subagents hit the second-start rejection: correct, to be documented |
| Client disconnect ends the run and frees the lock | How the app or CLI ends a stdio server at conversation end, `/mcp` restart, plugin reinstall (which restarts plugin MCP servers, v1.3.1) or quit: [U] | The disconnect gate is per client; Codex evidence does not transfer |
| Bounded results | Large binary results go to files (app v2.9.1) [V]; text limits [U] | `maxResultChars` applies |
| Protocol revision | [U] | Our SDK implements 2026-07-28 and 2025-11-25; an older client fails at the first readiness call |
| Project state untrusted | Antigravity loads `.agents/` hooks, rules, skills and MCP config from the workspace [V] | Not our boundary, but a coordinator reviewing a hostile repository runs its hooks; say so |

**Terms and data flow.** Antigravity calling a local MCP server is a documented feature and our worker's credential is Mistral's, so clause 6 is not touched [I from V]. The data flow doubles: the coordinator's context goes to Google (and the chosen third-party model), the worker's reads to Mistral, and consumer Interactions are used for improvement unless opted out [V terms]. Our docs must say both.

**Boundary impact.** Nothing in the five tools, enforcement points or pins changes; "lets Codex delegate" becomes "lets an MCP client delegate; Codex verified, Antigravity verified when its gates are recorded". Whether a second verified client counts as the "platform scope" AGENTS.md forbids is the owner's reading; the recommendation treats it as documentation plus evidence.

### 3b. Antigravity as the worker behind a supervisor

| Route | Approval channel | Supervisor owns every approval? | Other blockers |
|---|---|---|---|
| `agy -p --input-format stream-json` | None: `control_request` ends the session; tools soft-denied or pre-granted by the user's global `permissions.allow`; workspace writes auto-allowed [V] | No | Reads the user's global settings, skills, rules, hooks and the workspace `.agents/` [V]; a wrapper sharing a server name with a user's allow rule silently pre-approved its calls [T, [myco #1408](https://github.com/goondocks-co/myco/issues/1408)]; sandbox off by default |
| ACP `agy_acp_server` | `session/request_permission`, which the agent "MAY" send; before shell calls in `default`; file edits [U]; options seen as `allow_once` only [T] | Partly: Antigravity's own allowlist passes calls before the client sees them [T myco] | Proprietary, unchecksummed 1 GB binary, so no pin manifest in our sense; 8 to 25 s cold start; four versions in six weeks; no effective-configuration read-back; tool reports are the agent's own claims, nothing like our event validator; per-process isolation via `GEMINI_HOME` [T] |
| SDK | `pre_tool_call_decide` hooks and `deny("*")`/`allow` policies, in-process [V] | Yes, in Python, inside the vendor's process | Brings back a Python runtime and hosts the vendor harness in-process, which ADR 0004 moved away from; API key only; 0.1.x weekly churn |
| Managed Agents API | Server-side | No local worktree, remote MCP only | Out of scope by construction |

**Terms for the worker case.** The FAQ: third-party software to access Antigravity "is a violation of our Terms of Service"; wrapping `agy` in third-party coding agents "is not supported under consumer plans" [V, [FAQ](https://antigravity.google/docs/faq/)]. One forum reply calls an MCP bridge exposing `agy -p` to Codex or Claude Code "not permitted" [T, [2026-09-25](https://discuss.ai.google.dev/t/is-using-the-official-agy-cli-through-a-local-mcp-server-with-third-party-ai-agents-permitted/184829)]; another calls a local script spawning the unmodified binary headless "an officially supported feature" [T, [2026-09-17](https://discuss.ai.google.dev/t/is-it-allowed-for-an-open-source-tool-to-call-the-official-agy-cli-in-headless-mode/183429)]. A supervisor whose client is Codex is the first case. With API-key auth (SDK, or the ACP server's `gemini-api-key`/`agent-platform` [V JetBrains page]) the subscription question disappears and billing is pay-as-you-go.

**Verdict [I].** No Antigravity surface gives a supervisor what `vibe-app-server` gives us: a local protocol where the client declares the approval callback, is asked before every profile tool call, reads the effective configuration back, sees every effect with its approval metadata, and can pin the engine by hash. ACP is the closest shape and the one to watch; it fails on ownership of approvals, on pinning and, under subscription auth, on terms.

### 3c. Security model, side by side

| | Antigravity | vibe-supervisor |
|---|---|---|
| Who decides a call | Presets, rules, `PreToolUse` hooks, a human prompt; Turbo and `always-proceed` skip all [V] | The supervisor, deny by default, every effect fingerprint-matched to an approval |
| OS isolation | A real terminal sandbox for shell commands, default on in the macOS/Linux app, off in the CLI; MCP and browser outside it [V] | None; application policy, and said so |
| Network | Sandboxed commands have none; browser and `read_url` are separate permissions [V] | The worker has no network tool |
| Project state | `.agents/` hooks, rules, skills, MCP servers load from the workspace [V] | Nothing loaded; `.vibe`/`.agents` refused |
| Engine version | Auto-updating weekly; no pin [V] | Exact pin, hashed manifest, fail-closed |
| Evidence | None published; a bug-bounty known-issues page exists, unreadable here [U] | `acceptance.json`, gates open until recorded |
| Data | Consumer Interactions used for improvement unless opted out; enterprise exempt [V] | Reads go to Mistral; redacted artifacts only |

Record: prompt-injection exfiltration (2025-11), a Turbo-mode drive wipe (2025-12), an RCE through `find_by_name` reported 2026-01-06 and fixed 2026-02-28, the OpenClaw cutoff (2026-02) [T Wikipedia, CyberScoop]. A 2025-11 claim that MCP calls had no human in the loop [T, Embrace The Red] is dated: MCP tools are Ask by default now [V].

## 4. Ecosystem and prospects

- **Adoption.** "It has more than 2.4 million weekly active users" (2026-07-22), up from 1.5 million in 2026-02 [V, [blog.google](https://blog.google/company-news/inside-google/message-ceo/alphabet-earnings-q2-2026/); T CNBC]. SDK repo 3.7k stars; CLI tracker 2.6k stars, 679 open issues [V]. A JetBrains survey (2026-01) put it at 6 % of developers, behind Copilot, ChatGPT, Cursor and Claude Code [T]. Launch HN thread over 1,000 comments [T].
- **Positioning.** "Our agent-first development platform", free entry, knowledge work beyond coding, parallel subagents, a hosted agent in the API, enterprise through Gemini Enterprise [V I/O post 2026-05-19]. Windsurf's former CEO co-signs; Google licensed Windsurf's technology for $2.4 billion in 2025-07 [T].
- **Roadmap.** Agent Manager leaving the IDE (announced, unshipped); Claude 4.6 and GPT-OSS removal 2026-11-02; enterprise previews for JetBrains, Zed, Xcode; the sandbox default "may change" [V].
- **Competitors, 2026-10.** Codex (our host); Claude Code; Cursor (about $2B ARR reported [T]); Windsurf (Cognition's); Kiro (spec-driven); Zed (an ACP host where Antigravity is one agent); Mistral Vibe (our worker, Apache-2.0, ACP and MCP in its README) [T [ssojet](https://ssojet.com/blog/ai-coding-agents-compared), [amux](https://amux.io/guides/ai-coding-tools-compared-2026/); own landscape note 2026-10-13]. None exposes a supervised, pinned, deny-by-default delegation to another vendor's agent.
- **Risks for anyone building on it.** Churn (Secure to strict mode, Agent Manager to app, Gemini CLI retired within a year, config paths moved three times, ACP server four versions in six weeks); terms (clause 6, the FAQ, reported suspensions of users who say they used only official tools [T forum]); consumer data handling; closed source and an unchecksummed ACP binary; a 100-tool cap and lazy loading that change what a model sees of an MCP server.

## 5. Compatibility matrix

| Option | Needs | Effort | Risk | Boundary impact | Decision |
|---|---|---|---|---|---|
| **A. App or CLI as MCP client** | `mcp_config.json` note; client-neutral skill; `mcp(vibe-supervisor/*)` guidance; four target gates | Low to medium: docs plus one target sitting | Medium: wrapper, Ask prompts against the receipt, timeouts and disconnect unobserved | None to tools, pins or enforcement; wording becomes "MCP client, Codex verified" | Owner: is a second verified client "platform scope"? Recommended: no, it is documentation plus evidence |
| **B. ACP client (Zed, JetBrains) passing us in `session/new.mcpServers`** | As A, through the ACP server | Low on top of A | Medium to high: a proprietary hop; whether it forwards `mcpServers` is [U] | None | After A, on request |
| **C. Eager annotation `_meta["antigravity/alwaysLoad"]`** | A change in `src/mcp/tools.ts` if the SDK exposes `_meta` | Low | Medium: undocumented, reported to vanish after compaction | An annotation, but runtime code for one client | Only if A's evidence shows the wrapper breaks the skill flow |
| **D. Worker via `agy -p`** | A new engine, globally pre-granted approvals | High | High | Breaks supervisor-owned approvals, untrusted project state, one engine; consumer terms | Reject |
| **E. Worker via ACP** | New engine and ADR; ACP client; permission mapping; `GEMINI_HOME` isolation; a pin for an unchecksummed binary; API-key auth | High | High: churn, "MAY" ask, agent-side allowlist first, no read-back, no effect audit | Breaks "one engine", "no ACP", the fail-closed pin, "never hosts the vendor" | Scope change; owner decision; not before section 7's triggers |
| **F. Worker via the SDK** | Python back; vendor harness in-process; API key | High | High | As E plus a second runtime | Reject |
| **G. Managed Agents API** | Remote execution | n/a | n/a | No local worktree or MCP | Out of scope |
| **H. A2A** | Nothing to integrate | n/a | n/a | n/a | Monitor |

## 6. Recommended path and non-goals

**Recommended:** A, evidence-gated and after 2.0.1; B as a documented variant if asked; C only on evidence. One engine, one worker (Vibe); client-agnostic in wording only as each client earns its gates.

**Non-goals:** Antigravity as a worker by any route (D to G); a second engine, selector or fallback; wrapping `agy` behind our tools; an ACP adapter of our own; Antigravity-specific runtime code before a client gate is verified; using a consumer Antigravity sign-in from anything we ship; "supported in Antigravity" before the gates below are recorded.

## 7. Staged plan

**Stage 0, now.** This file; the direction note and post-2.0.1 items in the development strategy; the landscape, audience, risk and action rows in the marketing strategy. Owner decision: confirm that a second verified MCP client is documentation plus evidence, not the platform scope AGENTS.md forbids. If read as scope, stage 2.1 does not start and this file stays a record.

**Stage 2.1: Antigravity as a verified MCP client.** Preconditions: 2.0.1 tagged; the decision above; an Antigravity account on the target (the free tier includes MCP and the CLI [V plans]); the two-machine rule unchanged; an allowance of two hosted Vibe runs. Work: `docs/reference.md` gains an Antigravity connection entry (the `mcp_config.json` shape, the `mcp(vibe-supervisor/*)` rule and what it grants, no headless `agy -p`, the subagent second-start note, the two-provider data flow); client-neutral skill wording; README's "used from Codex" becomes "verified MCP clients: Codex, Antigravity (versions)" only after the gates pass; `setup --client antigravity` is an owner decision (recommend docs only). Gates in the `acceptance.json` style:

```json
{ "name": "antigravity-mcp-readiness-on-candidate", "status": "UNVERIFIED",
  "evidence_required": "On the target, Antigravity CLI <version> or app <version> connected to the frozen 2.x archive through mcp_config.json: vibe_status readiness reports server_version, eligible, no blockers, free slot; record whether the five tools appear natively or behind call_mcp_tool, and the client's MCP protocol revision from the server log." }
{ "name": "antigravity-hosted-review-edit-confirmation", "status": "UNVERIFIED",
  "evidence_required": "With a new owner allowance of two hosted runs: one review and one edit started from Antigravity with readiness receipts, the approval prompt or mcp(vibe-supervisor/*) rule recorded, the edit verified independently in a disposable copy, both closed with verified cleanup. Stop on first failure; no retries." }
{ "name": "antigravity-mcp-client-disconnect-hosted", "status": "UNVERIFIED",
  "evidence_required": "One observed end of the Antigravity client (conversation closed, /mcp restart or app quit) during a running hosted run: the server exits, the worker process group is gone, the owner lock is released, the run is failed and never relaunched, private directories deleted, an edit worktree kept until vibe_close." }
{ "name": "antigravity-approval-latency-vs-receipt", "status": "UNVERIFIED",
  "evidence_required": "A start left waiting on the Ask prompt past 10 minutes is refused with the receipt-expired error, and a start after a fresh readiness call within the window is admitted." }
```

Acceptance: all four recorded for one surface with its Antigravity version; the compatibility document names that version and claims no other. Nothing in `src/` changes unless the readiness gate shows the wrapper blocks the skill flow; then C is a separate, small, reviewed change with its own gate.

**Later: a worker adapter, on triggers only.** Re-open when all hold: Google documents ACP permission semantics for every tool kind (read, edit, execute, MCP) and per-process isolation of configuration and credentials; the ACP server ships with checksums and a stable line, or source; API-key auth is the documented programmatic route; and a read-back lets the client confirm the effective permission configuration before the first turn. Then it is a scope change: an owner decision against the "no ACP" line, a new ADR, a second pin model, its own gates. Until then, "can vibe-supervisor drive Antigravity?" is no, by design.

**Marketing.** Audience: Antigravity users with a Mistral account, after stage 2.1, through the Google AI Developers Forum's Antigravity category, where people already ask how to combine Codex, Claude and Antigravity [T, forum thread titles 2026-09 to 2026-10]; the MCP Store only if Google documents a submission path [U]. Message: "a second opinion from Mistral, inside Antigravity, that cannot touch your checkout", with the usual qualifiers and the two-provider sentence. Guardrails: no implied Google endorsement; never describe a consumer-sign-in wrapper; the Antigravity version in every claim. The article and talks gain one line: the pattern is client-agnostic by protocol and proven per client by evidence. The rows are in [marketing/strategy.md](../marketing/strategy.md).

## 8. Not verified

- Any Antigravity behaviour by observation; nothing was installed or run.
- The MCP revision Antigravity's client sends, Tasks support, the app's tool-call timeout, and whether the app honours `_meta["antigravity/alwaysLoad"]`.
- How the app or CLI terminates a stdio MCP server, and whether `antigravity-acp` forwards `session/new.mcpServers`.
- Whether `@modelcontextprotocol/server` 2.3.0 lets `registerTool` emit `_meta` on `tools/list` (not checked in `node_modules`).
- Google's bug-bounty known-issues page for Antigravity (returned no body).
- Prices (third-party figures; Google's plan page showed no amounts in the fetched locale) and whether any forum reply came from Google staff.
- Gemini CLI's shutdown status, the Agent Manager's removal from the IDE, and the FAQ anchor on third-party software cited by the forum (the FAQ was read; the anchor not opened separately).
