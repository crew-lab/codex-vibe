# rc.21 multi-chat registration hotfix — 2026-10-10

Codex starts independent stdio connections for different chats. A shared non-isolated Supervisor directory rejected the second connection with `VSUP_INVALID_STATE` owner-lock contention. Setup now generates isolated registrations by default; existing registrations need a reviewed update and reconnect. Workspace allowlists and per-instance single-run limits are unchanged.

The branch preserves the frozen rc.20 source baseline as a separate commit before the rc.21 hotfix. Original dirty checkouts were not staged or modified. Supporting release fixes address a private-manifest false refusal when unrelated siblings change directory timestamps and a macOS test assumption about orphan-zombie reaping. Ancestor identity, owner and permissions plus manifest-file integrity checks remain enforced.

## Candidate verification

Node 24.21.0, macOS Apple silicon; exact Vibe 2.26.1; no dependency upgrades. `package:rc` passed lint, typecheck, build, 57 test files (551 passed, two platform-specific skipped), Python runtime checks, deterministic acceptance, secret scan, SBOM and offline installed-package smoke. Smoke includes two concurrent isolated MCP connections, exact five tools, unknown-run responses and EOF cleanup. A deterministic regression reproduced sibling-directory creation refusal before the preparation fix.

Package SHA-256: `5f4f4b4bef756137e0b86ffece38397a16428682f411931c575b7976ca020dc1`.

Initial verification attempts exposed the process-test timing assumption and concurrent preparation refusal; those attempts are not passing candidate evidence. Final release verification passed after the targeted corrections.

## Remaining limits

This is a prerelease, not stable v1.0. Native disconnect during an active worker and clean macOS account installation remain unverified. Hosted acceptance of rc.20 does not certify the rebuilt rc.21 artifact. A real rc.20 UARoute review stopped at its six-turn budget; its exit code 3 was incorrectly reported as BACKEND_CRASHED. That diagnostic limitation is recorded separately and is not fixed by this connection hotfix. No automatic continuation, replay or provider-quota workaround was added.
