# Antigravity Backend Target Acceptance & Preparation Evidence (agy 1.4.9)

Recorded 2026-10-30. Target machine evidence for Google Antigravity (`agy` CLI) execution backend support on macOS arm64.

## 1. Environment & Identities

- Target machine: macOS arm64 (macOS, Node 24.22.1, npm 10.8.2).
- Antigravity binary: version 1.4.9, SHA-256 `a66421b7962ffe5642e00cffdd2844dfde440e540502a29d206be5544a065c7b`.
- Configuration: `backend = "antigravity"`, `paths.antigravity` configured to the verified `agy 1.4.9` binary; `experimental.antigravity = true`, `experimental.antigravity_skip_permissions = true`.
- Candidate distribution: `14c7459770c79fadd71293ffacd23406a689c9918fbd29515d1458de00733faa` (source at commit `a95a659` on `main`).
- Preparation report digest: `5cacdd15f1c18f4f75e5d1f9b9d21c0ab1631f51529def34f909b0d3b7ce3818`.

## 2. Checks Performed

1. **Binary Verification & Doctor**:
   - Resolved `agy` binary, verifying version 1.4.9 and binary SHA-256 digest `a66421b7962ffe5642e00cffdd2844dfde440e540502a29d206be5544a065c7b`.
   - Built-in skills accepted: `antigravity-guide` and `antigravity_guide` alongside `automation`, `generative_ui`, `plugin`, `migrate-workflows`.

2. **Isolated Environment & Strict Permissions Policy**:
   - Verified generation of private child home and tmp directories.
   - Verified settings with `toolPermission = "strict"`, `enableTerminalSandbox = true`, `allowNonWorkspaceAccess = false`, mode-scoped permissions (`read_file` for review; plus `write_file` for edit), and unified deny rules (`command(*)`, `mcp(*)`, `read_url(*)`, `execute_url(*)`, reserved segments, secret patterns, and configured exclusions).
   - Verified hooks registering `supervisor-policy-gate` with `PreToolUse` command hook pointing to `pre-tool-hook.mjs`.

3. **Zero-Inference CLI Read-Back**:
   - Executed slash commands (`-p /config`, `-p /hooks`, `-p /permissions`, `-p /skills`, `-p /agents` with `--output-format json --sandbox --print-timeout 5s`) routed through a refusing loopback proxy.
   - Refusing loopback proxy intercepted and refused (403) all background telemetry and updater requests (`play.googleapis.com`, `antigravity-unleash.goog`, `antigravity-cli-auto-updater...`). Zero provider inference endpoints contacted.
   - Total model tokens consumed: 0.

4. **Synthetic PreToolUse Hook Checks**:
   - Evaluated 6 synthetic tool invocations against `pre-tool-hook.mjs`:
     1. In-workspace read (`src/index.ts`) -> `allow`
     2. Excluded file read (`excluded/secret.txt`) -> `deny` (`path_excluded`)
     3. Secret file read (`.env`) -> `deny` (`path_secret`)
     4. Reserved path read (`.gemini/config/hooks.json`) -> `deny` (`path_reserved`)
     5. Out-of-workspace read (`/etc/hosts`) -> `deny` (`path_outside_workspace`)
     6. Write tool (`write_to_file`) -> `allow` in edit mode; `deny` (`tool_not_in_profile`) in review mode.
   - All 6 synthetic checks passed and generated 6 audited entries in the approval ledger for each mode profile.

5. **Antigravity Probes (Zero-Inference)**:
   - **Scripted Model Server**: Loopback model server answered conversation title requests (`/flash-lite/i`) with plain text and agent turn execution with probe tool call injection on 18 requests across probe steps.
   - **Hook invoked and deny honoured (`antigravity-hook-invoked-and-deny-honoured`)**: `result: "pass"`. Control run completed `executed` with probe nonce returned; deny-all hook run completed `denied` with probe nonce withheld and hook invocation verified.
   - **Hook failure modes deny (`antigravity-hook-failure-denies`)**: `result: "pass"`. Sleep timeout (>2s), nonzero exit (code 3), and unparseable stdout all resulted in `denied` with probe content withheld.
   - **Stream tool shape (`antigravity-stream-tool-shape`)**: `result: "pass"`. Stream-json tool event shape matched audit parser expectations (`extractEnvelopeMeta`), counting 1 executed call in control stream and 0 in denied stream.
   - **Proxy honoured (`antigravity-proxy-honoured`)**: `result: "pass"`. Executed 6 proxy connection attempts with provider inference host `generativelanguage.googleapis.com` intercepted and refused.
   - **Project config not loaded (`antigravity-project-config-not-loaded`)**: `result: "pass"`. Planted ancestor configuration files above workspace were refused by supervisor path containment and ignored by agy.

## 3. Residual Files & Cleanup

All temporary preparation directories (`home-review`, `tmp-review`, `home-edit`, `tmp-edit`, test workspaces) were cleaned up with verified deletion. No processes or credentials remain.
