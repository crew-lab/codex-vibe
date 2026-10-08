# Deployment ACP field lessons — 2026-10-08

Source: the user-provided `4k-trans/output/reports/deployment-fix-vibe-acp-report-2026-10-08.md`, read on 2026-10-08. This note summarizes reported observations; private runtime records and hosted behavior were not independently replayed here. The deployment remained incomplete because AWS authentication expired.

## Observations

The reported runtime was Supervisor rc.4, Vibe 2.25.8, ACP, mistral-medium-3.5. It does not validate the rc.7 fixes. Two runs recorded 85 worker calls, about 771 seconds of session elapsed time including coordinator pauses, and approximately USD 0.94 estimated provider cost. Cached repeated inputs dominate the token totals; contribution percentage and time savings are unavailable.

The first run exhausted its budget without a patch; a same-session continuation remained exhausted. The second produced a five-file candidate with three correction rounds and a cleanup continuation. Export/application integrity and worktree removal were reported successful. The coordinator corrected a denied-invalidation exit-status bug and ran verification; worker execution claims were not accepted with shell disabled. The official client retained a process handle after connection close and required stopping its own interactive client.

## Prioritized follow-up

1. Reproduce ACP turn-budget exhaustion and continuation on the current tested package using a synthetic fixture. Record per-turn stop reasons, budget behavior and whether a small correction can actually run. Distinguish expected pinned Vibe behavior from a supervisor defect before changing runtime code. Never replay an uncertain task or silently increase limits.
2. Reproduce official MCP client shutdown after start/continue/close. Separate client-owned handles from supervisor/worker processes; require bounded exit and identify the owner of any residue before terminating it. The field report alone does not prove a supervisor leak.
3. Use exact owned files and available read/write/search tools in worker prompts. Say the coordinator executes tests. Require summaries to distinguish proposed checks from executed checks. Existing ACP skill guidance already states this; examine whether installed skill/version and the actual task prompt carried it before adding duplicate instructions.
4. For shell/deployment helpers, the coordinator should validate fake executable substitution and denied-command/nonzero-exit behavior before executing candidate tests, with cloud credentials excluded. Keep worker shell/network disabled. Keep IAM writes and deployment with the authorized coordinator.
5. Run the separately scoped 60/30/10 hosted soak on the patched rc.7 package. Preserve both original failures; the field task is useful experience, not a replacement for that release gate.

No source or skill changes are justified solely by this report. No hosted rerun, deployment, configuration change or new acceptance claim was performed while recording these lessons.
