# Local trial runbook

This runbook prepares a minimal backend-specific trial. It is not a release acceptance report and starts no worker. Antigravity dispatch stays blocked until a supported agy (1.4.7 or 1.4.8) has a matching preparation PASS with all five probes passing; the built-in skill catalogue is pinned in ADR 0008. Hosted allowance is zero. Keep the selected registration unchanged until those gates are resolved.

## Prepared assets

- [Review prompt](local-trial/review.txt): strict comparison, five labeled inputs and source references.
- [Edit prompt](local-trial/edit.txt): exactly two new files implementing and testing `atLeast`.
- [Edit acceptance contract](local-trial/acceptance-contract.json): exact changed-file scope and required coordinator validations.
- [Fixture verifier](../scripts/fixture-verify.mjs): checks edit semantics in a disposable export outside any Git checkout.

The local fixture is an owned clone at `<supervisor-repository>/tmp/local-trial-fixture-20261023`, detached at the existing arithmetic commit `c83c01e`. It has only `CONTRACT.md` and `src/limit.mjs` tracked, with no project instructions or extensions. The existing source fixture had unrelated untracked directories; they were not copied, changed or deleted. No new fixture commit was made. Before a run, confirm the full base hash, a clean working tree and file digests against the private trial-readiness manifest. A missing or changed fixture is a blocker, not permission to reset or repair it silently.

The expected review results, in prompt order, are `true`, `false`, `false`, `true`, `false`. Require the labels and input values, not just an unlabeled sequence. The edit verifier remains necessary: text assertions alone do not prove `>=` semantics.

## Phase A: compatibility and policy

1. Review the recovery patch and its complete verification evidence. Preserve failed trial archives and preparation reports.
2. Select an intact explicitly supported agy executable, or complete a version-bound compatibility review for the installed build. Record its version and digest. Do not append 1.4.6 to the allowlist merely to unblock a test.
3. Prove agy skills are disabled, or adopt an explicit ADR defining an exact pinned catalogue with identity/provenance checks and unchanged tool/path restrictions. `builtin: true` alone is not sufficient.
4. Keep each backend's preparation, configuration and data in separate private directories. Do not infer Antigravity acceptance from the default Vibe backend's evidence.

## Phase B: freeze and prepare

Use exactly Node 20.19.0/npm 10.8.2 and an owned real Git checkout with dependencies installed from a populated offline cache. Run `package:rc`, which includes full release verification, offline installation smoke and final archive/kit binding verification. Save the source commit and any uncommitted patch digest, archive SHA-256, kit checksums and candidate identity. A source snapshot without a new archive has no transferable preparation evidence.

Install that archive into a new private prefix with lifecycle scripts disabled and offline cache use. Independently compare the installed identity with the kit. Preserve the existing settings and roots, with separate pin/receipt/data locations and rollback. Resolve the fixture against existing allowed roots; these preparation assets authorize no broader root.

Select explicit absolute paths for `TRIAL_NODE`, `TRIAL_CLI`, `TRIAL_CONFIG` and `TRIAL_KIT`; the CLI must belong to the installed archive, not an executable selected by `npx` or the ambient PATH. Review the pin manifest and doctor output, then perform one matched check:

```sh
"$TRIAL_NODE" "$TRIAL_CLI" doctor --config "$TRIAL_CONFIG" --json
"$TRIAL_NODE" "$TRIAL_CLI" prepare check --kit "$TRIAL_KIT" --config "$TRIAL_CONFIG"
```

Stop after a deterministic failure. No retry, timing sweep, relaxed expectations, credential substitution or replay. Preparation uses its fixed fake key and local scripted model; never provide a real credential to make it pass. Read the saved report and every required control, rather than relying on a successful exit alone. Do not persist the readiness receipt in evidence.

## Phase C: registration and native readiness

After preparation PASS, inspect setup's dry-run diff, back up the existing registration and skill link, and change only Supervisor entries. Preserve rollback. Reconnect the desktop client, then call `vibe_status` against the exact fixture for review and edit (with its immutable `base_ref`), supplying the kit's candidate identity as `expected_candidate`.

Require the expected server version and candidate, matching preparation PASS, eligible workspace, no blockers, no restart drift, a free slot and the five-tool native catalogue. Registration, doctor, a CLI version or SDK initialization alone cannot establish this. If a user reconnect is required, mark native readiness pending. An existing registration must not be assumed to select 2.0.2; inspect and preserve the actual selection.

## Phase D: hosted trial, separately authorized

The owner must name the backend and authorize an allowance and budget before either start. Proposed bounds are one review and one edit, each 12 turns and 180 seconds, with no retry or third start. These are proposed limits, not a grant. Use only the supported authentication delivery path; do not put credentials in prompts, shell profiles or reports.

1. Freeze the prepared prompts and acceptance contract with their hashes. Keep the fixture base immutable. Get fresh readiness for each operation.
2. Run the review assignment once. Independently check all five results, source references, tool approvals/denials, execution state and integrity.
3. Run the edit assignment once with the contract and base. Inspect the complete exported patch. In an owned disposable export outside any Git checkout, run the fixture verifier and the generated `node:test` test file with a private environment. Account for all changed and residual files. Do not integrate the patch into the fixture or a real project.
4. Close after verification with the assessment bound to patch/contract hashes and validations `fixture-semantics`, `worker-tests` and `complete-diff`. Confirm process/private-directory cleanup before claiming the slot is free. Preserve rejected outputs; worker summary errors do not establish patch failure.
5. Export sanitized reports using `runs export`, optionally projected events and patch. Verify artifact hashes and save approval coverage, reported model/usage, unavailable observations, actual duration, backend/executable identity and cleanup outcome. Do not collect raw transcripts, reasoning, OAuth URLs, receipts or credentials.

A worker-quality rejection is separate from a supervisor failure. A deterministic supervisor failure stops the trial. No automatic fallback, replay, raised limits, live analytics, contact messages, publication, deployment or release promotion is included.

This minimal fixture does not contain an exclusion-probe file and has no disconnect sitting. Do not mark excluded-glob denial, disconnect, clean-account installation, another backend or another client as verified from this trial. Those need their own named fixtures, scope and evidence under the [target procedure](target-acceptance.md).
