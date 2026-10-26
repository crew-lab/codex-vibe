# ADR 0010: one authorization-bound dispatch attempt

Status: implemented locally; target qualification pending.

## Decision

The stable Supervisor exposes five MCP tools and runs one-shot tasks on exactly Vibe 3.0.2. Continuation and the sixth tool are deferred. Historical correction records remain readable; archived source checkpoints preserve that experiment.

An owner-authorized coordinator registers one task through the administrative `task authorize` CLI. A private request document contains `operation` (`review` or `edit`) and `request` with the corresponding start parameters, without authorization identifiers or transport fields. The command requires the selected configuration, an owner-instruction reference and an explicit UTC expiry no more than 24 hours ahead, so a grant cannot outlive the instruction it records. It returns `authorization_id`, `attempt_id`, `request_sha256` and `expires_at` without starting a worker or acquiring the live server's storage lock. One registration permits one attempt. Registering grants is a trusted administrative act, not independent authentication of a human instruction; a task request already authorizes necessary task-scoped preparation and does not need another routine confirmation.

The request digest binds the canonical workspace, operation, task digest, resolved edit commit or review workspace content (the bytes, symlink targets and executable bits of the files Git does not ignore, or of every file outside a Git work tree; timestamps and inodes are not bound, so a touched file or Git-ignored build output does not spend an attempt), context-file digests, output mode, acceptance-contract digest, prepared-input manifest, effective limits, policy revision, backend, candidate archive contents, Node executable/version/platform and current pin-manifest digest. A missing pin is represented explicitly; a grant does not establish preparation or pin validity. Runtime pin and preparation enforcement remain mandatory at backend launch.

Both start tools require the returned identifiers. Readiness receipts prove a connection's preparation check and are not dispatch authorizations. After validating admission and the request digest, the Supervisor creates an exclusive private consumption record, synchronizes its contents and containing directories, then creates its run record and worker worktree. All isolated sessions using the selected configuration share the grant directory. A competing consumer receives `VSUP_ATTEMPT_CONSUMED`; incomplete reservation files also block reuse. Policy and input digests are checked again immediately before backend launch.

Grant and consumption records use immutable private files. They survive ordinary run retention, close, cancellation, startup failure, process crashes and restart. No cleanup operation refunds an attempt. Storage uncertainty fails closed. A later owner instruction may authorize a fresh grant for the same task; task hashes are not permanently banned. There is no duplicate-dispatch bypass and no automatic grant creation through MCP.

## Boundaries and evidence

The shared private data root is the ledger boundary; choosing a different root creates a separate administrative domain. A user able to rewrite private local state can defeat this accounting. The control is application policy, not an operating-system sandbox or a global provider allowance tracker.

Ordinary review workspaces remain live. Digest checks detect changes at registration, admission and launch; they cannot prevent changes during inference. Prepared task inputs provide immutable verified prompt overlays. Neither a grant nor a matching digest freezes the whole workspace or makes a worker patch accepted.

Run metadata and sanitized exports carry `dispatch.grant_id`, `attempt_id` and `request_sha256`. They carry no raw grant document, readiness receipt, credential or private history. Safe identifiers deliberately avoid credential-named persistence fields; credential filtering is unchanged. Older records without dispatch fields remain readable but do not authorize new work.

Deterministic tests cover grant validation, expiry, binding mismatch, concurrent consumption in separate processes, retained consumption after failure/restart, identifier persistence, strict five-tool registration and unexpected continuation cleanup. They do not establish hosted answer quality, native Desktop readiness or release acceptance. Changed artifacts require a new matched preparation check.
