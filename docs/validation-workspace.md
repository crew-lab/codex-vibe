# Reproducible validation workspaces

`vibe-supervisor validation prepare --source /canonical/repository --base FULL_COMMIT --patch /private/diff.patch --out /private/new-validation --manager /absolute/npm-or-pnpm --cache /populated/cache`

The helper creates independent Git baseline/candidate copies outside the source and worker checkout. It uses the immutable base and exact patch bytes, disables Git hooks/global configuration, filters child environment, and verifies the installed manager version against an exact project packageManager pin. It never commits or changes the source checkout. The output parent must be canonical and owner-private; output must not exist.

Dependencies install from a private copy of a populated cache with offline/frozen options and lifecycle scripts disabled. pnpm project hooks and side-effect caches are disabled. Project manager configuration, workspace hooks, local/Git dependency specifications and packages marked as requiring build scripts currently produce explicit blockers; support needs a reviewed preparation profile. No automatic fetch, script approval or substitute manager is attempted. Node and manager versions, base/patch hashes and dependency disposition are recorded in a private manifest. `--no-install` creates copies only and records dependencies as not-requested; it does not imply build readiness.

The helper is not a project command runner: lint, build, measurement and browser checks remain deliberate coordinator actions with their own evidence. Dependencies must resolve within the validation root; external links and unsupported filesystem entries block preparation. Copying and inspection have file/byte/time/output limits.

`vibe-supervisor validation clean /canonical/validation` removes only an owned workspace whose root identity and complete content fingerprint still match its manifest. Additional files, project validation output, changed files, links outside the root or uncertain ownership cause retention for inspection. Failed preparations are retained and must be inspected manually. This conservative cleanup may retain disposable build output; it never removes a source checkout or Vibe worktree.
