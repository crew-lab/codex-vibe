import { createHash } from 'node:crypto';
import type { FindingsArtifact, FindingSeverity, ReviewFinding } from '../contracts.js';
import { APP_VERSION } from '../version.js';

export interface SarifRegion {
  startLine: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
}

export interface SarifArtifactLocation {
  uri: string;
  uriBaseId?: string;
}

export interface SarifPhysicalLocation {
  artifactLocation: SarifArtifactLocation;
  region: SarifRegion;
}

export interface SarifLocation {
  physicalLocation: SarifPhysicalLocation;
}

export type SarifLevel = 'error' | 'warning' | 'note' | 'none';

export interface SarifRule {
  id: string;
  shortDescription?: { text: string };
  defaultConfiguration?: {
    level: SarifLevel;
  };
}

export interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: { text: string };
  locations: SarifLocation[];
  partialFingerprints?: Record<string, string>;
}

export interface SarifRun {
  tool: {
    driver: {
      name: 'vibe-supervisor';
      version?: string;
      informationUri?: string;
      rules: SarifRule[];
    };
  };
  results: SarifResult[];
}

export interface SarifLog {
  $schema: 'https://json.schemastore.org/sarif-2.1.0.json';
  version: '2.1.0';
  runs: SarifRun[];
}

export function severityToSarifLevel(severity: FindingSeverity): SarifLevel {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
    case 'hint':
      return 'note';
    default:
      return 'warning';
  }
}

export function computeFindingFingerprint(finding: ReviewFinding): string {
  const normalizedPath = finding.location.path.replace(/\\/g, '/');
  return createHash('sha256')
    .update(`${finding.ruleId}:${normalizedPath}:${finding.location.startLine}`)
    .digest('hex');
}

export function convertFindingsToSarif(findingsArtifact: FindingsArtifact): SarifLog {
  const rulesMap = new Map<string, SarifRule>();
  const results: SarifResult[] = [];

  for (const finding of findingsArtifact.findings) {
    const level = severityToSarifLevel(finding.severity);
    if (!rulesMap.has(finding.ruleId)) {
      rulesMap.set(finding.ruleId, {
        id: finding.ruleId,
        shortDescription: { text: `Vibe Supervisor Finding: ${finding.ruleId}` },
        defaultConfiguration: { level }
      });
    }

    const fingerprint = computeFindingFingerprint(finding);
    const normalizedUri = finding.location.path.replace(/\\/g, '/');

    const region: SarifRegion = {
      startLine: finding.location.startLine,
      ...(finding.location.endLine !== undefined ? { endLine: finding.location.endLine } : {}),
      ...(finding.location.startColumn !== undefined ? { startColumn: finding.location.startColumn } : {}),
      ...(finding.location.endColumn !== undefined ? { endColumn: finding.location.endColumn } : {})
    };

    results.push({
      ruleId: finding.ruleId,
      level,
      message: { text: finding.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: normalizedUri,
              uriBaseId: '%SRCROOT%'
            },
            region
          }
        }
      ],
      partialFingerprints: {
        'vibeSupervisorFinding/v1': fingerprint
      }
    });
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'vibe-supervisor',
            version: APP_VERSION,
            informationUri: 'https://github.com/crew-lab/codex-vibe',
            rules: [...rulesMap.values()]
          }
        },
        results
      }
    ]
  };
}
