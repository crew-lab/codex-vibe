export const LEDGER_SCHEMA_VERSION = 2;

function names(entries) {
  return entries.map((entry) => entry.gate);
}

export function supportedBuild(ledger) {
  const build = ledger.builds.find((candidate) => candidate.label === ledger.supported_release);
  if (!build) throw new Error(`docs/acceptance.json names supported release ${ledger.supported_release} but has no build with that label.`);
  return build;
}

export function buildAcceptanceReport({ ledger, checks, generatedAt }) {
  if (ledger.schema_version !== LEDGER_SCHEMA_VERSION) throw new Error(`docs/acceptance.json schema_version ${ledger.schema_version} is not ${LEDGER_SCHEMA_VERSION}.`);
  const supported = supportedBuild(ledger);
  return {
    schema_version: 2,
    generated_at: generatedAt,
    deterministic_checks: checks,
    supported_release: ledger.supported_release,
    open_gates: supported.open.map(({ gate, why }) => ({ name: gate, reason: why })),
    builds: ledger.builds.map((build) => ({
      label: build.label,
      archive_sha256: build.archive_sha256 ?? null,
      candidate_sha256: build.candidate_sha256 ?? null,
      recorded_on: build.recorded_on,
      observed: names(build.observed),
      open: names(build.open)
    }))
  };
}
