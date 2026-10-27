# Prepared task inputs

`vibe-supervisor task prepare` creates an owner-private, versioned copy of a bounded set of reviewed repository files. `vibe-supervisor task verify` checks the manifest, current full base commit, required source bytes, provenance, and private copied bytes. These commands prepare and verify context for an explicitly bound edit dispatch.

Use a canonical Git root, an immutable full commit hash, and explicit comma-separated file paths:

```text
vibe-supervisor task prepare --source <canonical-root> --base <full-commit> --files <path,...> --out <new-private-directory> [--output-paths <path,...>] [--contract <json>] --config <selected-config>
vibe-supervisor task verify --dir <prepared-directory> --config <selected-config> [--files <path,...>]
```

The default allowed output paths are exactly the selected input paths. `--output-paths` may narrow or replace that list with other explicitly reviewed safe repository-relative paths. An optional acceptance contract is validated and its canonical digest is recorded. The manifest records source root, full base commit, each file's digest, byte length and committed/dirty-tracked/untracked provenance, a digest over the selected dirty overlay, allowed output paths, optional contract digest, totals and `token_count: null`. No tokenizer is run, so token count remains unavailable.

The profile accepts at most 12 UTF-8 text files, 128 KiB total, and 100 allowed output paths. It rejects unsafe or reserved paths, configured exclusions, symlinks, hardlinks, foreign-owned files, merge conflicts, credential-shaped content, non-private output parents, and stale or changed input. Preparation copies exact working-tree bytes, including explicitly selected dirty and untracked files; it never writes to the source checkout or active worker. Output is a new directory and existing destinations are refused.

Prepared content is untrusted input. A `vibe_edit_start` request may bind `{ directory, manifest_sha256 }` as `prepared_inputs`; the supervisor verifies the private copy inventory, source/base, selected allowed roots and exclusions, current policy revision, acceptance-contract digest, and output paths before launching a provider. Read-only committed or dirty prepared files enter the initial task as quoted untrusted context with their provenance. A dirty prepared file that overlaps an editable output is rejected before provider launch; no dirty content is overlaid into the detached worker. The run and result retain the manifest digest. This does not change tool permissions, workspace allowlists, model configuration, shell/network policy, or claim hosted acceptance.

## Preparation diagnostics and delivery references

Before creating a bundle, preparation checks output placement, private-parent ownership, contract readability/schema, selected-file Git discovery and path policy, and reports these problems together. It never repairs permissions, changes ignore rules or stages source files. Use a new output directory outside the checkout under a canonical owner-private parent (0700), and an acceptance-contract file with owner-only access (0600). Explicitly selected untracked files are supported; ignored files are refused with a specific diagnostic. Put reviewed non-sensitive evidence in a non-ignored document rather than exposing ignored private material.

Quoted prepared inputs are context, not files overlaid into the worker tree. Classify each input as context-only or also a delivery reference in the task text. If generated documentation cites a local input, that target must exist in the reconstructed delivery tree; otherwise cite a stable source URL or label the input as private evidence without a broken local link. The coordinator checks local file targets, anchors and external sources separately and reports which checks ran. A file-target check alone proves neither anchors nor source support.

For research tasks, inventory shared components, metadata, structured data and source datasets before assigning claim coverage. Acceptance should check observation/review dates, evidence for product-behavior assertions and unsupported operational claims. Save incremental specialist handoffs on interruption. These are coordinator checks, not worker permissions or proof of understanding.
