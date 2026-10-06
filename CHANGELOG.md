# Changelog

## 0.9.0-rc.4

- Adds opt-in per-connection storage with `serve --stdio --isolated` and `configure-codex --isolated`, preventing independent MCP clients from competing for one owner lock. Each server snapshots the validated configuration and retains its own runs. Default shared storage and existing recovery behavior remain unchanged.
- Documents configuration refresh, private run ownership, and concurrent desktop/CLI use.

## 0.9.0-rc.3

Replaces the rc.2 package, since two different tarballs carried the rc.2 version.

- Workspace file grants now use the recursive `vibe-path:directory_recursive:` form, so files at any depth are readable and writable inside the worker workspace.
- Supervisor-owned agent profiles in the private `VIBE_HOME` shadow Vibe's built-in Plan and Accept Edits agents, which would otherwise replace the read grants and make writes global; mode IDs are unchanged.
- Hosted acceptance evidence recorded for desktop registration, a review, a programmatic edit, and an ACP edit with continuation.
- The rationale for the launch profile moved from code comments into `docs/compatibility.md`.

## 0.9.0-rc.2

Refuse uncorrelated or overlapping ACP permission requests by selecting an offered reject option instead of cancelling the whole prompt turn; `cancelled` remains the fallback when no reject option is offered.

## 0.9.0-rc.1

Initial private release candidate: local MCP stdio server, review/edit run lifecycle, private persistence, detached-worktree patch artifacts, CLI diagnostics/configuration, and a pinned Vibe launcher compatibility shim. Production authentication and long-run ACP gates remain unverified; see `docs/acceptance.md`.
