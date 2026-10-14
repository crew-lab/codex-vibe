# Practical trial mitigation and release-gap follow-up — 2026-10-13

Later checkpoint: the distinct 1.0.1-rc.1 package is now frozen and offline packaging plus exact Node-floor verification PASS. Read the [current completion audit](rc1-completion-audit.md) for artifact identity, installation proposal, six proposed hosted cases and remaining gates. The local-fix stage recorded below is preserved as provenance; no installed/public release or hosted outcome is implied.

## Outcome

Luna High implemented a reviewed local Supervisor candidate based on `7b30feaf60e7b6038e2bd80c14974d7ff270330e`. The preserved primary checkout was not used as runtime source. Installed/published 1.0.0 is unchanged; this is not a delivered release or a hosted confirmation.

The candidate checks the effective Vibe tool inventory before model use: missing required tools or unexpected tools fail closed. Optional diagnostics retain approved tool names and bounded invocation outcomes, with explicit truncation flags. They exclude arguments, file contents, paths, provider traffic and reasoning. Source/signature drift fails closed. Final flushing and concurrent writes are covered by regression tests. Calls rejected before `BaseTool.invoke` remain outside this trace.

Offline tests against pinned Vibe 2.26.1 proved actual local reads of ordinary and hidden workflow files, plus missing/extra inventory rejection. This does not establish the historical hosted failure's root cause, which remains UNKNOWN. It also does not certify the new candidate's hosted behavior. No paid runs or automatic retries occurred.

## Verification and independent review

- Full local verification: 650 Node tests, 77 Python tests, lint, typecheck, build, deterministic acceptance, secret scan and SBOM PASS. Exact command and interpreter are in the [worker manifest](practical-tool-access-2026-10-13-manifest.json); [verification log](verify-release.log) SHA256 `9f22b8fa79c23cd893f4d3560c21bec6a260acbee609f9d61d2a0794f806b052`.
- Initial restricted-environment run: seven process/PID inspection failures. The permitted rerun passed. No test or runtime permission boundary was weakened to bypass those failures.
- Independent source reviewer: no remaining actionable defects. Recorder initialization, exit flush and concurrent descriptor handling findings were corrected before final checks. The reviewer inspected source independently; it did not rerun the suite.
- Coordinator: [patch](candidate.patch) independently applied against the exact base, all ten changed files matched candidate bytes, and reversal restored a clean checkout. See [reversal evidence](reversal.json). Patch SHA256 `f638bea48dc93b90337f762924cddc166ecb757e2aa5240135e64fac0fe7cd76`.
- Dependencies and lockfile are unchanged. No global configuration, allowlist, installed package, commit, push or deployment was changed.

Candidate source: `<supervisor-repository>/tmp/practical-tool-diagnosis`. Read the [worker report](practical-tool-access-2026-10-13.md) for limits and provenance. Apply the patch only to its reviewed base or reconcile it explicitly against a refreshed clean source; do not apply it wholesale to the older dirty primary checkout.

## <site-project> follow-up

The previously interrupted independent final-export lane now PASSES for frozen candidate `28efb9d5d5ed3f811a63c365dbee469230dadf4e`. The reviewer verified source/preservation identities, all 320 export files, 36 localized routes, 30 sitemap URLs, ten city pages and stable quote-link compatibility. [Independent report and evidence](../site-project-release-gap-followup-2026-10-13/REPORT.md). Browser/build results remain attributed to the original coordinator; they were not independently replayed.

Privacy remains OPEN/UNAVAILABLE and release remains BLOCKED. Collector/submission interception, consent transitions with the loaded Google runtime, the fragment timing risk and modifier-click reproduction still need measurement-owner evidence. No observed leakage is claimed and no policy-dependent privacy change was made. The original closure is retained as a dated record; this report supplements its interrupted-export verdict.

## Remaining gates

1. Review and authorize delivery of this Supervisor candidate separately; packaging/install/publication are not included in this completed local fix. Any hosted confirmation needs a new exact scope and paid allowance.
2. Measurement owner supplies approved interception and the remaining privacy observations. Return evidence-backed policy options if a failure is demonstrated; do not broaden telemetry blocking automatically.
3. Refresh source/contributor identities before <site-project> integration. Release remains blocked until privacy and all applicable release gates pass; publication still requires its applicable authorization.
