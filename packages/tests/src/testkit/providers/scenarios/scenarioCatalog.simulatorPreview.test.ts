import { describe, expect, it } from 'vitest';

import { scenarioCatalog } from './scenarioCatalog';
import type { ProviderUnderTest } from '../types';

const codexProvider: ProviderUnderTest = {
  id: 'codex',
  enableEnvVar: 'HAPPIER_E2E_CODEX',
  protocol: 'codex',
  traceProvider: 'codex',
  scenarioRegistry: {
    v: 1,
    tiers: {
      smoke: [],
      extended: [],
    },
  },
  cli: {
    subcommand: 'codex',
  },
};

describe('scenarioCatalog simulator preview scenarios', () => {
  it('defines an iOS simulator preview start scenario that asks Codex to call the iOS MCP tool', () => {
    const scenario = scenarioCatalog.simulator_preview_ios_start(codexProvider);

    expect(scenario.id).toBe('simulator_preview_ios_start');
    expect(scenario.prompt).toBeDefined();
    if (!scenario.prompt) {
      throw new Error('expected iOS simulator preview scenario prompt');
    }
    expect(scenario.prompt({ workspaceDir: '/tmp/workspace' })).toContain('happier_simulator_preview_ios_start');
    expect(scenario.requiredTraceSubstrings).toEqual(expect.arrayContaining([
      'happier_simulator_preview_ios_start',
      'iPhone 15 Pro',
      'stream.mjpeg',
    ]));
  });
});
