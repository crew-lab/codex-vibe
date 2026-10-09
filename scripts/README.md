# Scripts

Release, soak and coordinator tooling. Nothing here ships in the npm package. Scripts import the compiled supervisor from `dist/`, so run `npm run build` first; `VIBE_SUPERVISOR_DIST_DIR` selects another build directory.

## Reviewed baseline and edit audit

A detached edit starts at the base ref, so dirty source changes are not copied. The coordinator prepares reviewed changes before inference with `prepare-reviewed-baseline.mjs`, then audits the settled run offline with `audit-edit-run.mjs`. Use the returned `source_workspace` and `base_ref`, bind the original reviewed baseline by hashes, and never ask the model to recreate baseline files from pasted diffs or modify a live worker worktree.


`node scripts/prepare-reviewed-baseline.mjs --help` prints JSON help without reading configuration. Extra arguments with `--help` are refused.

`node scripts/prepare-reviewed-baseline.mjs manifest.json [--create]` reads an owner-private JSON manifest with `source`, `baseRef`, `outputParent`, and `entries`, plus optional `publicTemplates`. Each entry has a relative `path`, `operation` (add/replace/delete), `baseSha256` (null for additions), `reviewedSha256` (null for deletions), and `mode` (100644/100755 for writes). Selected content comes from the source, never from an embedded patch. Dry-run is the default. Explicit creation makes local commits only in a new disposable snapshot repository. Existing source files/index/refs and config stay unchanged. The output parent must be owner-private and inside an existing allowed root, outside the source.

Bounds: 64 overlays, 4096 base/final files, 2 MiB per file, 100 MiB total tree. Overlays must be regular UTF-8 text; binary base blobs are permitted within bounds. Sensitive filenames/recognized credentials, links/submodules, ignored/reserved overlays, conflicting/case-colliding paths and external Git filters are refused. Tracked AGENTS/.agents in the base retain discovery isolation. The output manifest is owner-read-only and hash-bound. Failed creations retain an owner-private output and sanitized code/stage receipt for explicit recovery; no uncertain deletion/replay is attempted.

`node scripts/audit-edit-run.mjs canonical-private-home run-id [--files /absolute/private/scope.json]` reads settled pinned-Vibe ACP edit evidence safely and returns only allowlisted counts/classes, creator version and recognized stop reason. It makes no model request and changes no permissions. Missing or incompatible evidence returns unverified. This script does not certify candidate behavior, all task scope, billing, restart or other hosted gates.

Audit scope evidence: `argument_scope` describes only declared tool-call paths when a coordinator supplies a scope list directly to the module. `declared_scope` remains `unverified`: actual candidate/export and symlink targets require independent review. The script supplies that list only with an explicit `--files` owner-private JSON file: 1–64 unique repository-relative strings, each at most 1024 characters. Absolute, empty/dot/traversal, leading-dash components, backslash, control and colon paths are rejected. With a scope list, `status` is `validated` only when `argument_scope` is `within_declared_arguments`: a write outside the list, a write whose path cannot be read, or a successful call to any tool other than read, search and file edits makes the report `unverified` and the script exit non-zero. `policy_denial_events` counts the supervisor's policy denials and the backend's refused permission requests; a call gets the `policy_denied` class when the denial names its tool-call ID, which the backend refusal does and the supervisor denial, keyed by request ID, does not. Ancestor ownership/write permissions and identities are checked before/after reads, with root-owned sticky temporary directories permitted. These application checks do not resist malicious concurrent mutation by another process running as the same account.

## Public templates and preparation diagnostics

Default sensitive-filename refusal is unchanged. Optional `publicTemplates: [{"path": ".env.example", "sha256": "<64 lowercase hex characters>"}]` approves only that exact root filename and binds the effective reviewed bytes. A deleted template or a stale hash is refused. Template content must be UTF-8, pass the existing credential/sentinel scan, and use the restricted inert dotenv grammar. Non-sensitive literals are limited to `true`, `false`, `development`, `production`, `test`, `debug`, `info`, `warn` and `error`. Sensitive assignments may contain only empty values or bounded `${VAR}`, `<KEY>` and `YOUR_KEY` placeholders. Arbitrary URLs, quoted literals and unrecognized values are refused. Assignment-shaped comments and URL userinfo in comments are also refused; ordinary descriptive comments remain allowed. No nested example, real `.env`/`.envrc`, private-key file or other reserved path is exempted. This coordinator option does not change worker permissions.

Example (compute the actual hash; do not paste the placeholder):

```json
{
  "source": "/canonical/allowed/source",
  "baseRef": "<immutable Git ref>",
  "outputParent": "/canonical/allowed/private-output",
  "entries": [{"path":"README.md","operation":"replace","baseSha256":"<base SHA256>","reviewedSha256":"<reviewed SHA256>","mode":"100644"}],
  "publicTemplates": [{"path":".env.example","sha256":"<effective template SHA256>"}]
}
```

CLI failures emit one JSON diagnostic on stderr, with nonzero exit and no raw exception/configuration/file contents. Codes are stable for this script (not additional MCP error codes):

| Code | Stage | Action |
| --- | --- | --- |
| VSBASE_CONFIG_INVALID | config | Validate the explicitly selected configuration. |
| VSBASE_SCHEMA_INVALID | schema | Correct the private manifest shape. |
| VSBASE_INPUT_INVALID | input | Check invocation and manifest operations. |
| VSBASE_PATH_REFUSED | path | Check canonical roots, paths and links. |
| VSBASE_SENSITIVE_FILENAME_REFUSED | sensitive_filename | Preserve the refusal; review any public-template declaration. |
| VSBASE_SENSITIVE_CONTENT_REFUSED | sensitive_content | Remove unsafe input from scope; do not suppress the scan. |
| VSBASE_HASH_MISMATCH | hash | Freeze and review fresh exact bytes before updating hashes. |
| VSBASE_OUTPUT_OWNERSHIP_FAILED | output_ownership | Check existing private parent ownership/permissions. |
| VSBASE_UNEXPECTED_FAILURE | unexpected | Retain evidence; investigate without exposing raw causes. |

A failed creation retains `failure.json` under its new private output. When available, `retained_output_id` identifies the fixed-prefix basename under the manifest's declared parent; it exposes no arbitrary parent path. Dry-run rejection creates no snapshot output. Scripts are not packaged: install the source dependencies offline and build first, or use the documented compiled-runtime selection with resolvable pinned dependencies. Record script/runtime/configuration identities separately.
