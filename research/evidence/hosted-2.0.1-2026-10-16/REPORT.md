# Hosted acceptance — 2026-10-16

**Stopped after one of three authorized hosted starts.** The review completed with end_turn and verified read-only integrity, but its actual final answer failed the required comparison cases. The edit and disconnect runs were not started. No retry or fallback was used.

## Exact outcome

Supervisor 2.0.1, frozen source 44dc6f8, candidate `8b1b7dd556ea985e27f9886b31d2fea7952861c831f2b24e22f273a64dba93a4`; review run `5d12adfe-27c5-42ce-9d7a-de713bb5c197`. A new public synthetic two-file fixture was clean at `c8c255cbb838b541b11d01983551a84d945ca457`, under the already allowed Supervisor repository. No allowlist or policy change was needed. Limits: 12 turns, 180 seconds. Native readiness passed immediately before dispatch.

The complete worker final answer, inspected through vibe_result, reports the sequence `false, false, true, true, false` for the five explicitly ordered inputs. This is not a summary-only assessment. Independent execution of the unchanged fixture returns:

| Input | Expected / executed | Worker reported |
|---|---|---|
| (699, 700) | false | false |
| (700, 700) | false | false |
| (701, 700) | true | true |
| (-3, -2) | false | true |
| (-1, -2) | true | false |

Coordinator decision: rejected for incorrect negative-number results. The overall conclusion that the source implements the contract is correct; the required case evaluation is not. No implementation patch exists, and no patch/contract assessment was fabricated for the review-only close.

## Observations and cleanup

- Two read_file events executed. No write, unapproved effect or changed fixture file was observed; probe.txt does not exist. These observations support the handler half of permission-ask enforcement when combined with the earlier exact-candidate configuration evidence.
- The final answer reports `tools.file_system.writeFile is not a function`. There is no denied nested-write event in the complete event sequence. Nested permission gating remains NOT EXERCISED; this error does not prove a successful permission-denial test or that run_typescript was invoked.
- One diagnostic reports 21 ignored notifications: runtime/updated and session/updated; zero stale events and zero foreign-session notifications. No handoff or turn-retry diagnostic was recorded.
- The lexical watcher counts grew from zero to three and later returned to zero. It records counts only, never content. Configuration field names and other stored text may contain this word, so this cannot establish reasoning generation. Thinking-off effect remains unverified; no additional hosted run was used to improve observation.
- Run closed successfully; no worktree existed for this review. Source status is clean, no worker process remains, and no tmp, child-home or vibe-home directories remain in the run. Native post-close readiness passes with a free slot.

## Reported model and usage

Runtime alias mistral-medium-3.5; reported name mistral-vibe-cli-latest; thinking off. Session model, provider and underlying weights were not reported. Usage: 14,382 prompt tokens, 60 completion tokens, zero cached tokens, three model calls. Runtime-price estimate USD 0.022023, not an authoritative bill. Total reported duration 5,768 ms; turn count, inference-only duration and startup duration unavailable.

The official export is preserved unchanged in review/. Its post-close execution.state is unknown even though native status and result explicitly observed completed/end_turn; started timestamp is also null. COORDINATOR-ASSESSMENT.json preserves the observed lifecycle separately. These are reporting findings, not proof of worker failure or a reason to rewrite the export. No raw transcript, reasoning, credential or readiness receipt was copied into evidence.

## Remaining work

Hosted review/edit confirmation and disconnect gates remain unverified. The review correctness failure prevents proceeding in this sitting under the deterministic stop rule; two authorized starts were left unused. Inspect the worker/probe and reporting findings before proposing another bounded test. Do not silently retry this assignment, consume another allowance or mark the candidate fully accepted. This sitting made no Supervisor runtime changes, push, merge, publication or deployment.
