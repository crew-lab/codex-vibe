import type { SupervisorConfig } from "../contracts.js";

export const DEFAULT_CONFIG: SupervisorConfig = {
  version: 1,
  backend: "programmatic",
  allowedWorkspaceRoots: [],
  maxConcurrentRuns: 2,
  maxQueuedRuns: 8,
  workerIdleTtlSeconds: 600,
  retention: { days: 7, preserveFailedRuns: true },
  limits: {
    reviewTimeoutSeconds: 1800,
    editTimeoutSeconds: 2400,
    maxTurnsReview: 12,
    maxTurnsEdit: 20,
    maxEventBytes: 52_428_800,
    maxTranscriptBytes: 10_485_760,
    maxArtifactBytes: 104_857_600,
    maxMcpResultChars: 8000,
    mcpResultFormat: "text"
  }
};
