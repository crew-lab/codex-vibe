# Competitive landscape (2026-10-13)

Two widely used agent-orchestration projects, compared with vibe-supervisor as of rc.28. Researched read-only on 2026-10-13 from each project's website, README, design documents, a few source files and the GitHub API. Neither was installed or run; statements about their behaviour come from their own documentation unless a source file is named. Numbers are as of that date and move quickly.

**Summary.** Both are much larger products that run many agents autonomously for a team; vibe-supervisor makes one delegated task safe and checkable for one coordinator. Neither supports Mistral Vibe (Multica has an open request, issue #3513). Neither sandboxes the agents it runs, and both say so. The useful lessons are in failure handling and documentation, not in scope.

## Paperclip

[paperclip.ing](https://paperclip.ing/), [github.com/paperclipai/paperclip](https://github.com/paperclipai/paperclip). MIT.

- **What it is:** a self-hosted control plane that treats a team of AI agents as a company: org chart, goals, ticket-style issues with a single assignee, per-agent monthly budgets, approvals, a web UI and 24/7 autonomous work. Local quickstart `npx paperclipai@latest onboard --yes`; a hosted version is waitlist-only.
- **Stack:** pnpm monorepo (`server/`, `ui/`, `cli/`, `packages/`), one Node process with embedded Postgres locally, external Postgres in production. Node 24.11+.
- **Agents:** adapters for Claude Code, Codex (with ACP, auth caching and an output-inactivity monitor), Cursor, Gemini, Grok, Kimi, OpenCode and others, plus custom process and HTTP adapters. No Vibe adapter.
- **Execution:** heartbeats from a DB-backed wakeup queue (schedules, assignments, mentions) run budget checks, workspace resolution, secret injection and skill loading, then invoke the adapter. Sessions are resumed across runs.
- **Isolation:** `docs/agents-runtime.md` states that local CLI adapters run unsandboxed on the host. Git worktree workspaces are optional; remote sandbox and SSH targets exist. A `low_trust_review` preset narrows API scope for untrusted pull requests and fails closed on missing or foreign scope.
- **Permissions and cost:** short-lived run tokens, scoped secrets, an MCP tool gateway where each action is Allowed, Ask first or Off, with an audit log. Budgets warn at 80% and stop at 100%, from recorded spend, so in-flight work can overshoot (documented).
- **Failure handling:** DB leases give one active attempt per agent; stale-lock recovery is "crash recovery, not a retry loop", with a board-only force-release; bounded automatic retries for model capacity; replay of saved sessions; watchdogs for stopped issue trees, silent runs and liveness. Every non-terminal issue must have a live path forward.
- **Maturity:** created 2026-03-02; about 101,000 stars and 17,000 forks; about 6,000 open issues and PRs (about 3,000 PRs); roughly weekly date-versioned releases (latest v2026.1012.0).

## Multica

[github.com/multica-ai/multica](https://github.com/multica-ai/multica), [multica.ai](https://multica.ai). "Multica License": Apache 2.0 with added conditions on hosted or embedded services and branding (GitHub reports NOASSERTION), so source-available rather than OSI open source. Do not copy code into this MIT project.

- **What it is:** a team issue board where AI agents are assignees. A local daemon on a machine with the code claims tasks and runs the agent CLI; the agent comments, reports blockers and moves the issue to review. Cloud, desktop, mobile and self-hosted (Docker or Helm, Postgres).
- **Stack:** Go backend (Postgres 17), Next.js web, Electron desktop, Expo mobile. The `multica` CLI is also the daemon (`server/internal/daemon/daemon.go`, about 468 KB).
- **Agents:** about 26 CLIs (Claude Code, Codex, Copilot, Cursor Agent, OpenCode, Kimi, Grok, Qwen and others) through stream-JSON or ACP backends in `server/pkg/agent/`. No Vibe support; open request #3513.
- **Execution:** WebSocket wake-ups with a 30-second poll fallback, 15-second heartbeats, up to 20 concurrent tasks by default, no default agent timeout (idle and tool watchdogs instead). Each task gets a directory under `~/multica_workspaces` with a Git worktree from a cached bare clone, a private TMPDIR and an OS advisory `.task_lock`. The daemon self-updates only after running tasks finish. Mid-run steering for Claude Code, Codex and Grok.
- **Isolation:** its security-model page says agents run with the daemon user's full permissions, real HOME and unrestricted network, and recommends a dedicated user, container or VM. Claude Code is launched with permission prompts bypassed and Codex in full-access mode (`server/pkg/agent/claude.go`).
- **Failure handling:** a taxonomy of about 21 failure reasons (`server/pkg/taskfailure`); "poisoned" sessions that would fail again deterministically are not resumed (`daemon/poisoned.go`); garbage collection by TTL, orphan directories after 72 hours, and refusal to delete what it cannot prove is dead; cleanup can discard uncommitted agent work.
- **Maturity:** created 2026-01-13; about 52,700 stars and 6,900 forks; about 1,850 open issues and PRs; pre-1.0 (v0.6.2 on 2026-10-13), about three releases a week.

## Comparison

| | Paperclip | Multica | vibe-supervisor |
|---|---|---|---|
| Purpose | Company of agents | Team board with agent assignees | One review or edit for Codex |
| Concurrency | Many agents, around the clock | Up to 20 tasks per daemon | One active run per server |
| Worker isolation | None for local adapters | None: real HOME, network, bypassed prompts | No shell or network; private HOME and VIBE_HOME; filtered environment; read-only reviews checked before and after |
| Worker output | Works toward merged results | Commits and pushes | A patch, never applied |
| After a crash | Resumes and replays | Resumes sessions; cleanup can discard work | Marks the run failed; never replays |
| Agent versions | Probed | Probed, re-registered on upgrade | One pinned version; refuses on drift |
| Time limits | Watchdogs, sandbox backstop | None by default | Deadline, turn, output and progress limits |
| Interface | Web UI, tickets, chat | Board, steering, mobile | Codex tool calls |
| Scale | About 101k stars | About 53k stars, pre-1.0 | Private, rc.28 |

## What we take from them

Compatible with our boundaries, candidates for after 1.0:

1. **Failure taxonomy (Multica).** Check that `docs/errors.md` separates a stall, an exhausted context and a provider rejection, and that the remedy for a deterministic failure says not to resend the same prompt.
2. **"What is not isolated" (Multica's security page).** A short, frank section in `docs/security.md` next to "not an OS sandbox".
3. **Liveness from an OS-released lock (Multica).** Our owner lock decides staleness from the PID and `ps` elapsed time; a lock the kernel releases when the process dies would remove that guesswork.
4. **Stale-lock wording (Paperclip).** Document that stale-lock recovery is crash recovery, never a retry, and how an operator unlocks safely.
5. **Usage per run (both).** The result already carries Vibe's usage and non-authoritative cost when Vibe reports them; the rc.28 sitting recorded usage as UNKNOWN. Find out whether Vibe 2.26.1 reports usage in the programmatic path.
6. **A named profile for untrusted input (Paperclip's low-trust preset).** Documentation and naming for reviewing hostile diffs; no new capability.

Already in place: a silent-run watchdog (`limits.worker_progress_timeout_seconds`, 600 s, `VSUP_NO_PROGRESS`) and bounded deadlines by default.

## What we keep out

Session resume or replay after a restart; automatic retries; unsandboxed agents or bypassed permission prompts; a daemon with a database; concurrency, schedules and plugins; cleanup that deletes work on a timer; a general MCP tool gateway; any code from Multica under its licence.
