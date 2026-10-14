import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';
import type { SupervisorConfig } from '../../../src/contracts.js';

export const TEST_CONFIG: SupervisorConfig = { ...DEFAULT_CONFIG, paths: { vibePinManifest: '/unused/vibe-pin-manifest.json' } };
