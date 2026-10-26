# ADR 0009: supervised same-session corrections

Status: deferred historical experiment. The stable five-tool one-shot contract in [ADR 0010](0010-dispatch-attempt-authorization.md) supersedes this proposal. Its implementation was removed from the source in 2.1.1 and remains in Git history; it is not an active configuration option. Records it created stay readable.

## Context

The current Supervisor contract is one-shot work on Vibe 2.26.1. A correction flow would let a reviewer assess the original result and, when justified, ask Vibe to revise it while retaining the original run's isolation and limits. A source review of Vibe 3.0.2 found the app-server primitives for repeated turns, mediated approvals, effective configuration read-back, and ephemeral session storage, but the version remains unqualified pending its no-inference checks and target acceptance in [the compatibility assessment](../compatibility-v3.md).

## Decision

The next-minor design keeps the default one-shot behavior. A separately selected opt-in correction flow may allow at most two corrections. It may be implemented only after a supported Vibe version proves that the supervisor can retain every preventive control listed in the compatibility assessment and can continue the existing session without resetting or replaying work.

After the original turn closes, the run enters `awaiting_validation`. A correction request uses a `vibe_continue` operation bound to the original run, revision number, and current patch hash. The request carries the original contract and scope. It retains the same model, permissions, cumulative deadline, token limit, model-call limit, and cost limit. The active slot remains owned until the correction flow closes. Each accepted revision increments the revision number and binds the resulting patch hash; the correction count cannot exceed two.

Human validation is explicit per revision. There is no human blanket-grant API. A correction cannot elevate the tool profile, workspace scope, or approval outcome. Existing permission callbacks, event validation, configuration read-back, workspace checks, private directories, and cleanup remain in force.

Reasoning remains off disk, including exports. High thinking may be considered only if source review and no-inference evidence establish that reasoning is excluded from logs, private stores, exports, telemetry, and error reports throughout correction and recovery.

Restart, worker failure, deadline exhaustion, budget exhaustion, or an uncertain continuation state fails the run and never replays or resumes it automatically. If Vibe cannot preventively preserve any required control across continuation, this feature is refused until an ADR records a different safe design. Terminal automation is outside this decision.

## Consequences

The local opt-in lifecycle, protocol continuation, persistence, event, export, and recovery contracts are implemented with fake-backend and fake-protocol coverage. These checks establish local behavior only and do not establish hosted behavior. The active runtime profile remains Vibe 2.26.1. Vibe 3.0.2 has an explicit experimental candidate selector, exact pin binding and matching preparation requirement, but remains unqualified for dispatch until its target no-inference qualification is complete; its monetary limits are refused until price provenance is qualified.
