# Antigravity Backend Target Acceptance & Preparation Evidence

Recorded 2026-10-17. Target machine evidence for Google Antigravity (`agy` CLI) execution backend support on `explore_project_details`.

## 1. Environment & Identities

- Target machine: macOS arm64 (macOS 27.0.1, Node 24.21.0, npm 10.8.2).
- Antigravity binary: version 1.4.0, SHA-256 `a4502aaf310b2fd6eb657fcfec2fcc31a690fbbd0c2d14c8eefbb556409024ce`.
- Configuration: `backend = "antigravity"`, `paths.antigravity` configured to the verified `agy 1.4.0` binary.
- Candidate distribution: `cfa7fbecc59ccce422d88874798d5e9cae27772f0906f4c4a9ac2f2020e5738c`.
- Preparation report digest: `4ca2ca88520d1acbd4d4112ce3c9609203cb1c5c293fc2dbde4eee07b85824bf`.

## 2. Checks Performed

1. **Binary Verification & Doctor**:
   - Resolved `agy` binary against search path, verifying version 1.4.0 and binary SHA-256 digest `a4502aaf310b2fd6eb657fcfec2fcc31a690fbbd0c2d14c8eefbb556409024ce`.
   - `vibe-supervisor doctor` reports clean health with `provenance.backend = "antigravity"`.

2. **Isolated Environment & Strict Permissions Policy**:
   - Verified generation of private `antigravity-home` and `antigravity-tmp`.
   - Verified `$HOME/.gemini/antigravity-cli/settings.json` with `toolPermission = "strict"`, `enableTerminalSandbox = true`, `allowNonWorkspaceAccess = false`, mode-scoped permissions (`read_file` for review; plus `write_file` for edit), and unified deny rules (`command(*)`, `mcp(*)`, `read_url(*)`, `execute_url(*)`, reserved segments, secret patterns, and configured `excluded_globs`).
   - Verified `$HOME/.gemini/config/hooks.json` registering `supervisor-policy-gate` with `PreToolUse` command hook.

3. **Zero-Inference CLI Read-Back**:
   - Executed slash commands (`-p /config`, `-p /hooks`, `-p /permissions`, `-p /skills`, `-p /agents` with `--output-format json --sandbox --print-timeout 5s`) routed through a refusing loopback proxy.
   - Refusing loopback proxy intercepted and refused (403) all background telemetry and updater requests (`play.googleapis.com`, `antigravity-unleash.goog`, `antigravity-cli-auto-updater...`). Zero provider inference endpoints were contacted.
   - Total model tokens consumed: 0.

4. **Synthetic PreToolUse Hook Checks**:
   - Evaluated 6 synthetic tool invocations against `pre-tool-hook.mjs`:
     1. In-workspace read (`src/index.ts`) -> `allow`
     2. Excluded file read (`excluded/secret.txt`) -> `deny` (`path_excluded`)
     3. Secret file read (`.env`) -> `deny` (`path_secret`)
     4. Reserved path read (`.gemini/config/hooks.json`) -> `deny` (`path_reserved`)
     5. Out-of-workspace read (`/etc/hosts`) -> `deny` (`path_outside_workspace`)
     6. Write tool (`write_to_file`) -> `allow` in edit mode; `deny` (`tool_not_in_profile`) in review mode.
   - All 6 synthetic checks passed and generated 6 audited entries in the approval ledger.

5. **Receipt Binding & Readiness Gate**:
   - Verified that workspace readiness fails closed (`status: "missing"`, blocker `VSUP_INVALID_STATE`) prior to `prepare check`.
   - Verified that after `prepare check` PASS, workspace readiness issues a valid `readiness_receipt` bound to the verified candidate and binary digest.

## 3. Residual Files & Cleanup

All temporary preparation directories (`antigravity-home`, `antigravity-tmp`, test workspaces) were cleaned up with verified deletion. No processes or credentials remain.
