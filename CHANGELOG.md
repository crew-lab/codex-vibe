# Changelog

## 0.9.0-rc.2

Refuse uncorrelated or overlapping ACP permission requests by selecting an offered reject option instead of cancelling the whole prompt turn; `cancelled` remains the fallback when no reject option is offered.

## 0.9.0-rc.1

Initial private release candidate: local MCP stdio server, review/edit run lifecycle, private persistence, detached-worktree patch artifacts, CLI diagnostics/configuration, and a pinned Vibe launcher compatibility shim. Production authentication and long-run ACP gates remain unverified; see `docs/acceptance.md`.
