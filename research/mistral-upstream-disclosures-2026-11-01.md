# Mistral Upstream Public Bug Report Drafts — 2026-11-01

Written on 2026-11-01 for Step 14 of Handoff and Step 3 of the [marketing sequence](../marketing/strategy.md#6-next-actions-in-order). Source reading only: Mistral Vibe was inspected via tagged source from GitHub (`v3.0.2` commit `36f7b3a4e10440e90f98080492530b8f4d46960d` and `v3.0.3` commit `7bb48f213ac677f943d5c791199ed3dddf302f00`).

## Disclosure Policy and Sequencing Guardrail

Per [`marketing/strategy.md`](../marketing/strategy.md#5-mistral):
1. **Private Note First**: The private security candidate regarding `workspaceRoots` and `trustWorkspace` precedence (drafted in [`research/vibe-3.0.2-security-recheck-2026-10-28.md`](vibe-3.0.2-security-recheck-2026-10-28.md#candidate-2-for-securitymistralai)) must be sent to `security@mistral.ai` before filing public reports.
2. **Sequencing Hold**: Public bug reports must remain held until maintainer acknowledgement or 14 days have elapsed, whichever comes first.
3. **Who Files**: The human owner files; agents only draft.
4. **Tone and Independence**: Contribution, not critique. "A headless client must declare, deny and read back", never "Vibe does not enforce". Every report carries the independence line: *An independent project, not affiliated with Mistral AI or OpenAI.*

---

## Bug Report 1: `initialize` response does not expose protocol version (divergence from ADR 0009)

**Title**: `initialize` response does not return protocol version (divergence from ADR 0009)

**Target Component**: `vibe-app-server` JSON-RPC connection initialization

**Environment / Version**: Tag `v3.0.2` (`36f7b3a4e10440e90f98080492530b8f4d46960d`) and Tag `v3.0.3` (`7bb48f213ac677f943d5c791199ed3dddf302f00`)

### Summary

In Vibe ADR 0009 (`docs/adr/0009-app-server-protocol.md`), the protocol specification states that the `initialize` handshake negotiates or reports the protocol version, allowing clients to determine whether the server's wire protocol is compatible before issuing further RPCs.

In the implementation (`vibe/app_server/_connection_protocol.py`), `InitializeResponse` is defined with only `server_info: ServerInfo` and `process_id: int | None = None`. It carries no protocol version or wire contract identifier.

### Impact

A headless client or supervisor communicating over stdio JSON-RPC cannot verify protocol compatibility during handshake. When wire formats change between minor or patch releases (such as tool renames or payload changes), clients have no wire-level protocol version to inspect and must rely on external package inspection or runtime heuristics.

### Source Basis

- `vibe/app_server/_connection_protocol.py`, lines 47-51:
  - `v3.0.2` SHA-256: `7ddc84f91d81a1cd299c409792f09ccbdbf7eaabf072a11a33eb9a9519cbe1c8`
  - `v3.0.3` SHA-256: `df817944eab6645d491157e937a9e13afb756e5c330f083bae1229524bc37219`
- ADR 0009 (`docs/adr/0009-app-server-protocol.md`)

### Steps to Reproduce

1. Connect to `vibe-app-server` over stdio JSON-RPC.
2. Send `initialize` request with client info and declared capabilities:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 1,
     "method": "initialize",
     "params": {
       "client_info": { "name": "example-client", "version": "1.0.0" },
       "capabilities": { "callback_kinds": ["approval"] }
     }
   }
   ```
3. Inspect the response payload:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 1,
     "result": {
       "server_info": { "name": "mistral-vibe", "version": "3.0.3" },
       "process_id": 12345
     }
   }
   ```
   Notice the result contains `server_info` and `process_id`, but no `protocol_version` field.

### Expected Behavior

Per ADR 0009, `InitializeResponse` should return a protocol version identifier (e.g. `protocol_version: str` or integer schema version), or ADR 0009 should be updated to document that wire protocol versioning is not currently exposed in `initialize`.

### Suggested Resolution

Add `protocol_version: str` (or `schema_version: int`) to `InitializeResponse`, or update ADR 0009 if protocol version negotiation was intentionally deferred. Corrections welcome.

*An independent project, not affiliated with Mistral AI or OpenAI.*

---

## Bug Report 2: Breaking wire rename (`file_system.search_replace` -> `file_system.edit`) and payload flattening in 3.0.3 unlisted in CHANGELOG

**Title**: 3.0.3 approval wire rename (`file_system.search_replace` -> `file_system.edit`) and input shape change unlisted in CHANGELOG

**Target Component**: `vibe-app-server` approval callback and tool execution wire

**Environment / Version**: Tag `v3.0.3` (`7bb48f213ac677f943d5c791199ed3dddf302f00`) vs Tag `v3.0.2` (`36f7b3a4e10440e90f98080492530b8f4d46960d`)

### Summary

In Vibe 3.0.3, the built-in edit tool was renamed on the approval wire from `file_system.search_replace` to `file_system.edit`. Concurrently, the effect input payload was flattened from a batched format (`content: [{old_str, new_str, replace_all}]`) to a single change format (`old_string: str`, `new_string: str`, `replace_all: bool`).

Any third-party app-server client or supervisor inspecting approvals on `callback/call` to enforce permission policies or validate in-workspace write targets breaks upon upgrading to 3.0.3 unless updated. However, `CHANGELOG.md` for 3.0.3 contains no entry mentioning this breaking wire rename or payload flattening.

### Impact

Headless clients that validate or authorize tool approval callbacks by wire name receive unexpected tool names (`file_system.edit` instead of `file_system.search_replace`) and fail closed or deny valid edits. Because this breaking wire change is not mentioned in the changelog, embedders cannot anticipate the breakage from release notes alone.

### Source Basis

- `harness/core/src/core/tools/external.rs`:
  - `v3.0.2` SHA-256: `2dfaa53b3fcaad8d640d86482b3f965f73678ef56976d2e3c43502928fa2e5b8`
  - `v3.0.3` SHA-256: `449def08e2f2d7c56593c226f3d39020c1b52d7c9d944904d3813d9946282c27`
- `vibe/app_server/_unified_tool_projection.py`:
  - `v3.0.2` SHA-256: `987d70d4b41b8513ae39026ffb7b66ac4deba08dcae73178f828fbf2a6a38efb`
  - `v3.0.3` SHA-256: `ec1e1e999ef1f6fc73b77ad94faee26b398a09ce73e2c562a36958b06c462ca5`
- `vibe/app_server/_unified_permissions.py`:
  - `v3.0.2` SHA-256: `e8190f27982acc818fb828d66a5edd47023283e5ebfc8298ff6112440dfb8911`
  - `v3.0.3` SHA-256: `df494ed1414620b38b377c73067860ff228e028f3f4cfbebf33a8d78f65f0981`
- `CHANGELOG.md`:
  - `v3.0.3` SHA-256: `1948f09d87fb85d90dbe66b6618406ce8a1e3e1f1d465d5d4a2267200152a6b8`

### Expected Behavior

Breaking changes to wire RPC names, approval callback tool identifiers, and effect input shapes should be listed under a "Breaking Changes" or "App Server Protocol" heading in `CHANGELOG.md` for the release.

### Actual Behavior

`CHANGELOG.md` for 3.0.3 describes CLI and general fixes, but does not mention the rename of `file_system.search_replace` to `file_system.edit` on the approval wire or the change from `FileEditEffectBatchInput` to `FileEditEffectInput`.

### Suggested Resolution

Add an entry to `CHANGELOG.md` documenting the tool rename on the approval wire and its input shape flattening, and consider listing app-server wire changes systematically in future releases. Corrections welcome.

*An independent project, not affiliated with Mistral AI or OpenAI.*

---

## Bug Report 3: ADR 0009 documents callback response RPC as `callback/respond`, but server implements `callback/result`

**Title**: ADR 0009 documents callback response method as `callback/respond`, but implementation requires `callback/result`

**Target Component**: `vibe-app-server` JSON-RPC specification vs dispatcher implementation

**Environment / Version**: Tag `v3.0.2` (`36f7b3a4e10440e90f98080492530b8f4d46960d`) and Tag `v3.0.3` (`7bb48f213ac677f943d5c791199ed3dddf302f00`)

### Summary

In Vibe ADR 0009 (`docs/adr/0009-app-server-protocol.md`), the specification states that a client responds to server callback requests (such as approval callbacks) by invoking the JSON-RPC method `callback/respond`.

In the actual implementation across both 3.0.2 and 3.0.3 (`vibe/app_server/server.py` and `protocol.py`), the registered JSON-RPC handler for delivering callback responses is named `callback/result`. A client written to the ADR 0009 specification receives a method-not-found error (`-32601`) when attempting to respond to approval callbacks.

### Impact

Developers implementing against the documented protocol specification rather than inspecting the internal Python server codebase encounter unexpected failures on the first approval callback.

### Source Basis

- `docs/adr/0009-app-server-protocol.md`
- `vibe/app_server/server.py`:
  - `v3.0.2` SHA-256: `05eedf63aa8ecb2423199e248b8fbde0afad0138f7d55b3dbf65427c6701ba76`
  - `v3.0.3` SHA-256: `82bea0d46ef42812064f3f38c0ff608a80bc13dc3315abbd5c3912e02d559da5`
- `vibe/app_server/protocol.py`:
  - `v3.0.2` SHA-256: `d0a7b8e712bced849014982cfe342b6f4967f1c1b343cd99a0b46b073013488d`
  - `v3.0.3` SHA-256: `b30a6a4677560db18d5ac0cd819ed4c4a3570d835d18101ca9e3d64fc6f0b589`

### Expected Behavior

ADR 0009 and the implementation should agree on the RPC method name, or ADR 0009 should clarify that `callback/result` is the wire method name.

### Actual Behavior

ADR 0009 names the method `callback/respond`; the server registers and responds only to `callback/result`.

### Suggested Resolution

Update ADR 0009 (or add an errata note) aligning the documented callback response method name to `callback/result`. Corrections welcome.

*An independent project, not affiliated with Mistral AI or OpenAI.*
