import { describe, expect, it } from 'vitest';

import { seedScenarioAccountSettings, type ScenarioAccountSettingsContext } from './scenarioAccountSettings';

describe('seedScenarioAccountSettings', () => {
  it('writes static scenario account settings with the test auth secret', async () => {
    const calls: unknown[] = [];

    const seeded = await seedScenarioAccountSettings({
      scenario: {
        accountSettings: {
          experiments: true,
          featureToggles: {
            'sessions.devPreview': true,
          },
        },
      },
      baseUrl: 'http://127.0.0.1:3000',
      token: 'token-1',
      secret: new Uint8Array([1, 2, 3]),
      workspaceDir: '/tmp/workspace',
      cliHome: '/tmp/home',
      upsert: async (params) => {
        calls.push(params);
      },
    });

    expect(seeded).toBe(true);
    expect(calls).toEqual([
      {
        baseUrl: 'http://127.0.0.1:3000',
        token: 'token-1',
        secret: new Uint8Array([1, 2, 3]),
        settings: {
          experiments: true,
          featureToggles: {
            'sessions.devPreview': true,
          },
        },
      },
    ]);
  });

  it('resolves functional scenario account settings from workspace context', async () => {
    const calls: unknown[] = [];

    const seeded = await seedScenarioAccountSettings({
      scenario: {
        accountSettings: ({ workspaceDir, cliHome }: ScenarioAccountSettingsContext) => ({
          workspaceDir,
          cliHome,
        }),
      },
      baseUrl: 'http://127.0.0.1:3001',
      token: 'token-2',
      secret: new Uint8Array([4, 5, 6]),
      workspaceDir: '/tmp/workspace-a',
      cliHome: '/tmp/home-a',
      upsert: async (params) => {
        calls.push(params.settings);
      },
    });

    expect(seeded).toBe(true);
    expect(calls).toEqual([
      {
        workspaceDir: '/tmp/workspace-a',
        cliHome: '/tmp/home-a',
      },
    ]);
  });

  it('skips scenarios without account settings', async () => {
    const seeded = await seedScenarioAccountSettings({
      scenario: {},
      baseUrl: 'http://127.0.0.1:3002',
      token: 'token-3',
      secret: new Uint8Array([7, 8, 9]),
      workspaceDir: '/tmp/workspace-b',
      cliHome: '/tmp/home-b',
      upsert: async () => {
        throw new Error('unexpected upsert');
      },
    });

    expect(seeded).toBe(false);
  });
});
