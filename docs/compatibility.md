# Compatibility

1.0.0 supports exactly **Mistral Vibe 2.26.1** through the enforced `--legacy-harness` programmatic path. The TypeScript pin is in `src/backends/pinned.ts`; the isolated Python launcher carries a matching pin. Version or source-signature drift fails closed. The project-discovery source hash and SessionLogger signatures are validated before launch. Validation against the installed macOS distribution (CPython 3.12) found the project-discovery and SessionLogger source bytes match the 2.25.8 assumptions, the AgentLoop permission predicate is AST-identical, and the 2.26.1 ToolManager preserves profile merge precedence while changing its default fallback to ASK. Its changed file helper delegates through `_sandbox_helper`; the no-sandbox legacy path retains workspace-root resolution and no-follow regular-file checks. The 2.26.1 profile and no-provider regressions passed. These findings do not certify other OS/interpreter builds, hosted inference, authenticated effective inventory, or a native client. Vibe 2.25.8 and all other versions are rejected. There is no ACP adapter, ACP probe, backend selector, or fallback to another entry point.

The Python shim runs Vibe with a private `HOME` and `VIBE_HOME`, filtered environment, disabled project discovery, filtered persistence, prompt-file handoff, and a fixed one-shot watchdog. It does not bundle Vibe or Python. It forces the pinned legacy harness and keeps shell/network tools unavailable. These are application controls, not an OS sandbox.

## Local checks

`vibe-supervisor doctor --config <path> --json` checks Node, Git, the selected Vibe executable/version, selected config provenance and local storage prerequisites. Its JSON records the exact `application_entrypoint` and `runtime_module` that produced the report. Doctor makes no provider request. It cannot establish provider authentication or the identity of an already-open MCP connection. The actual connection must be checked separately for its server version and exact five-tool catalog. Authentication is observed during a real run.

Use `npm run verify:release` for local code and security verification and `npm run smoke:install` for the offline installed-package check. The smoke verifies the installed executable and exact MCP tool inventory; it does not run a Vibe task or prove hosted inference.

The declared Node floor is 20.19.0. Release acceptance compares major, minor, and patch components; a passing run on another Node version does not establish that the minimum runtime itself was exercised. Verify the frozen package on Node 20.19.0 before making a stable compatibility claim.

## Acceptance of 1.0.0

The runtime source of 1.0.0 is identical to 0.9.0-rc.28 (`bef09855cd8104b979b962462ae9d87062ed8a9d`). Its hosted gates were observed on the target machine on the exact rc.28 archive (SHA256 `9179a091830e548d9ebd3c13bd6f12997f22a86bda6964d827c23e1a55773bbf`) and apply to 1.0.0 by owner decision together with a short confirmation on the 1.0.0 archive. The evidence is in `docs/history/` in the source repository; see [machine-readable gates](acceptance.json).

| Gate | Evidence |
|---|---|
| Native readiness | VERIFIED on the Codex desktop connection, rc.28, 2026-10-13. |
| Five hosted runs (review, edit, review and edit to the turn limit, review), each with a readiness receipt | VERIFIED, rc.28, 2026-10-13; the edit checked independently; no retries or repairs. |
| Provider authentication | VERIFIED through the hosted runs, rc.28, 2026-10-13. |
| Real active disconnect, official client | [EVIDENCE: date, run id, verdict]. The desktop variant (case 6) was inconclusive and is covered by the deterministic rehearsal. |
| 1.0.0 archive confirmation: readiness, one review, one edit with verified cleanup | [EVIDENCE: date, archive sha256, run ids] |

A separate real-project review ran safely but its answer was not accepted. Usage and cost are not reported (UNKNOWN). Completed execution and correct task output remain separate claims.

The preparing machine recorded full verify:release under exactly Node 20.19.0 on `7c7ba0e`, whose runtime source matches 1.0.0.

## Unverified gates

Not part of 1.0.0 and still unverified: a clean macOS account installation (planned for 1.0.1), CI on exactly Node 20.19.0 (passed locally; CI runs 20.19.x), and the live-allowlist and boot-key observations (covered by deterministic tests).

macOS Apple silicon is the supported platform. Linux and Windows code paths may exist, but 1.0.0 makes no support claim for them. No Intel or plugin installation gates apply to the reduced surface. `.codex-plugin/plugin.json` remains an unverified source scaffold and is not part of the npm package; its declarations do not establish plugin installation or registration support.
