# Contributor and agent instructions

## The goal

codex-vibe (package `vibe-supervisor`) is a local MCP supervisor: Codex hands a task to Mistral Vibe, Vibe reviews or implements it, and it works well every time. That is the only goal. Every change is judged by one question: does Codex-to-Vibe work more reliably, and produce better results, after it than before? Prefer fixing what breaks in real use over procedure, paperwork or process. Do not add rules, gates, decision records or approval steps; delete them where they get in the way.

Usage is in [README.md](README.md), tools/config/CLI in [docs/reference.md](docs/reference.md), behavior in [docs/functionality.md](docs/functionality.md), the security design in [docs/security.md](docs/security.md), and the current state in [Handoff.md](Handoff.md). `vibe-app-server` is the default engine; Google Antigravity (`agy`) is an experimental backend, off unless `experimental.antigravity = true` and `backend = "antigravity"`. Preserve the MIT license and copyright notice.

## Product boundaries

These are how the solution stays safe to hand work to; keep them intact.

- Vibe gets no shell and no network. `allow_shell: true` is rejected. Reviews use `read_file` only; edits add `write_file` and `edit`. Tools outside the profile stay listed in the model's catalogue and are refused when called.
- Edits run in supervisor-created detached Git worktrees. Worker changes are never applied, committed, merged or pushed automatically.
- Workspaces must be inside the configured allowlist; invalid, unsafe or out-of-root paths are rejected.
- Each run gets a private HOME, VIBE_HOME and TMPDIR and an exactly filtered child environment. No user or project tools, hooks, agents, skills (Vibe's own bundled plugin skills excepted), MCP servers or trust records are inherited. Reasoning and secrets stay off disk.
- The app-server run is guarded by the supervisor-written session configuration, the owned loopback managed-configuration endpoint, the `permission = "ask"` profile with its denylist, the startup read-back, an approval handler that denies anything but the profile's tool on an in-workspace path, and an event validator that fails closed on anything unexpected. The Antigravity backend has its `PreToolUse` hook, private home and filtered environment.
- Any stable Vibe at or above 3.0.2 runs; the installed files must match their manifest and the server must report that exact version. After a Vibe upgrade, refresh the manifest and pass `prepare check`.
- Each review or edit start needs a single-use, request-bound grant from `vibe-supervisor task authorize` and its `attempt_id`. One run at a time; a restart never replays a task.
- Credentials reach the worker only through its child environment (`MISTRAL_API_KEY`; the Antigravity key from the environment or, on macOS, the launchd session). Never write them into docs, prompts, logs or committed files.

## Development

- TypeScript 5.9.3, strict, ESM, pinned dependencies and the lockfile; no framework swaps. Source in `src/`, tests in `tests/`, scripts in `scripts/`, docs in the root or `docs/`. Never edit `dist/` or `node_modules/`.
- No code comments; name things so the code reads without them. Tool directives (`//nolint`-style, `@ts-`, `eslint-`) are fine.
- Keep stdout for MCP frames in server mode; diagnostics go to stderr, redacted.
- Test behavior that matters: lifecycle, permissions, recovery, processes, Git. Run the relevant `npx vitest run <files>`, then `npm run lint`, `npm run typecheck` and `npm run build`; `npm run verify:release` is the full check CI runs. After changing an error remedy, run `npm run docs:errors`.
- The repository is public: no machine paths, private project names or credentials in any tracked file. `tests/unit/public-hygiene.test.ts` enforces paths and comments.
- Commits are one line, `type(scope): summary`. Fetch first, then push `main` with `make push` or a branch with `make push-branch BRANCH=<name>`.
- When you change behavior, update the doc that describes it, and keep [Handoff.md](Handoff.md) to what works, what does not, and what is next.
