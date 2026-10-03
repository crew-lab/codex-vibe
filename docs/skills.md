# Repository skills

The canonical skill sources live in this repository:

| Skill | Purpose | Original |
|---|---|---|
| `vibe-supervisor` | Setup and bounded review/edit delegation | [SKILL.md](../skills/vibe-supervisor/SKILL.md) |
| `vibe-acp` | Delegate, independently verify, send correction requests, and repeat using ACP | [SKILL.md](../skills/vibe-acp/SKILL.md) |

Keep changes in these originals. Installations should point to them or be refreshed from them; do not maintain a separate edited copy as the source of truth. `vibe-acp` includes a `references/` directory that must accompany its `SKILL.md`.

## Use from the project

Ask the coordinating agent to read `skills/vibe-acp/SKILL.md` in this checkout. This loads the workflow without changing global configuration. It does not install or register an MCP server. Iterative delegation needs the eight supervisor MCP tools and an explicitly selected ACP backend; see [installation and usage](../Read.md).

Do not create `.agents/` or `.vibe/` inside a workspace delegated to this supervisor merely to expose the skill. The current runtime rejects these project extension directories. The skill is for the coordinating agent, not an inherited worker extension.

## Optional Codex skill installation from a clone

To make both skills discoverable outside this project, a user can link the repository originals into the user skills directory. [Official Codex skill guidance](https://learn.chatgpt.com/docs/build-skills) documents `$HOME/.agents/skills` and support for symlinked skill folders. Run the following from the repository root after reviewing the destination. It changes user-global skill discovery, so an agent must not execute it without authorization.

```bash
repo_root=$(pwd -P)
codex_skill_dir="$HOME/.agents/skills"
mkdir -p "$codex_skill_dir"
ln -s "$repo_root/skills/vibe-supervisor" "$codex_skill_dir/vibe-supervisor"
ln -s "$repo_root/skills/vibe-acp" "$codex_skill_dir/vibe-acp"
```

These commands do not overwrite existing entries; inspect an existing installation before replacing it. Keep the checkout at the linked path. Follow the client's normal skill reload workflow and verify discovery; installation and automatic discovery have not been demonstrated by authoring these files. When reading linked skills, resolve the link to the repository original so sibling skills and repository documentation references retain their context.

The plugin manifest already points to the whole `skills/` directory, and the npm package's existing `files` allowlist includes it. Future packages therefore include both skills without a manifest change. The previously generated release tarball has not been rebuilt with these additions. Plugin installation remains a scaffold/unverified gate; skill installation alone does not establish plugin or desktop MCP visibility.
