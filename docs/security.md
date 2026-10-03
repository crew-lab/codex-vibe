# Security model

The supervisor limits access through canonical allowed roots, strict private data directories, minimal child environments, managed process groups, bounded streams, redaction, and explicit run-state transitions. Edits execute in detached worktrees. Export verifies the patch and changed-file records before cleanup; changed or ignored content causes cleanup to refuse.

On hosts that deny process-group signaling, shutdown falls back to signaling the supervisor's direct child only. In that case the direct child is managed, but cleanup of its process group/grandchildren remains unverified and must not be reported as fully confirmed.

These are application controls. There is no kernel sandbox, syscall filter, network namespace, or guarantee against vulnerabilities in Vibe, Node, Git, plugins, or the host. Treat delegated work as code execution with the permissions of the local account. Keep shell/network disabled unless a deliberate profile allows them. Do not place credentials in task text or workspace files.

Persisted events and JSON are sanitized recursively; reasoning/private thought fields are omitted. Raw protocol streams are consumed internally and must not be logged. Patch files are not rewritten for redaction because that corrupts diffs: likely credential-bearing patches fail export and preserve the worktree for inspection.
