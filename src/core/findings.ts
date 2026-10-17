import { createHash } from 'node:crypto';
import type {
  FindingsArtifact,
  FindingSeverity,
  RejectedFinding,
  ReviewFinding
} from '../contracts.js';
import type { WorkspaceSnapshot } from './workspace-snapshot.js';
import type { ExclusionSpec } from '../security/globs.js';
import { judgeWorkspacePath } from '../backends/app-server/approvals.js';

export const FINDINGS_OUTPUT_CONTRACT = `
### Output Format Contract
Conclude your review with a fenced JSON block containing your structured findings:
\`\`\`json
{
  "version": 1,
  "findings": [
    {
      "ruleId": "category-or-rule-id",
      "message": "Concise description of the finding",
      "location": {
        "path": "relative/path/to/file.ext",
        "startLine": 1,
        "endLine": 1
      },
      "severity": "warning"
    }
  ]
}
\`\`\`
`.trim();

export function extractFindingsJsonBlock(text: string): { findings: unknown[]; rawJson?: string } | null {
  if (!text || typeof text !== 'string') return null;

  // Search for fenced JSON code block first (```json ... ``` or ``` ... ```)
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  const candidates: string[] = [];

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const content = match[1]?.trim();
    if (content && (content.startsWith('{') || content.startsWith('['))) {
      candidates.push(content);
    }
  }

  // Iterate candidates from last to first (models typically place the final output at the end)
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidate = candidates[i];
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) {
        return { findings: parsed, rawJson: candidate };
      }
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.findings)) {
          return { findings: obj.findings, rawJson: candidate };
        }
      }
    } catch {
      // Continue to next candidate
    }
  }

  // Fallback: search for bare trailing JSON object with "findings" key
  const findingsKeyIndex = text.lastIndexOf('"findings"');
  if (findingsKeyIndex !== -1) {
    const candidateStart = text.lastIndexOf('{', findingsKeyIndex);
    if (candidateStart !== -1) {
      const candidate = text.slice(candidateStart).trim();
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (parsed && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;
          if (Array.isArray(obj.findings)) {
            return { findings: obj.findings, rawJson: candidate };
          }
        }
      } catch {
        const lastCloseBrace = candidate.lastIndexOf('}');
        if (lastCloseBrace !== -1) {
          try {
            const sub = candidate.slice(0, lastCloseBrace + 1);
            const parsed = JSON.parse(sub) as unknown;
            if (parsed && typeof parsed === 'object') {
              const obj = parsed as Record<string, unknown>;
              if (Array.isArray(obj.findings)) {
                return { findings: obj.findings, rawJson: sub };
              }
            }
          } catch {
            // Ignore
          }
        }
      }
    }
  }

  return null;
}

export async function validateFindings(options: {
  rawFindings: unknown[];
  workspace: string;
  snapshot?: WorkspaceSnapshot | undefined;
  excluded?: readonly ExclusionSpec[] | undefined;
}): Promise<FindingsArtifact> {
  const { rawFindings, workspace, snapshot, excluded = [] } = options;
  const validated: ReviewFinding[] = [];
  const rejected: RejectedFinding[] = [];

  for (const raw of rawFindings) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      rejected.push({ raw, reason: 'schema_invalid' });
      continue;
    }

    const item = raw as Record<string, unknown>;
    const rawMessage = typeof item.message === 'string' ? item.message.trim() : '';
    if (!rawMessage) {
      rejected.push({ raw, reason: 'schema_invalid' });
      continue;
    }

    const rawLocation = item.location;
    if (!rawLocation || typeof rawLocation !== 'object' || Array.isArray(rawLocation)) {
      rejected.push({ raw, reason: 'schema_invalid' });
      continue;
    }

    const loc = rawLocation as Record<string, unknown>;
    const rawPath = typeof loc.path === 'string' ? loc.path.trim() : '';
    const startLine = typeof loc.startLine === 'number' && Number.isInteger(loc.startLine) ? loc.startLine : NaN;

    if (!rawPath || Number.isNaN(startLine) || startLine < 1) {
      rejected.push({ raw, reason: 'schema_invalid' });
      continue;
    }

    const endLine = typeof loc.endLine === 'number' && Number.isInteger(loc.endLine) ? loc.endLine : undefined;
    if (endLine !== undefined && endLine < startLine) {
      rejected.push({ raw, reason: 'line_out_of_bounds' });
      continue;
    }

    const startColumn = typeof loc.startColumn === 'number' && Number.isInteger(loc.startColumn) && loc.startColumn >= 1 ? loc.startColumn : undefined;
    const endColumn = typeof loc.endColumn === 'number' && Number.isInteger(loc.endColumn) && loc.endColumn >= 1 ? loc.endColumn : undefined;

    // Safety and workspace containment check
    const judgement = await judgeWorkspacePath(workspace, rawPath, excluded);
    if (!judgement.allowed) {
      let reason: RejectedFinding['reason'] = 'file_not_found';
      if (judgement.reason === 'path_reserved') reason = 'path_reserved';
      else if (judgement.reason === 'path_secret') reason = 'path_secret';
      else if (judgement.reason === 'path_excluded') reason = 'path_excluded';
      else if (judgement.reason === 'path_outside_workspace') reason = 'path_outside_workspace';
      else if (judgement.reason === 'path_symlink') reason = 'path_symlink';
      rejected.push({ raw, reason });
      continue;
    }

    const relative = judgement.relative;
    const segments = relative.split(/[\\/]+/).map((s) => s.toLowerCase());
    if (segments.includes('.gemini')) {
      rejected.push({ raw, reason: 'path_reserved' });
      continue;
    }

    // Check against workspace snapshot if provided
    if (snapshot) {
      const entry = snapshot.manifest.get(relative);
      if (!entry || entry.kind !== 'F') {
        rejected.push({ raw, reason: 'file_not_found' });
        continue;
      }
    }

    const ruleId = typeof item.ruleId === 'string' && item.ruleId.trim() ? item.ruleId.trim() : 'review/finding';
    const severityCandidate = typeof item.severity === 'string' ? item.severity.toLowerCase() : '';
    const severity: FindingSeverity =
      severityCandidate === 'error' || severityCandidate === 'warning' || severityCandidate === 'info' || severityCandidate === 'hint'
        ? severityCandidate
        : 'warning';

    const id = typeof item.id === 'string' && item.id.trim()
      ? item.id.trim()
      : createHash('sha256').update(`${ruleId}:${relative}:${startLine}:${rawMessage}`).digest('hex').slice(0, 16);

    validated.push({
      id,
      ruleId,
      message: rawMessage,
      location: {
        path: relative,
        startLine,
        ...(endLine !== undefined ? { endLine } : {}),
        ...(startColumn !== undefined ? { startColumn } : {}),
        ...(endColumn !== undefined ? { endColumn } : {})
      },
      severity
    });
  }

  const summary = {
    total: validated.length,
    errors: validated.filter((f) => f.severity === 'error').length,
    warnings: validated.filter((f) => f.severity === 'warning').length,
    info: validated.filter((f) => f.severity === 'info').length,
    hints: validated.filter((f) => f.severity === 'hint').length,
    rejected: rejected.length
  };

  return {
    version: 1,
    findings: validated,
    rejected,
    summary
  };
}
