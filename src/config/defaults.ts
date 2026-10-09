import type { SupervisorConfig } from "../contracts.js";

export const DEFAULT_CONFIG: SupervisorConfig = {
  version: 1,
  backend: "programmatic",
  allowedWorkspaceRoots: [],
  maxConcurrentRuns: 2,
  workerIdleTtlSeconds: 600,
  retention: { days: 7 },
  limits: {
    reviewTimeoutSeconds: 1800,
    editTimeoutSeconds: 2400,
    maxTurnsReview: 20,
    maxTurnsEdit: 20,
    maxEventBytes: 52_428_800,
    maxTranscriptBytes: 10_485_760,
    maxArtifactBytes: 104_857_600,
    workerProgressTimeoutSeconds: 600,
    maxMcpResultChars: 8000
  }
};
