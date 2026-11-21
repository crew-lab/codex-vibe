# Antigravity 1.5.11 preparation, 2026-11-21

On the installed 2.2.2 candidate built from `70b2c16` (candidate SHA-256 `35f2389097d816c633d9868973cf4b6706c1e121fe8aab74749b30802d7b2498`), no-inference preparation passed with Antigravity 1.5.11 and `antigravity_skip_permissions = true`. The report SHA-256 was `86cdee6750312857f5aaed3fad482e26e22a4b005a4ab6ac8fdd698aefdbe07b`. This configuration leaves the supervisor hook as the tool gate.

A separate strict-mode preparation failed: the allowed control read did not execute (`turn_ended_without_function_response`). The findings included `probe_control_not_executed` and `agy_strict_permissions_blocked_control_read`; hook-failure and stream-shape checks could not be attributed without the control. The report SHA-256 was `0d837af8287cd540a29d88e9c377e561e4d5b50d6a34c76fdb444fc16a0cb10a`. This does not test alternative strict allow-rule forms.

Readiness on the prepared skip-permissions configuration reported the worker and candidate correctly but blocked hosted execution with `missing_gemini_api_key`: no supported key was found in the supervisor environment or macOS launchd session. No hosted run or quality-pack score was obtained. This was a manual preparation of a new configuration, not a test of automatic re-preparation after an upgrade.
