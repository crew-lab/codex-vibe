# Integration test preflight — 2026-10-28

Result: STOPPED before hosted dispatch.

Fixture baseline: d0ce8a966690dc80e8feffb36796452f7987692f. The fixture is clean and contains the specified requirement and deliberate boundary defect.

Connected supervisor: 2.2.1, candidate 65dbafd0700891c72978e35df8a599a1c110ba37d13ff68bb19a3004cbe1e716, version-matched preparation passed, active slot free, no restart required. The fixture is not allowlisted; no configuration change was made.

Repaired source-tree CLI copy-only preflight: FAILED with `VSUP_INTERNAL: Unsafe artifact`. Diagnosis: the coordinator-created preflight patch has mode 0644. `src/reporting/private-files.ts` rejects files with any group or other permissions. This is a coordinator input-permission error; it does not demonstrate a validation helper defect. No retry was attempted in accordance with the request.

No grant or hosted start was made. Acceptance contract, review, edit, exported patch, independent behavior and mutation checks were not executed. Original project checkout was not modified.
