# codex-vibe

Codex Vibe is a local MCP supervisor for delegated Mistral Vibe code reviews and isolated edit runs. It preserves the `codex-vibe` project identity and packages a supervised ACP client behind a strict workspace and process boundary.

The repository includes a private npm release candidate (`vibe-supervisor@0.9.0-rc.2`). It is **not published**; its source and package are MIT licensed under the retained `LICENSE` file. Do not infer Codex plugin installation or desktop visibility from the scaffold manifests.

## Documentation

- [Installation and usage](Read.md)
- [Implementation handoff](Handoff.md)
- [Contributor and agent instructions](AGENTS.md)
- [Repository skills and installation](docs/skills.md)

Start with the [functionality guide](docs/functionality.md) for supported workflows, MCP tools, run lifecycle, backends, results, and CLI commands.

## Requirements and setup

Use Node.js 20.19 or newer and Git. Run `npm ci`, `npm run build`, and `node dist/cli.js init`, then edit the generated private config and set `allowed_workspace_roots` to exact canonical workspace directories. The default backend is `programmatic`; ACP is opt-in with `backend = "acp"` while the real-hosted ACP gates remain unverified.

Use `node dist/cli.js doctor --json` to inspect local prerequisites. Doctor does not make a hosted model request and does not infer authentication from an environment variable. `configure-codex --dry-run` previews a local MCP entry; no user-global config is edited by CI or packaging tests. Start the local server with `node dist/cli.js serve --stdio`.

The stdio channel is reserved for MCP frames. The server exposes eight strict-schema tools for review, edit, status, continuation, response, result, cancellation, and close. See [docs/protocol.md](docs/protocol.md).

## Security boundary

The supervisor validates canonical workspace roots, isolates edit work in detached Git worktrees, limits child environments and output, redacts persisted strings, and refuses to remove worktrees when exported state is stale or incomplete. Reasoning and private thought fields are not persisted. Review every proposed patch before applying it.

This is an application-level policy boundary, **not an operating-system sandbox**. It does not provide kernel isolation, filesystem namespaces, or a network firewall. Shell and network capabilities are disabled by default. Treat delegated work as code execution with the local account's permissions.

See [docs/security.md](docs/security.md), [docs/configuration.md](docs/configuration.md), [docs/plugin-scaffold.md](docs/plugin-scaffold.md), [docs/acceptance.md](docs/acceptance.md), and [docs/compatibility.md](docs/compatibility.md).
