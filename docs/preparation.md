# Version-matched preparation kit

Each candidate ships a separate preparation-kit-VERSION directory with the conformance procedure, exact no-inference script, candidate identity and checksums. Keep this directory with its candidate archive.

Run `vibe-supervisor prepare check --kit /absolute/preparation-kit-VERSION --config /absolute/config.toml` using the installed candidate. It verifies kit/script/candidate hashes, then runs the review and edit initialization checks once with a fixed fake key and refusing network observer. It never sends turn/start or uses real provider credentials. A deterministic failure stops the check; do not blindly retry the unchanged candidate.

A private receipt and sanitized report are saved beside the selected pin manifest. Evidence binds candidate distribution bytes, pin manifest, Node version, platform/architecture and policy except workspace roots. Changing only task roots can reuse evidence; version/runtime/policy changes invalidate it. Missing, failed, changed or stale evidence blocks ordinary AppServer dispatch. Fixture tests inject their own preparation evidence provider; there is no production environment bypass.

Readiness reports workspace_eligible separately from eligible, candidate identity and preparation status. An optional expected_candidate SHA-256 detects connection drift. Existing runtime pin validation still runs at dispatch; an initialization-only receipt does not prove hosted inference, effective hosted permission enforcement, thinking behavior, disconnect soak, fresh-account installation or Intel support.

Review report.json/diagnostics and conformance findings before hosted testing. Hosted work retains its separately bounded allowance. A preparation failure is infrastructure evidence and must not trigger Luna fallback or replay the original task.
