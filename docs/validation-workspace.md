# Reproducible validation workspaces

`vibe-supervisor validation prepare --source /canonical/repository --base FULL_COMMIT --patch /private/diff.patch --out /private/new-validation --manager /absolute/npm-or-pnpm --cache /populated/cache`

The helper creates independent Git baseline/candidate copies outside the source and worker checkout. It uses the immutable base and exact patch bytes, disables Git hooks/global configuration, and filters child environment. When installing dependencies, it verifies the manager version against an exact project packageManager pin. It never commits or changes the source checkout. The output parent must be canonical and owner-private; output must not exist.

The selected patch is caller input, not supervisor state. Ordinary owned, canonical, single-link regular files with mode `0644`, `0640` or `0600` are accepted when group/other write permissions are absent. The tool reads a bounded, identity-checked byte snapshot without chmodding the original. A linked, foreign, writable-by-others, changed or oversized input is rejected with a specific input error. The output parent remains canonical and owner-private (`0700`); the output root must not exist. Internal manifests and exported artifacts retain strict private-state validation. See [artifact handling](artifact-handling.md).

Dependencies install from a private copy of a populated cache with offline/frozen options and lifecycle scripts disabled. pnpm project hooks and side-effect caches are disabled. Project manager configuration, workspace hooks, local/Git dependency specifications and packages marked as requiring build scripts currently produce explicit blockers; support needs a reviewed preparation profile. No automatic fetch, script approval or substitute manager is attempted. Node and manager versions, base/patch hashes and dependency disposition are recorded in a private manifest. `--no-install` creates copies only and records dependencies as not-requested; it requires no package manifest, manager pin, lockfile or cache and never executes a package manager, even if `--manager` is supplied. It does not imply build readiness. Omit `--manager` and `--cache` for copy-only preparation.

For a generic Git project without dependency installation:

```sh
vibe-supervisor validation prepare --source /canonical/repository --base FULL_COMMIT --patch /private/diff.patch --out /private/new-validation --no-install
```

The helper is not a project command runner: lint, build, measurement and browser checks remain deliberate coordinator actions with their own evidence. Dependencies must resolve within the validation root; external links and unsupported filesystem entries block preparation. Copying and inspection have file/byte/time/output limits.

`vibe-supervisor validation clean /canonical/validation` removes only an owned workspace whose root identity and complete content fingerprint still match its manifest. Additional files, project validation output, changed files, links outside the root or uncertain ownership cause retention for inspection. Failed preparations are retained and must be inspected manually. This conservative cleanup may retain disposable build output; it never removes a source checkout or Vibe worktree.


## Explicit coordinator test profile

```sh
vibe-supervisor validation check --dir VALIDATION_ROOT --tests discount.test.mjs --id behavior --out PRIVATE_REPORT.json --timeout-seconds 30
```

The fixed `node-test` profile first verifies the owned copy manifest/fingerprint, then executes the selected candidate JavaScript test paths using the current Node executable and `--test`. No arbitrary command or shell field exists. It filters the child environment, bounds time(1–120seconds) and combined output(256KiB), and terminates the process group on timeout/overflow. Both output files are exclusively reserved before test execution. A hard termination grace bounds completion when inherited output pipes remain open; cleanup uncertainty is explicitly reported. Detached descendants can escape process-group cleanup, so no OS-level isolation is claimed. The output is an export-compatible hash-bound validation manifest; the sibling `.evidence.json` contains sanitized diagnostics and exact profile identity. A failing test yields a failed validation with retained diagnostics. Output paths must be new and outside the copies under a private parent.

This is explicit coordinator code execution with coordinator OS privileges, not an OS sandbox or a worker permission. Execute only tests within the owner's authorized scope. The profile never proves all contract semantics or automatically accepts a patch; use independently chosen cases and an original-bug negative control. Tests may change their copies; fingerprint-based cleanup then retains them for inspection. Reprepare fresh copies before another profile execution. No automatic install/network fallback occurs.
