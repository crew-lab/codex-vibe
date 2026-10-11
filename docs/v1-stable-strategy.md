# Reduced first-release strategy

The intended first stable product scope is one bounded review or isolated edit through the pinned Vibe programmatic interface. Its public MCP surface contains exactly five tools and one active slot per owning server/storage instance. Same-session correction, interactive grants, ACP, queueing, session recovery, and idle sessions are excluded. No Vibe version or platform beyond the current tested pins is supported until compatibility and acceptance gates pass; macOS Apple silicon is the first target, not a current support claim.

The runtime must retain strict canonical workspace allowlists, detached Git worktrees, private child homes, explicit environment filtering, Vibe source/signature validation, one-shot prompt-file handoff, bounded execution/output, owner locking, atomic persistence, non-replay restart behavior, independent patch review, and verified cleanup.

The operator path selects the artifact and config, initializes the selected config with `allow` if it does not exist, runs explicit doctor, prepares and verifies a reviewed baseline before connecting, checks the actual handshake and five-tool catalog, runs one bounded task, verifies its result, and closes safely. Doctor does not establish authentication or connection identity. Dirty baseline snapshots are created only in a private coordinator-owned repository and do not modify the original checkout.

## Release gates

1. Local lint, typecheck, build, TypeScript/Python tests, acceptance, secret scan and SBOM pass.
2. Offline packaging and installed-package smoke verify the exact executable version and five-tool catalog.
3. Candidate-specific hosted acceptance completes five total runs: one initial review, one initial edit, then three additional sequential review or edit runs. Stop at the first failure; retain logs/artifacts, independently verify exports, and account for cleanup.
4. Native Codex checks observe the five-tool catalog, one useful task, close, and disconnect while a run is active.
5. The documented workflow installs cleanly in a fresh macOS Apple silicon account.
6. The release suite and offline installed-package smoke pass on the declared minimum Node.js 20.19.0, in addition to the current development runtime.

No hosted spend, installation, publication, user-global config change, or platform certification is implied by source implementation. Record exact artifact/source hashes, selected configuration and baseline provenance, checks actually run, and every unknown outcome. Previous release evidence is version-bound in `docs/history/`.
