# Compatibility

The candidate supports exactly **Mistral Vibe 2.26.1** through the enforced `--legacy-harness` programmatic path. The TypeScript pin is in `src/backends/pinned.ts`; the isolated Python launcher carries a matching pin. Version or source-signature drift fails closed. The project-discovery source hash and SessionLogger signatures are validated before launch. Validation against the installed macOS distribution (CPython 3.12) found the project-discovery and SessionLogger source bytes match the 2.25.8 assumptions, the AgentLoop permission predicate is AST-identical, and the 2.26.1 ToolManager preserves profile merge precedence while changing its default fallback to ASK. Its changed file helper delegates through `_sandbox_helper`; the no-sandbox legacy path retains workspace-root resolution and no-follow regular-file checks. The 2.26.1 profile and no-provider regressions passed. These findings do not certify other OS/interpreter builds, hosted inference, authenticated effective inventory, or a native client. Vibe 2.25.8 and all other versions are rejected. There is no ACP adapter, ACP probe, backend selector, or fallback to another entry point.

The Python shim runs Vibe with a private `HOME` and `VIBE_HOME`, filtered environment, disabled project discovery, filtered persistence, prompt-file handoff, and a fixed one-shot watchdog. It does not bundle Vibe or Python. It forces the pinned legacy harness and keeps shell/network tools unavailable. These are application controls, not an OS sandbox.

## Local checks

`vibe-supervisor doctor --config <path> --json` checks Node, Git, the selected Vibe executable/version, selected config provenance and local storage prerequisites. Its JSON records the exact `application_entrypoint` and `runtime_module` that produced the report. Doctor makes no provider request. It cannot establish provider authentication or the identity of an already-open MCP connection. The actual connection must be checked separately for its server version and exact five-tool catalog. Authentication is observed during a real run.

Use `npm run verify:release` for local code and security verification and `npm run smoke:install` for the offline installed-package check. The smoke verifies the installed executable and exact MCP tool inventory; it does not run a Vibe task or prove hosted inference.

The declared Node floor is 20.19.0. Release acceptance compares major, minor, and patch components; a passing run on another Node version does not establish that the minimum runtime itself was exercised. Verify the frozen package on Node 20.19.0 before making a stable compatibility claim.

## Unverified gates

Dated target evidence applies to the exact rc.28 archive from runtime source `bef09855cd8104b979b962462ae9d87062ed8a9d`, SHA256 `9179a091830e548d9ebd3c13bd6f12997f22a86bda6964d827c23e1a55773bbf`. This is distinct from the preparing-machine archive. See [target status](history/reviews/rc28-target-test-2026-10-13/STATUS.md) and [machine-readable gates](acceptance.json).

| Gate required for 1.0 | Recorded status |
|---|---|
| Native readiness | VERIFIED on the actual Codex connection for the frozen candidate. |
| Hosted review/edit matrix | VERIFIED: five sequential fixture cases, with independently checked edit and expected incomplete turn-limit outcomes; no retries or repairs. |
| Provider authentication | VERIFIED through real hosted candidate inference, not doctor or initialization probes. |
| Active disconnect | UNVERIFIED: desktop case 6 completed before interruption and is INCONCLUSIVE; official-client case 7 is NOT RUN. One allowance remains for case 7, not a desktop retry. Retain both observation requirements until an explicit owner decision resolves the one-versus-two contract. |

A separate real-project review passed read-only lifecycle/integrity but failed answer acceptance. Usage/cost is UNKNOWN. Completed execution and correct task output remain separate claims.

The preparing machine recorded full verify:release under exactly Node 20.19.0 on `7c7ba0e`, whose runtime source matches rc.28. This is upstream-recorded source evidence, not a newly performed target-machine floor or installed-package check.

Not required for 1.0 (owner decision 2026-10-12): a clean macOS account installation (planned for 1.0.1), CI on exactly Node 20.19.0 (passed locally; CI runs 20.19.x), and the live-allowlist and boot-key observations (covered by deterministic tests).

No platform is currently certified for stable use. macOS Apple silicon is the first release target after these documented checks pass. Linux and Windows code paths may exist, but this candidate makes no support claim for them. No Intel or plugin installation gates apply to the reduced surface. `.codex-plugin/plugin.json` remains an unverified source scaffold and is not part of the npm package; its declarations do not establish plugin installation or registration support.
