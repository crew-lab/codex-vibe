# Coordinator helper

`prepare-reviewed-baseline.mjs` is a source-checkout-only coordinator helper for preserving reviewed dirty or untracked inputs in a private disposable snapshot. It is not shipped in the package and does not call a model or server.

Run a dry run with the explicitly selected configuration:

```sh
node scripts/prepare-reviewed-baseline.mjs /absolute/private/manifest.json --config /absolute/path/to/config.toml
```

The manifest is private JSON (owner read/write only) with this strict shape. For `add`, `baseSha256` is `null`; for `replace`, both hashes are required; for `delete`, `reviewedSha256` is `null` and `mode` is omitted. Hashes are SHA-256 of the exact file bytes. `mode` is the reviewed file's Git mode.

```json
{
  "source": "/absolute/path/to/source-repository",
  "baseRef": "HEAD",
  "outputParent": "/private/path/for/private-snapshot-output",
  "entries": [
    {
      "path": "src/new-file.ts",
      "operation": "add",
      "baseSha256": null,
      "reviewedSha256": "<sha256-of-reviewed-bytes>",
      "mode": "100644"
    },
    {
      "path": "src/changed-file.ts",
      "operation": "replace",
      "baseSha256": "<sha256-at-baseRef>",
      "reviewedSha256": "<sha256-of-reviewed-bytes>",
      "mode": "100644"
    },
    {
      "path": "src/removed-file.ts",
      "operation": "delete",
      "baseSha256": "<sha256-at-baseRef>",
      "reviewedSha256": null
    }
  ]
}
```

Replace every path and hash placeholder with actual values before running the helper. For example, obtain a base-file hash with `git show 'HEAD:path/to/file' | shasum -a 256` and a reviewed-file hash with `shasum -a 256 /absolute/path/to/source-repository/path/to/file`. The source tree must already reflect the reviewed add/replace/delete operations; the helper never changes it. Create the JSON file with mode `0600` in an owner-private directory. The full input contract is also in [`schemas/reviewed-baseline-manifest.schema.json`](../schemas/reviewed-baseline-manifest.schema.json).

The receipt includes a `manifest_sha256`, selected configuration/runtime provenance, source HEAD/index/ref invariants, selected input inventory, hashes, and modes. For snapshot creation, pass the dry-run digest back explicitly:

```sh
node scripts/prepare-reviewed-baseline.mjs /absolute/private/manifest.json --config /absolute/path/to/config.toml --create --expect-manifest-sha256 <manifest_sha256>
```

Creation writes only to the coordinator-owned private snapshot repository. It does not stage, commit, or change refs in the original checkout. Independently verify the complete snapshot and returned `base_ref` before starting an edit. If source bytes or refs changed since dry-run, preparation must refuse the stale manifest. Failure receipts identify the failed stage and exact retained or removed helper-owned resources.

Other release scripts run deterministic lint, type, build, test, acceptance, secret-scan, SBOM, checksum, and offline installed-package smoke checks. They do not run hosted inference or prove native desktop registration, clean-account installation, or platform support.
