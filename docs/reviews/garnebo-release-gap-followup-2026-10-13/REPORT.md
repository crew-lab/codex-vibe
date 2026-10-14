# Independent final-export acceptance

**PASS in the frozen local export scope. Privacy OPEN / UNAVAILABLE. Release BLOCKED.**

Signed by role: Independent final-export reviewer (`garnebo_export_review`), 2026-10-13. This review completes the previously interrupted final-export lane only.

Durable copies of the inspector and its final evidence are beside this report: [inspector](inspect.py), [evidence](evidence.json). Evidence SHA-256: `669dab9d76c39d13ee1328bbbe2a5b0825efab5847b5a6a4a9cc29e7d7473af9`. Original execution paths below are retained as provenance.

Candidate: `/private/tmp/garnebo-release-gaps-2026-10-13/candidate-current`.
Frozen source: `28efb9d5d5ed3f811a63c365dbee469230dadf4e`.
Export inventory SHA-256: `c5fc5234003a0b30cc36d77927e5df1e370e80ff0329ecefefdfde863ff113e6`.

## Independent results

- Clean candidate before and after inspection; all 338 recorded source input hashes match.
- All 189 inherited source/message/public/content-rule file identities match the original baseline, including existing city page source and messages.
- All 320 inventoried export bytes match; no missing, extra, duplicated or unsafe inventory paths. Manifest source and inventory identities match the frozen contract.
- Existing release and route verification scripts exit 0.
- Actual script-stripped HTML for all 36 localized routes has primary main/H1 content, exact canonical and reciprocal Italian/English/x-default metadata. All 30 intended searchable routes occur exactly once in the sitemap; the six legal pages remain excluded by the existing sitemap policy.
- All ten existing city pages retain localized routes, canonical/alternate links, sitemap presence and city-scoped structured data.
- Eight service/guide pages export at least three main quote CTAs and four prefilled quote anchors, each using its expected stable tile/drywall/demolition ID and locale quote path.
- Seven stable IDs pass direct resolver assertions. All 14 legacy labels, with and without one permitted trailing slash, resolve correctly; normalization preserves later duplicate service parameters, unrelated query and hash. Stable IDs with a slash are rejected as intended. All seven IDs and both legacy language families are present in compiled output.
- Quote primary copy is static; the interactive form is a client-rendered Suspense subtree. This review does not claim that its controls render without JavaScript. Hydrated selection browser records are coordinator evidence, separately identified rather than claimed as independent observations.

## Commands and evidence

Executed `python3 tmp/garnebo-independent-export-review/inspect.py` from `/Users/roman/src/github.com/crew-lab/codex-vibe`; that read-only inspector executes the following against the frozen candidate and stores exact arguments, exit codes, stdout and stderr in `evidence.json`:

- `git rev-parse HEAD`, `git status --short` before and after
- `node scripts/verify-release.mjs`
- `node scripts/validate-routes.mjs`
- `node -e` to read the existing localized-route registry
- `node --input-type=module -e` to execute explicit assertions against the inherited quote-service resolver and URL normalizer

`inspect.py` records the independent file/hash/HTML/sitemap/schema/CTA checks and `evidence.json` lists each inspected page and hash. The initial inspection harness incorrectly assumed legal pages belong in the sitemap and that client form controls are static inputs; source inspection corrected both assumptions before the final run. Neither was a site defect. Final defects: none found in this scope.

Reviewed existing `build/commands.json`, source/export manifests, closure, relevant AGENTS, routing tests, and `browser/fresh-evidence.json`: 93 coordinator browser records with no recorded selection/legacy mismatches. Those observations were not replayed. The recorded 233 unit / 128 HTML / lint / type / plain build results remain prior coordinator results; this review did not rerun or claim those checks. No rebuild, dependency installation, hosted inference, network request, lead submission, site/vault edit, baseline mutation, deployment, or production action occurred.

## Remaining limits

Privacy stays **OPEN / UNAVAILABLE**: native hash timing risk, loaded-runtime modifier-click finding, collector/submission interception and granted/withdrawn runtime behavior remain unresolved or unverified. Export/source assertions and existing browser records cannot prove provider traffic exclusion. Production release, actual rollback, Google external planes, live SEO/indexing, snapshot publication and vault lifecycle closure remain unrun or unavailable per the closure packet. This PASS does not authorize or unblock release.
