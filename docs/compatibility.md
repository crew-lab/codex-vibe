# Compatibility

The candidate supports exactly **Mistral Vibe 2.26.1** through the enforced `--legacy-harness` programmatic path. The TypeScript pin is in `src/backends/pinned.ts`; the isolated Python launcher carries a matching pin. Version or source-signature drift fails closed. The project-discovery source hash and SessionLogger signatures are validated before launch. Validation against the installed macOS distribution (CPython 3.12) found the project-discovery and SessionLogger source bytes match the 2.25.8 assumptions, the AgentLoop permission predicate is AST-identical, and the 2.26.1 ToolManager preserves profile merge precedence while changing its default fallback to ASK. Its changed file helper delegates through `_sandbox_helper`; the no-sandbox legacy path retains workspace-root resolution and no-follow regular-file checks. The 2.26.1 profile and no-provider regressions passed. These findings do not certify other OS/interpreter builds, hosted inference, authenticated effective inventory, or a native client. Vibe 2.25.8 and all other versions are rejected. There is no ACP adapter, ACP probe, backend selector, or fallback to another entry point.

The Python shim runs Vibe with a private `HOME` and `VIBE_HOME`, filtered environment, disabled project discovery, filtered persistence, prompt-file handoff, and a fixed one-shot watchdog. It does not bundle Vibe or Python. It forces the pinned legacy harness and keeps shell/network tools unavailable. These are application controls, not an OS sandbox.

## Local checks

`vibe-supervisor doctor --config <path> --json` checks Node, Git, the selected Vibe executable/version, selected config provenance and local storage prerequisites. Its JSON records the exact `application_entrypoint` and `runtime_module` that produced the report. Doctor makes no provider request. It cannot establish provider authentication or the identity of an already-open MCP connection. The actual connection must be checked separately for its server version and exact five-tool catalog. Authentication is observed during a real run.

Use `npm run verify:release` for local code and security verification and `npm run smoke:install` for the offline installed-package check. The smoke verifies the installed executable and exact MCP tool inventory; it does not run a Vibe task or prove hosted inference.

The declared Node floor is 20.19.0. Release acceptance compares major, minor, and patch components; a passing run on another Node version does not establish that the minimum runtime itself was exercised. Verify the frozen package on Node 20.19.0 before making a stable compatibility claim.

## Unverified gates

No hosted or native-client acceptance claim applies to `0.9.0-rc.22` until its exact frozen artifact has been exercised and evidence recorded. Prior releases' reports are preserved under [`history/`](history/); they are version-bound and do not establish this candidate's behavior.

| Gate | Evidence still required |
|---|---|
| Hosted one-shot review and edit | Five total runs on the frozen candidate: one bounded review and one bounded edit, followed by three additional sequential review or edit runs. Stop at first failure, preserve diagnostics, verify every patch independently, and account for cleanup. No automatic retry or spending is authorized by this document. |
| Native Codex lifecycle | Actual five-tool discovery, one useful task, close, and client disconnect while a run is active against the exact artifact. |
| Clean macOS Apple silicon account | Install and run the documented workflow in a fresh account. |
| Provider authentication | A real candidate run; doctor and initialization-only checks are insufficient. |

No platform is currently certified for stable use. macOS Apple silicon is the first release target after these documented checks pass. Linux and Windows code paths may exist, but this candidate makes no support claim for them. No Intel or plugin installation gates apply to the reduced surface. `.codex-plugin/plugin.json` remains an unverified source scaffold and is not part of the npm package; its declarations do not establish plugin installation or registration support.
