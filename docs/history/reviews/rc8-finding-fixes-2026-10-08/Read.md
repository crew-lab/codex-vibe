# rc.8 finding fixes, 2026-10-08

The managed checkout contains the previously verified npm-symlink CLI entry fix and strengthened offline executable smoke. This follow-up corrects a separate soak-driver deadline mismatch: the original failed edit had a 2400-second worker deadline but a 900-second driver budget. For driver budgets of at least 60 seconds, the initial worker now gets the smaller configured limit or driver budget minus 30 seconds, capped at 7200 seconds. No template, global configuration, credential handling, isolation, or tool policy changed.

A silent fake edit verifies `VSUP_TIMEOUT`, closed state and worktree removal before the driver deadline; another regression preserves a shorter configured limit. Driver budgets below 60 seconds remain driver-only fault probes. Multi-turn ACP scenarios still share the overall driver budget, and continuation preserves its original per-turn worker deadline.

Two hosted programmatic edits passed using the current Vibe login and a 60-second supervisor deadline: an exact single-file write (23.223 seconds) and the original add-file task (10.782 seconds). Exported patches were inspected independently. Both runs are closed, owned workers absent and worktrees removed. Public results, patches and summaries are saved here; native histories and credentials are excluded. No account rotation or balance inspection was performed. See [session evidence](session.json).

The original silent stall remains unresolved: it did not recur, and these passes do not establish its cause or pass the 100-run hosted soak. The original 19-pass/20th-run failure remains recorded in the preceding report. Native desktop, callbacks, clean OS-account, Intel and the full hosted soak retain their previous unverified/failed status.

Full release verification and offline packaging passed: 620 TypeScript tests in 56 files, 66 Python tests, both installed-Vibe profiles, lint, typecheck, build, acceptance, secret scan, SBOM, installed npm executable/MCP smoke and archive checksums. See [complete verification output](package-verification.log). Changes remain uncommitted in the managed checkout; the older dirty primary source is preserved.
