# Vibe 3.1.3 worker-update trial — 2026-11-18

Supervisor 2.2.2 built from `aee834d`. Installed candidate SHA-256 `b87044dc286c0371851fb1c6920c61fc62f5303abd336c9e6892aec7ba03061f`. The RC checksums matched. The release suite passed 1,922 tests across 131 files, with one skipped.

1. Installed Vibe was 3.1.3. The trial used a private copy of a 3.1.2 manifest. The installed RECORD contained no unexpected unhashed rows.
2. First readiness took 0.75 seconds. It reported Vibe 3.1.3, no `worker_refresh` field, and effective limits of 25 turns and 1,800 seconds. It re-pinned automatically and archived one 3.1.2 manifest. Eligibility was false with `VSUP_INVALID_STATE` and a missing candidate preparation receipt. The blocker returned the preparation command.
3. The returned preparation command passed in 14.25 seconds. Readiness then reported eligible, no blockers, Vibe 3.1.3, no `worker_refresh` field, and the same effective limits. The hosted `review-stock` run `8aa0f43d-30d1-458e-bfb5-0cfa1c80e919` failed after about 3 seconds with `VSUP_AUTH_REQUIRED` / `invalid_api_key`. The provider detail was “This model is not available in your subscription tier.” The run read zero of three named files and returned no answer to score. The coordinator closed it.

The trial stopped at step 3. Hosted qualification remains pending until the selected model is available to the configured account. Downgrade, upgrade, installed-file drift, and the copy-rules replay remain pending.
