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
