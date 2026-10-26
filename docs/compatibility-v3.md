# Vibe 3.0.2 compatibility assessment

Current policy: **Vibe 3.0.2 is the sole accepted and default exact version**. The current candidate remains **unqualified for hosted dispatch** until its own target gates pass. Configuration no longer has an experimental Vibe-version selector; pin and preparation evidence must match 3.0.2. This document preserves the earlier tagged-source review and prior candidate trial as historical evidence. Neither qualifies the current candidate or transfers to a new build.

## Source basis

The reviewed checkout is the exact `v3.0.2` tag commit `36f7b3a4e10440e90f98080492530b8f4d46960d`. SHA-256 values below are for the exact source bytes at that commit.

| Source path | SHA-256 |
| --- | --- |
| `vibe/app_server/server.py` | `05eedf63aa8ecb2423199e248b8fbde0afad0138f7d55b3dbf65427c6701ba76` |
| `vibe/app_server/protocol.py` | `d0a7b8e712bced849014982cfe342b6f4967f1c1b343cd99a0b46b073013488d` |
| `vibe/app_server/session.py` | `9ea618fc88a474b6b3d18bcee16bfaef5e2cb7de0aab5254dbd0e590e2d99119` |
| `vibe/app_server/models.py` | `180257cbfc7ccb18de366f42100abe01fddbc95273ac7183ea5bf2816cf9365a` |
| `vibe/app_server/events.py` | `6bcf1f97f090c83f7625c5ca61fa178c1f4107ef4c9747d12f377896bf58f7fe` |
| `vibe/app_server/_unified_harness_backend_adapter.py` | `2b63dfc160aa1b6877be15dd7d9e946e192ef68c4820861b543535731081473b` |
| `vibe/app_server/_runtime.py` | `ad3561ab5f9e0b529313b443df2057736f26afab8a0d68eae8cd98946a38bb7f` |
| `vibe/app_server/_config_introspect.py` | `e69a20c5c53f0c387fa4e09fbaba48c36e0ee7f5001b2d5e2d1952abbf680203` |
| `vibe/app_server/_approval_permissions.py` | `04e0fbfb21058a4b71c60ebea76dcabc07f04777b63c4750a6fb1897128777cb` |
| `vibe/app_server/_history_projection.py` | `1a6e5f309990fe3ea2f2b5b35d0a41a9924b948b528b9d6ebc8552b82d96f9d0` |
| `vibe/core/config/admin_config.py` | `af6fe5a1ab007c4a8f497df7261d39aa53e74bc9d9833597f87e7e586b1a6e94` |

The installed CLI independently reports `vibe 3.0.2`, and its `bin` directory contains `vibe-app-server` and `vibe-acp`. Those are installation facts, not conformance evidence. The first research attempt could not retrieve GitHub source because the environment blocked GitHub access and DNS; the coordinator then provided the exact tagged source checkout above. The earlier failure is retained here as research history, not treated as the current evidence state.

## Findings and qualification stop

Vibe 3.0.2 retains the protocol primitives for supervisor-controlled work: `server.py` dispatches `turn/start`, `turn/interrupt`, `config/effective/read`, and `runtime/read`; `session.py` emits `callback/call` and accepts `callback/result`; the typed approval callback in `models.py` carries an effect and exposes approval choices; effect history carries approval type/source; and `events.py` checks sequential event identifiers and snapshot watermarks. `effective_config_response` returns the redacted effective Vibe configuration, while the runtime extension returns its runtime snapshot. These source facts make a same-session correction flow technically plausible through another `turn/start` on the existing `session_id`. `session/continue` instead resumes the latest eligible session and is not the intended correction primitive.

Vibe 3.0.2 also has an explicit ephemeral-store path when `session_logging.enabled` is false: `_runtime.py` creates throwaway storage, and `_UnifiedSessionPersistence._persists_to_disk` in `_unified_harness_backend_adapter.py` returns false for disabled logging. Reasoning nevertheless exists as a first-class public history entry (`models.py`) and is projected by `_history_projection.py`; the supervisor must continue filtering it before persistence, output, and export. The terminal's changed default display for reasoning does not alter this protocol finding.

The managed-configuration control matches the existing supervisor endpoint. Vibe 3.0.2 appends `/api/v1/code/managed-config` to `vibe_base_url` in `vibe/core/config/admin_config.py`; the supervisor sets `VIBE_VIBE_BASE_URL` to its owned loopback root and serves the disabled policy at that exact route in `src/backends/app-server/managed-config.ts`. Vibe sends its authorization header to this loopback endpoint, which is the intentional request path; it does not redirect to a remote endpoint in the reviewed code. The supervisor reads back the loopback root through the effective configuration expectation. The earlier draft of this assessment incorrectly called the route a mismatch because it compared the root URL without appending Vibe's fixed path; that conclusion is withdrawn.

The Vibe server itself permits callbacks to offer session or permanent approvals and paths scopes. The Supervisor must continue denying those choices unless a particular in-workspace profile tool call satisfies its own handler. Vibe's existence of an approval callback is not evidence that the local approval policy has been retained. Likewise, this source review does not prove that repeated `turn/start` preserves the supervisor's cumulative token, cost, model-call, and time ceilings: those are Supervisor responsibilities that require lifecycle implementation and tests. No hosted run or target no-inference probe was done.

Historical trial implementation and preparation report: an earlier source snapshot exposed `vibe_continue` behind `experimental.correctable` and bound its explicit 3.0.2 profile into the runtime pin, policy revision, boot-drift detection, doctor output, preparation identity and conformance check. That snapshot's version-specific no-inference preparation passed (`prepare check` PASS report `7c0c69835c990bc80452a67c83af1de759bd90161a4b2428dc83eeeee6d5ce1c` on installed candidate `1727a9e15b5f71d2ab20d21767afbd1decffebf35b5044ef4a71a86c5d6c5e21` against the installer-provisioned runtime with `runtime-manifest.json`). This historical result does not qualify the current source or archive; the current public surface is five tools and one-shot only.

Historical report for that earlier six-tool trial snapshot: four local hosted trial runs were executed on the test fixture. Trial 1 read-only review completed successfully; Trial 2 one-shot edit and Trials 3/4 correctable edits were rejected because worker-generated test files failed contract requirements (`node:test` and `node:assert/strict`). No trial produced an accepted edit. Total consumption across all four runs was 14 model calls, 106,175 tokens, and an estimated non-authoritative cost of $0.06682. These runs do not authorize a new hosted dispatch or qualify the current candidate.

## Runtime identity

Historical candidate tooling labeled 2.26.1 `supported` and 3.0.2 `unqualified`. Current source accepts only 3.0.2 but still requires candidate-specific qualification. Runtime installation creates a separate versioned executable and hashes its installed files. It never changes the shared `vibe` command. Installation identity is not protocol qualification and does not authorize dispatch.
