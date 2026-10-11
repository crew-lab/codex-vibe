# ADR 0003: pinned programmatic Vibe launcher

The package launches the installed Vibe programmatic CLI through a packaged Python shim and enforces its legacy harness. It does not bundle Vibe or its dependencies. The runtime supports exactly Vibe 2.26.1; version or installed-source signature drift fails closed. The recorded source audit applies to macOS with CPython 3.12 and does not certify other builds.

The supervisor writes a private prompt file under the run directory. The shim checks its owner-only mode, regular-file status, bounded size, UTF-8 encoding, and exact run-directory location, then deletes it and supplies the text in-process to Vibe. Prompt text is absent from OS-visible arguments.

The shim uses private `HOME`/`VIBE_HOME`, filters project harness discovery and persistence before launch, redacts recognized secrets and reasoning, resolves provider credentials only inside the child, forces the tested legacy harness, and watches its parent and fixed run deadline. Each started task is one-shot. The MCP interface has no ACP adapter or alternate entry point.

The profile is application policy, not an OS sandbox. Workspace and tool restrictions are defense in depth; do not claim that they constrain arbitrary process code to the worktree.
