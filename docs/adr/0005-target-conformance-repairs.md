# ADR 0005: target contract and managed-configuration isolation

Status: implemented for local review in 2.0.0-rc.1; target acceptance pending.

The owner requested repair after the pinned 2.26.1 target rejected Supervisor's
non-null harness provenance assumption and attempted startup connections even
with experiments disabled. The frozen 2.0.0 artifact and both failed/incomplete
target observations are preserved.

Vibe's unified ConfigReadResponse permits null harness_selection_source and
does not populate it. Accept null without substituting an invented string;
continue requiring a present field, zero hooks/skills and actual unified session
and runtime identity. Fakes must preserve explicit null.

The pinned app-server independently refreshes managed organization configuration
when it finds a provider credential. There is no disable switch in the inspected
path. A remote admin layer can override the private environment settings. We
do not permit that layer or reinterpret experiments=false as its disable switch.

Use Vibe's existing vibe_base_url configuration setting to select a per-worker
Supervisor-owned, non-forwarding HTTP listener bound to 127.0.0.1 on an ephemeral
port. Only GET /api/v1/code/managed-config with no body returns a disabled policy.
Every other request returns 403. No headers, bodies or keys are logged or stored;
request/idle/header sizes and connections are bounded. This is a local managed
service response, not impersonation of a successful vendor authentication or
proof of inference. Same-account processes can reach loopback. Provider API
URLs, credential lookup and inference are unchanged.

Set the URL before spawn and require exact effective-config read-back. A bind
failure prevents spawn; a mismatch prevents the first turn. Close the listener
after worker termination is verified. An unverified worker retains its owned
endpoint alongside the existing reaper until safe cleanup can finish. Supervisor death
releases the OS listener; the existing reaper still owns worker termination.
There is no remote fallback. This excludes vendor organization policy by design;
deployments requiring that policy must not use this isolated profile.

This tightens private configuration isolation without enabling a worker network
tool or weakening any path/approval boundary. It is not a process firewall.
Do not patch installed Vibe, use an invalid URL as a disable switch, allow remote
policy, or suppress observed networking merely to turn a gate green.

The conformance control must enable both telemetry and experiments. Host-only
CONNECT observations prove neither the HTTP path nor experiments attribution.
Fail every subject request, preserve the observed host, and leave the specific
experiments effect unverified even if a generic listener control is positive.
Installed conformance, approvals, inference and disconnect behavior need new
target evidence on the repaired artifact. Fake tests do not supply that evidence.
