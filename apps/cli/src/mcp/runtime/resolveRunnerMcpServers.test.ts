import { describe, expect, it, vi } from 'vitest';
import { accountSettingsParse } from '@happier-dev/protocol';
import type { Credentials } from '@/persistence';
import type { HappyMcpSessionClient } from '@/mcp/startHappyServer';

const { createHappierMcpBridgeMock } = vi.hoisted(() => ({
  createHappierMcpBridgeMock: vi.fn(async () => ({
    happierMcpServer: { url: 'http://127.0.0.1:4000', stop: () => undefined },
    mcpServers: {
      happier: {
        command: 'node',
        args: ['built-in'],
      },
    },
  })),
}));

vi.mock('@/agent/runtime/createHappierMcpBridge', () => ({
  createHappierMcpBridge: createHappierMcpBridgeMock,
}));

import { resolveRunnerMcpServers } from './resolveRunnerMcpServers';

function createTestSession(): HappyMcpSessionClient {
  return {
    sessionId: 'session-1',
    rpcHandlerManager: {
      registerHandler: () => undefined,
      invokeLocal: async () => undefined,
    },
    sendClaudeSessionMessage: () => undefined,
    updateMetadata: () => undefined,
  };
}

function createLegacyCredentials(): Credentials {
  return {
    token: 'token_1',
    encryption: {
      type: 'legacy',
      secret: new Uint8Array(32).fill(7),
    },
  };
}

describe('resolveRunnerMcpServers', () => {
  it('passes runner credentials and account settings into the built-in Happier MCP bridge', async () => {
    const session = createTestSession();
    const credentials = createLegacyCredentials();
    const accountSettings = accountSettingsParse({
      actionsSettingsV1: {
        v: 1,
        actions: {
          'session.list': { disabledSurfaces: [] },
        },
      },
    });

    await resolveRunnerMcpServers({
      session,
      credentials,
      accountSettings,
      machineId: 'machine-1',
      directory: '/tmp/repo',
      env: {},
      tmpDir: null,
    });

    expect(createHappierMcpBridgeMock).toHaveBeenCalledWith(session, expect.objectContaining({
      credentials,
      accountSettings,
    }));
  });

  it('applies session metadata mcpSelection to managed MCP materialization', async () => {
    const result = await resolveRunnerMcpServers({
      session: createTestSession(),
      credentials: createLegacyCredentials(),
      accountSettings: accountSettingsParse({
        mcpServersSettingsV1: {
          v: 1,
          strictMode: false,
          servers: [
            {
              id: 'portable-playwright',
              name: 'playwright',
              transport: 'stdio',
              stdio: { command: 'node', args: ['playwright.js'] },
              env: {},
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: 'workspace-db',
              name: 'db',
              transport: 'stdio',
              stdio: { command: 'node', args: ['db.js'] },
              env: {},
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          bindings: [
            {
              id: 'binding-portable',
              serverId: 'portable-playwright',
              enabled: true,
              target: { t: 'allMachines' },
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: 'binding-workspace',
              serverId: 'workspace-db',
              enabled: true,
              target: { t: 'workspace', machineId: 'machine-1', workspaceRoot: '/tmp/repo' },
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
      }),
      sessionMetadata: {
        mcpSelectionV1: {
          v: 1,
          managedServersEnabled: false,
          forceIncludeServerIds: ['portable-playwright'],
          forceExcludeServerIds: [],
        },
      },
      machineId: 'machine-1',
      directory: '/tmp/repo',
      env: {},
      tmpDir: null,
    });

    expect(Object.keys(result.mcpServers).sort()).toEqual(['happier', 'playwright']);
    expect(result.mcpServers.playwright).toMatchObject({
      command: 'node',
      args: ['playwright.js'],
    });
    expect(result.mcpServers.db).toBeUndefined();
  });

  it('can keep built-in Happier MCP feature gates without loading configured MCP servers', async () => {
    const accountSettings = accountSettingsParse({
      actionsSettingsV1: {
        v: 1,
        actions: {},
      },
      mcpServersSettingsV1: {
        v: 1,
        strictMode: false,
        servers: [
          {
            id: 'portable-playwright',
            name: 'playwright',
            transport: 'stdio',
            stdio: { command: 'node', args: ['playwright.js'] },
            env: {},
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        bindings: [
          {
            id: 'binding-portable',
            serverId: 'portable-playwright',
            enabled: true,
            target: { t: 'allMachines' },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    });

    const result = await resolveRunnerMcpServers({
      session: createTestSession(),
      credentials: createLegacyCredentials(),
      accountSettings,
      machineId: 'machine-1',
      directory: '/tmp/repo',
      env: {},
      tmpDir: null,
      includeConfiguredMcpServers: false,
    });

    expect(createHappierMcpBridgeMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      accountSettings,
    }));
    expect(Object.keys(result.mcpServers)).toEqual(['happier']);
  });
});
