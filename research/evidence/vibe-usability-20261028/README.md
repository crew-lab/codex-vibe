# Skill workflow tests — 2026-10-28

Source base: `939ba8a860e5fad5fd682d0dc7f061bda048aa0a`. Source changes are coordinator skill/docs only; `candidate-source-sha256.json` binds the four changed product files. `product.patch` is their delta. No distribution was rebuilt. Hosted tests used connected candidate `65dbafd0700891c72978e35df8a599a1c110ba37d13ff68bb19a3004cbe1e716`, supervisor 2.2.1, Vibe 3.0.2, Node 24.21.0. Evidence does not transfer to changed package bytes.

The request JSON copies replace private paths; their sanitized bytes differ from the private original hashes in `frozen-inputs.json`. Grant identifiers and receipts are omitted. Export copies have sanitized paths and recomputed local SHA256SUMS. Original private exports remain unchanged. `review-result-selected.json` contains selected result fields, not a transcript.

## Checks

- Review: five comparison cases and seeded equality defect; result and export in `review/` plus selected native result. Input integrity verified; two read calls.
- Edit round 1: original patch and failed node:test log preserved. Function passes independent cases, but worker test cannot import default from named export. Rejected assessment remains in export.
- Coordinator diagnostic correction: one import changed only in a separate copy; nine tests and 14 semantic cases passed. Not integrated or described as Vibe success.
- Edit round 2: same frozen contract and oracle, corrected task wording. `edit-round2/` preserves exact unmodified patch and accepted assessment. Node 24.21.0 test logs show nine worker tests and 14 independent cases.
- Skill validator, TOML parse, 14 local links/anchors, diff check passed. Fresh independent verifier returned VERIFIED under explicit owner permission Amendment 3; see independent-verification.md.

All three runs closed. `final-readiness-selected.json` records prepared/eligible connection and free slot. Both dirty edit worktrees retained by the supervisor with explicit reasons, keeping patches reproducible. No patch was applied to product source, no commit/push/publication performed, no account or pin change. Hosted runtime labels/costs are reported only as observed in exports, not as proof of underlying weights or authoritative charges.

## Next steps

Independent EDD acceptance completed. Verified source is retained durably; discoverable skill link activated with rollback and byte readback. See activation.json and post-activation-readiness.json. Broader real-task testing remains a reliability measurement, not a claim established by these small fixtures. Release/package and nested-effect gates remain separate.
