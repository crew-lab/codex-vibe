# rc.28 target acceptance — 2026-10-13

Exact local build and acceptance outcomes are recorded in target-acceptance.json. This archive is distinct from the preparing machine's archive. Frozen source and runtime were unchanged during the hosted tests.

Five fixture matrix cases passed: normal review, independently verified edit, review/edit max_turn_requests classification, and a final normal review. The real-project review executed and closed safely but failed answer acceptance; no repaired patch is counted as a Vibe success.

Desktop disconnect case 6 is INCONCLUSIVE: the worker completed before supervisor interruption. It was closed; its dirty exported worktree was retained as designed. Case 7 (official-client disconnect) remains NOT RUN. No automatic retry occurred. One previously authorized allowance remains; it does not authorize retrying case 6. Native readiness/inference do not prove active-disconnect behavior or stable v1.0.

The independent edit verifier and read-only disconnect observer are coordinator tools. They are not shipped runtime changes, an OS sandbox or permission to execute unreviewed source. Offline tests are synthetic and do not certify hosted lifecycle.

The public packet omits private project source patches, GSC records, credentials and readiness receipts. Machine-specific paths in copied run records are replaced with placeholders; artifact hashes still identify original private artifacts. Source and evidence remain separate identities.
