# Compatibility

Published 1.0.0 and candidate 1.0.1-rc.2 support exactly **Mistral Vibe 2.26.1** through the enforced `--legacy-harness` programmatic path. The TypeScript pin is in `src/backends/pinned.ts`; the isolated Python launcher carries a matching pin. Version or source-signature drift fails closed. The project-discovery source hash and SessionLogger signatures are validated before launch. Validation against the installed macOS distribution (CPython 3.12) found the project-discovery and SessionLogger source bytes match the 2.25.8 assumptions, the AgentLoop permission predicate is AST-identical, and the 2.26.1 ToolManager preserves profile merge precedence while changing its default fallback to ASK. Its changed file helper delegates through `_sandbox_helper`; the no-sandbox legacy path retains workspace-root resolution and no-follow regular-file checks. The 2.26.1 profile and no-provider regressions passed. Candidate 1.0.1-rc.2 pins the effective tool inventory check, tool invocation, the tool-schema builder, the tool-call resolver and `ToolManager.get` to inspected Vibe source hashes, and refuses any tool outside the profile at invocation. Candidate-specific offline tests do not certify hosted inference, authenticated hosted inventory, or a native client. These findings do not certify other OS/interpreter builds. Vibe 2.25.8 and all other versions are rejected. There is no ACP adapter, ACP probe, backend selector, or fallback to another entry point.

The Python shim runs Vibe with a private `HOME` and `VIBE_HOME`, filtered environment, disabled project discovery, filtered persistence, prompt-file handoff, and a fixed one-shot watchdog. It does not bundle Vibe or Python. It forces the pinned legacy harness and keeps shell/network tools unavailable. These are application controls, not an OS sandbox.

## Local checks

`vibe-supervisor doctor --config <path> --json` checks Node, Git, the selected Vibe executable/version, selected config provenance and local storage prerequisites. Its JSON records the exact `application_entrypoint` and `runtime_module` that produced the report. Doctor makes no provider request. It cannot establish provider authentication or the identity of an already-open MCP connection. The actual connection must be checked separately for its server version and exact five-tool catalog. Authentication is observed during a real run.

Use `npm run verify:release` for local code and security verification and `npm run smoke:install` for the offline installed-package check. The smoke verifies the installed executable and exact MCP tool inventory; it does not run a Vibe task or prove hosted inference.

The declared Node floor is 20.19.0. Release acceptance compares major, minor, and patch components; a passing run on another Node version does not establish that the minimum runtime itself was exercised. Verify the frozen package on Node 20.19.0 before making a stable compatibility claim.

## Candidate acceptance: 1.0.1-rc.2

rc.2 changes the launcher and run manager relative to rc.1, so **runtime equivalence is false** and rc.1 results do not transfer. Open gates: native readiness on the rc.2 archive; the installed-Vibe profile check on the target (pinned sources, refusal at invocation and by `ToolManager.get`, no skills), which needs no hosted inference; one hosted review and one hosted edit, which need a new owner allowance; Node 20.19.0; and the fresh standard macOS account installation. See [machine-readable gates](acceptance.json).

rc.1 evidence is kept as history: native readiness, accepted hosted cases with the original edit failure, and the observed official-client disconnect. See the [rc.1 hosted report](reviews/rc1-hosted-2026-10-14/REPORT.md).

## Acceptance of 1.0.0

The runtime source of 1.0.0 is identical to 0.9.0-rc.28 (`bef09855cd8104b979b962462ae9d87062ed8a9d`). Its hosted gates were observed on the target machine on the exact rc.28 archive (SHA256 `9179a091830e548d9ebd3c13bd6f12997f22a86bda6964d827c23e1a55773bbf`) and apply to 1.0.0 by owner decision together with a short confirmation on the 1.0.0 archive. The evidence is in `docs/history/` in the source repository; see [machine-readable gates](acceptance.json).

| Gate | Evidence |
|---|---|
| Native readiness | VERIFIED on the Codex desktop connection, rc.28, 2026-10-13. |
| Five hosted runs (review, edit, review and edit to the turn limit, review), each with a readiness receipt | VERIFIED, rc.28, 2026-10-13; the edit checked independently; no retries or repairs. |
| Provider authentication | VERIFIED through the hosted runs, rc.28, 2026-10-13. |
| Real active disconnect, official client | PASS 2026-10-13, run 56c3920b-6758-4751-8b57-f58b2803942e. The desktop variant (case 6) was inconclusive and is covered by the deterministic rehearsal. |
| 1.0.0 archive confirmation: readiness, one review, one edit with verified cleanup | PASS 2026-10-13, archive 4e91e90b…; review f8f9c56f…, edit 377bc531…; independent verification and safe close, dirty export retained. See dated release-evidence supplement. |

A separate real-project review ran safely but its answer was not accepted. Usage and cost are not reported (UNKNOWN). Completed execution and correct task output remain separate claims.

The preparing machine recorded full verify:release under exactly Node 20.19.0 on `7c7ba0e`, whose runtime source matches 1.0.0.

## Unverified gates

Not part of 1.0.0 and still unverified: a clean macOS account installation (planned for 1.0.1), CI on exactly Node 20.19.0 (passed locally; CI runs 20.19.x), and the live-allowlist and boot-key observations (covered by deterministic tests).

macOS Apple silicon is the supported platform. Linux and Windows code paths may exist, but 1.0.0 makes no support claim for them. No Intel or plugin installation gates apply to the reduced surface. `.codex-plugin/plugin.json` remains an unverified source scaffold and is not part of the npm package; its declarations do not establish plugin installation or registration support.
