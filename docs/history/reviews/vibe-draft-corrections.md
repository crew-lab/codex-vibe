# Correction request for the Vibe integration draft

Reviewed 2026-10-03 using [vibe-acp](../../../skills/vibe-acp/SKILL.md). This request targets the retained draft from the temporary CLI bootstrap, not the unchanged source implementation. The draft remains rejected. No corrections have been sent to a live ACP session and no draft code has been applied.

## Verification evidence

The prior checks against this exact retained candidate failed:

- `npm run typecheck`: TS7053 at `src/backends/launcher.ts:66`; indexing the inferred launch environment with `VIBE_SUPERVISOR_ORIGINAL_HOME` is invalid.
- `npm run lint`: unused `RunMode` and `baseProcessEnv` in `tests/unit/backends/profile.test.ts`.
- `npm test -- tests/unit/backends`: eight failures, four passes. The fixed `/tmp/test-run` fixture crosses macOS's symlink boundary and is rejected before reaching the assertions.

These checks are prior recorded evidence, not newly rerun results. Current review additionally reproduced the Python subprocess option mismatch with a non-secret fixture: `text=False, errors='ignore'` returns string stdout, so the draft's subsequent `.decode(...)` would raise `AttributeError` on successful lookup. No credential was used for that reproduction.

## Required corrections

| Priority | Location in draft | Required change | Acceptance evidence |
|---|---|---|---|
| P1 | `src/backends/profile.ts:94-135` | Remove unsupported `VIBE_AGENTS__...` environment overrides. Use a verified pinned runtime mechanism to preserve the supervisor's read allowlist against Plan overrides and retain `never` write/edit fallback against Accept Edits overrides. Preserve explicit enabled tools, deny patterns, and untrusted project state. | Inspect effective permissions after all configuration/agent layers for both review and edit. Test nested in-root access, outside/sibling/symlink denial, and disabled review writes. Environment-string assertions alone are insufficient. |
| P1 | `src/backends/runtime/vibe_supervisor_launcher.py:23-73` | Select account `MISTRAL_API_KEY` explicitly with `-a` for the fixed Vibe service names. Bound subprocess time and captured output, discard stderr/error outputs, and correct the bytes/text decoding mismatch. Return no credential on missing, malformed, oversized, or timed-out results. | Mock successful lookup, wrong/missing item, invalid output, timeout, and size overflow. Assert exact argv and verify a canary does not reach diagnostic output or persisted data. Never test using the user's credential as a fixture. |
| P1 | `src/backends/runtime/vibe_supervisor_launcher.py:178-206`; `src/security/environment.ts` | Keep browser authentication inside the private provider runtime. Carry only trusted original-HOME context for the fixed Keychain subprocess, remove that context before entering Vibe, and keep worker HOME/VIBE_HOME private. Validate Vibe version/entrypoint before credential lookup; explicit nonempty environment credentials take precedence. Define behavior for an empty value. | Test auth precedence, unsupported-version/entrypoint rejection before lookup, original-HOME removal, no other user-state inheritance, and filtered/redacted persistence. Review streaming diagnostics for exact-credential leakage when the coordinator does not know the child-resolved value. |
| P2 | `src/backends/launcher.ts:62-66` | Remove the redundant index assignment (the profile environment has already been spread), or explicitly type the environment as `NodeJS.ProcessEnv` if a necessary assignment remains. Avoid duplicate credential-context plumbing. | `npm run typecheck` passes with existing strict compiler options; launch/profile tests establish the intended environment. |
| P2 | `tests/unit/backends/profile.test.ts:7-17,82` | Use per-test canonical private temporary directories with cleanup. Build a complete valid `StartRunInput`: string task, run ID, cwd, workspace, directory, mode, and all `RunLimits` fields. Remove unused declarations. Replace the incorrect assertion that a glob denylist literally contains `.env.local` with a resolver behavior check. | Focused tests and lint pass; assertions actually reach and verify the policy. Do not bypass symlink validation or widen permissions. |
| P2 | New regression tests and behavior docs | Add meaningful installed-resolver/agent-layer and credential-runtime tests, not just copied environment strings. Update compatibility and usage evidence for the implemented behavior; keep hosted ACP, soak, and desktop gates unverified until tested. | Focused regressions, lint, typecheck, build, and relevant existing security/lifecycle tests pass. Then perform bounded real review/edit validation through the normal supervisor, with exact evidence. |

Retain the draft's useful recursive `vibe-path:directory_recursive:<canonical-root>` grant. Verify it against the pinned resolver; do not replace outside-root fallback with `always`, enable shell/network, grant project trust, relax symlink checks, or upgrade dependencies to resolve failures.

## Ready-to-send Vibe correction message

```text
Correct the retained browser-authentication and nested-file-policy draft.
You own src/backends/profile.ts, src/backends/launcher.ts,
src/security/environment.ts, the pinned runtime shim, focused tests, and
relevant behavior documentation. You share the codebase; preserve correct
existing work and other contributors' changes. Work only in the designated
isolated candidate worktree. Do not commit, push, merge, or apply to source.

Verification failed:
- Typecheck: TS7053, launcher.ts:66, environment-object indexing.
- Lint: unused RunMode and baseProcessEnv in the new profile test.
- Focused tests: 8/12 failed at private-dir creation through /tmp.
Review found additional defects:
- VIBE_AGENTS__... does not implement the intended agent policy overrides.
- Keychain lookup lacks -a MISTRAL_API_KEY and a captured-output bound.
- text=False with errors='ignore' produces str; .decode then fails.
- Credential lookup precedes version validation; precedence, privacy,
  diagnostic filtering, and original-HOME handling need behavioral tests.
- The fixture violates StartRunInput, and .env.local is not a literal
  denylist entry when the policy uses .env.*.

Implement minimal corrections per docs/reviews/vibe-draft-corrections.md.
Keep the encoded recursive grant, NEVER fallback, sensitive exclusions,
private homes, untrusted project state, exact Vibe 2.25.8 and TS 5.9.3.
Shell/network remain disabled. Do not weaken tests or change defaults to
ALWAYS. Browser-login credentials must stay inside provider runtime and
never enter prompts, arguments, files, diagnostics, or public artifacts.
The coordinator will run focused regressions, lint, typecheck, build,
relevant existing tests, and review the fresh patch. Report unresolved work
honestly; do not claim you ran shell checks.
```

## Continuation and preservation plan

The saved supervisor run was programmatic and is closed; the later CLI bootstrap also ended. These are not eligible for ACP `vibe_continue`. The current chat does not expose supervisor MCP tools. Do not claim a same-session correction has been dispatched.

Preserve the fresh reviewed draft patch and changed-file list. Before a new ACP correction run, establish working authenticated, policy-scoped ACP access. Choose an explicit base, create the supervisor-owned detached worktree, and deliberately carry the retained candidate into that worktree while the worker is idle; do not replay an uncertain original task or silently restart from HEAD and discard changes. If the supervisor cannot provide an idle setup point, implement or validate that preservation path before launching the correction task. Never use saved PIDs or restore pending permission grants.

The correction report can be supplied as approved context in a review task or as sanitized prompt text in an edit task; it is not automatically present in a worktree created from a Git base that predates this file. Keep the new ACP session open through independent verification and correction rounds. Fetch fresh exported artifacts after every change and close only after acceptance or a concrete documented blocker. The earlier supervisor export predates the CLI bootstrap edits; do not use it as cleanup authority.
