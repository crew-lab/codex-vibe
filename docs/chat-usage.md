# Using Vibe in another chat

Use a local desktop chat on the same computer where the supervisor is registered. Start a new chat and check that the Vibe supervisor tools are available. Installation is per host, so it does not need to be repeated for every chat. Independent connections need separate storage; use `configure-codex --user --isolated` and see [configuration](configuration.md#independent-mcp-clients). Restart the app after registration changes.

Example requests:

- “Use Vibe to review this repository for correctness bugs. Read only; report findings with file locations.”
- “Use Vibe ACP to fix this bug in an isolated worktree. Continue if needed, inspect the exported patch, run relevant checks, and show me the result before applying it.”

Give a concrete task, the absolute repository path, relevant files, and acceptance criteria. For edits, select an existing Git base ref. Uncommitted source changes are not copied into the detached worker worktree. Use a sufficient turn limit for multi-step work: the tested six-turn ACP continuation reached its cap despite producing the requested artifacts. Inspect the stop reason and patch rather than relying only on the completed status.

The supervisor creates the isolated edit worktree. Worker shell and network tools are disabled, so the parent assistant runs verification. Edits are exported for review; they are not automatically applied, committed, merged, or pushed. Close runs after inspecting their results, and request worktree cleanup when the artifacts are no longer needed.

## Prerequisites

Historical rc.2 checks verified browser-login authentication and hosted review/edit behavior. Current transport/tool visibility and current hosted execution are separate checks; a successful status request does not verify inference. A new chat needs access to the same local MCP connection. A different repository must first be explicitly added to the canonical workspace allowlist; the starter allowlist is empty.

A fresh machine needs Node.js 20.19 or newer, npm, Git, built supervisor installation, Vibe 2.25.8 with its matching Python interpreter, and `vibe-acp` for ACP runs. Configure explicit executable paths and workspace allowlists, authenticate with Mistral through the private provider runtime, and register the supervisor's stdio command in the desktop MCP settings. Use a tool timeout long enough for bounded hosted runs (this installation uses 600 seconds). Run the documented compatibility and doctor checks before inference. Do not place credentials in chat or repository files. Hosted prompts and permitted file contents are sent to Mistral; authorize that transfer for the intended workspace.

The historical hosted installation was the locally patched rc.2. Release rc.4 adds portable opt-in isolation; current hosted execution must be checked separately after updating. Plugin installation, Intel, clean-account setup, hosted lifecycle recovery, and the 100-run soak are still unverified. See [Handoff](../Handoff.md) and [field evidence](reviews/rc2-target-test-2026-10-05/Read.md).

## ChatGPT desktop and web

The local-host desktop workflow is what was tested here. OpenAI documents shared local MCP configuration for supported desktop/Codex clients, but ChatGPT web does not read the local Codex configuration. A cloud chat requires its own supported integration and computer/tool access; this local installation alone does not establish that. Check tool availability in the destination chat before starting. See [OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp).

Vibe calls incur Mistral provider usage. They may move work away from Codex, but total cost and Codex token savings depend on prompts, model choice, retries, and parent verification. Savings have not yet been measured.
