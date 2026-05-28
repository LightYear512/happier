import { describe, expect, it } from 'vitest';

import { resolveScenarioCliEnv } from './scenarioCliEnv';

describe('resolveScenarioCliEnv', () => {
  it('applies scenario CLI env after provider env has been resolved', () => {
    expect(
      resolveScenarioCliEnv({
        scenario: {
          cliEnv: {
            HAPPIER_CODEX_BACKEND_MODE: 'appServer',
            HAPPIER_EXPERIMENTAL_CODEX_ACP: '0',
          },
        },
        workspaceDir: '/tmp/workspace',
        cliHome: '/tmp/home',
      }),
    ).toEqual({
      HAPPIER_CODEX_BACKEND_MODE: 'appServer',
      HAPPIER_EXPERIMENTAL_CODEX_ACP: '0',
    });
  });

  it('resolves functional scenario CLI env and skips blank entries', () => {
    expect(
      resolveScenarioCliEnv({
        scenario: {
          cliEnv: ({ workspaceDir, cliHome }) => ({
            WORKSPACE_DIR: workspaceDir,
            CLI_HOME: cliHome,
            EMPTY: '',
            BLANK: '   ',
            '': 'ignored',
          }),
        },
        workspaceDir: '/tmp/workspace-a',
        cliHome: '/tmp/home-a',
      }),
    ).toEqual({
      WORKSPACE_DIR: '/tmp/workspace-a',
      CLI_HOME: '/tmp/home-a',
    });
  });

  it('returns an empty override for scenarios without CLI env', () => {
    expect(
      resolveScenarioCliEnv({
        scenario: {},
        workspaceDir: '/tmp/workspace-b',
        cliHome: '/tmp/home-b',
      }),
    ).toEqual({});
  });
});
