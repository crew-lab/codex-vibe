# Compatibility probe evidence (dated)

Moved out of `docs/compatibility.md`. These results were recorded on one developer machine against Vibe 2.25.8 and are kept as history; the machine paths below are not instructions.

## Reproduction and exact results

Probe scratch is in `work/compatibility/`. The script launches `/Users/roman/.local/bin/vibe-acp` with both `HOME` and `VIBE_HOME` inside that scratch directory. It does not invoke `--help`, send a prompt, or copy credentials. Run it only as a compatibility diagnostic; it writes Vibe runtime state under the scratch home.

| Check | Result |
|---|---|
| `vibe --version` | `vibe 2.25.8` |
| ACP `initialize` with protocol version 1 | Passed; server returned protocol version 1, Vibe 2.25.8, `loadSession: true`, and close/list/fork capabilities. |
| `session/new` with fresh home and no key | Failed as expected: `Missing API key for mistral provider.` |
| `session/new` with dummy `PROBE_NO_NETWORK_KEY`, telemetry disabled, and no prompt | Passed; returned untrusted workspace and initial `accept-edits` mode. No inference call was made. |
| `session/new` with `VIBE_DEFAULT_AGENT=plan`, `VIBE_ENABLED_AGENTS=["plan"]`, and enabled tools `["grep","read_file"]` | Passed; returned Plan as current mode and the only available mode. |
| Current compiled `AcpBackend.probe()` against `/Users/roman/.local/bin/vibe-acp` | Passed: available, Vibe 2.25.8, ACP initialize v1; isolated HOME/VIBE_HOME, no key and no session/prompt. |
| `/Users/roman/.local/share/uv/tools/mistral-vibe/bin/python src/backends/runtime/test_vibe_supervisor_launcher.py` | Passed against the real installed logger: append, overwrite, metadata files contain no fixture reasoning/secret canaries and retain ordinary public fields. |
| `npm run build` | Passed; TypeScript emitted and the build copied the pinned Python shim into `dist/backends/runtime/`. |
| `npm run typecheck -- --pretty false` | Passed after shared RunManager fixes landed. |
| `npm test` | Passed: 49 tests across 7 files, including ACP fake-subprocess integration coverage for session load without task replay, live continuation, correlated permission/form requests, cancellation, startup failure handling, redaction, and a 100-turn soak. These tests do not send hosted prompts. |
| `vibe-acp --help` | Not run: startup initializes Vibe logging and harness files before argument parsing. |
| `session/set_mode` rejection of an unavailable mode | Not verified; an initial scratch probe used an incorrect session ID. Treat this behavior as unproven. |
| Stock `read_file`/`grep` resolver with exact-root/recursive allowlist, denylist, `NEVER` fallback, outside path, and symlink to outside | Passed in a scratch test. Both tools returned `ALWAYS` for an ordinary in-root path and `NEVER` for outside, linked-outside, and root `.env` paths. The Vibe package's Python 3.12 interpreter was required; system Python could not load its `pydantic_core` binary. |
| Effective loaded-tool inventory in the real authenticated Vibe session | Not dynamically probed; source inspection confirms class-derived names and config filtering. The production profile applies explicit env config and checks mode/trust, but a hosted model turn and authenticated real-session tool inventory remain unverified. |

The dummy-key probe was only a local initialization/session-creation check. It did not validate hosted authentication, model generation, or MCP startup. ACP callback flows and cancellation were exercised with the fake subprocess integration fixture, and on-disk logger filtering was exercised against the real installed logger without a prompt. Those checks do not establish behavior during a hosted inference turn.

## Implementation references checked

Findings were checked in the installed package under `.../mistral-vibe/lib/python3.12/site-packages/vibe/` (`/Users/roman/.local/share/uv/tools/mistral-vibe/` on that machine).

