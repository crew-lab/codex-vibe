# ADR 0003: Pinned Vibe launcher shim

Status: accepted for the private compatibility path; production profile verification remains required.

The packaged Python launcher is copied from `src/backends/runtime/vibe_supervisor_launcher.py` into `dist/backends/runtime/`. It launches the locally installed `vibe-acp` entry point while constraining the environment and profile expected by the ACP adapter. The shim is pinned to the observed Vibe 2.25.8 behavior documented in `docs/compatibility.md`; it does not bundle Vibe or Python dependencies.

The Vibe implementation details are private and may change. At startup, the ACP backend verifies the version, the ACP protocol version, the active mode and the untrusted workspace status, and fails closed on any mismatch; the programmatic backend relies on the pinned version and its probe. The tool inventory is pinned through the environment and checked as a compatibility gate, not verified at each start. The shim and Vibe profile are application controls, not an OS sandbox. For the programmatic entrypoint the supervisor writes the task to an owner-only prompt file in the run directory and passes its path in `VIBE_SUPERVISOR_PROMPT_FILE`; the shim validates, reads, and deletes the file and substitutes `--prompt` into its in-process `sys.argv`, failing closed on any violation, so task text is absent from OS-visible argv. The ACP entrypoint rejects that variable and is unchanged. The logic lives in `consume_prompt_file` and is tested without Vibe by `test_prompt_file.py`.

ACP stays opt-in until adversarial integration and soak gates pass.
