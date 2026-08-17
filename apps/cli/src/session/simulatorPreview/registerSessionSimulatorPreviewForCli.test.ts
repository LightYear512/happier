import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveBoxPublicKeyFromSeed } from '@happier-dev/protocol';

import { reloadConfiguration } from '@/configuration';
import { clearDaemonStateForTests } from '@/persistence';
import { resetInMemoryAccountSettingsContextForTests } from '@/settings/accountSettings/bootstrapAccountSettingsContext';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';

import { registerSessionSimulatorPreviewForCli } from './registerSessionSimulatorPreviewForCli';

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to resolve server address');
  return address.port;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

describe('registerSessionSimulatorPreviewForCli', () => {
  const envKeys = ['HAPPIER_SERVER_URL', 'HAPPIER_WEBAPP_URL', 'HAPPIER_HOME_DIR'] as const;
  let envScope = createEnvKeyScope(envKeys);
  let apiServer: Server | null = null;
  let happyHomeDir = '';
  const committedMessages: Record<string, unknown>[] = [];

  beforeEach(async () => {
    resetInMemoryAccountSettingsContextForTests();
    committedMessages.length = 0;
    happyHomeDir = await createTempDir('happier-cli-simulator-preview-register-');

    const sessionId = 'sess_simulator_preview_register_123';
    const metadataPlain = JSON.stringify({
      path: '/tmp/android-project',
      host: 'host1',
      machineId: 'machine-local',
    });

    apiServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

      if (req.method === 'GET' && url.pathname === '/v2/account/settings') {
        sendJson(res, 200, {
          version: 1,
          content: {
            t: 'plain',
            v: {
              experiments: true,
              featureToggles: {
                'sessions.devPreview': true,
              },
            },
          },
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === `/v2/sessions/${sessionId}`) {
        sendJson(res, 200, {
          session: {
            id: sessionId,
            seq: 1,
            createdAt: 1,
            updatedAt: 2,
            active: false,
            activeAt: 0,
            metadata: metadataPlain,
            metadataVersion: 0,
            agentState: JSON.stringify({ controlledByUser: false, requests: {} }),
            agentStateVersion: 0,
            pendingCount: 0,
            pendingVersion: 0,
            dataEncryptionKey: null,
            encryptionMode: 'plain',
            share: null,
          },
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === `/v2/sessions/${sessionId}/messages`) {
        const body = await readJsonBody(req);
        committedMessages.push(body);
        sendJson(res, 200, {
          didWrite: true,
          message: {
            id: 'msg-simulator-preview-1',
            seq: 2,
            localId: typeof body.localId === 'string' ? body.localId : null,
            createdAt: 3,
          },
        });
        return;
      }

      res.statusCode = 404;
      res.end();
    });

    const apiPort = await listen(apiServer);
    envScope.patch({
      HAPPIER_SERVER_URL: `http://127.0.0.1:${apiPort}`,
      HAPPIER_WEBAPP_URL: 'http://127.0.0.1:3000',
      HAPPIER_HOME_DIR: happyHomeDir,
    });
    reloadConfiguration();
  });

  afterEach(async () => {
    resetInMemoryAccountSettingsContextForTests();
    await clearDaemonStateForTests();
    if (apiServer) {
      await new Promise<void>((resolve, reject) => apiServer!.close((error) => (error ? reject(error) : resolve())));
      apiServer = null;
    }
    if (happyHomeDir) {
      await removeTempDir(happyHomeDir);
      happyHomeDir = '';
    }
    envScope.restore();
    envScope = createEnvKeyScope(envKeys);
    reloadConfiguration();
  });

  it('commits a simulator preview structured transcript message', async () => {
    const machineKeySeed = new Uint8Array(32).fill(9);

    const result = await registerSessionSimulatorPreviewForCli({
      credentials: {
        token: 'token_test',
        encryption: {
          type: 'dataKey',
          publicKey: deriveBoxPublicKeyFromSeed(machineKeySeed),
          machineKey: machineKeySeed,
        },
      },
      accountSettings: {
        experiments: true,
        featureToggles: {
          'sessions.devPreview': true,
        },
      } as any,
      idOrPrefix: 'sess_simulator_preview_register_123',
      platform: 'android',
      deviceName: 'Pixel 8',
      appName: 'Android Preview Fixture',
      streamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
      mode: 'ai_control',
      owner: 'ai',
      connectionPath: 'direct',
    });

    expect(result).toMatchObject({
      ok: true,
      sessionId: 'sess_simulator_preview_register_123',
      preview: {
        platform: 'android',
        deviceName: 'Pixel 8',
        streamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
      },
    });
    expect(committedMessages).toHaveLength(1);
    const committedContent = committedMessages[0]?.content as any;
    expect(committedContent?.t).toBe('plain');
    expect(committedContent?.v?.role).toBe('user');
    expect(committedContent?.v?.meta?.happier?.kind).toBe('simulator_preview.v1');
    expect(committedContent?.v?.meta?.happier?.payload).toMatchObject({
      sessionId: 'sess_simulator_preview_register_123',
      platform: 'android',
      deviceName: 'Pixel 8',
      appName: 'Android Preview Fixture',
      streamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
      mode: 'ai_control',
      owner: 'ai',
      connectionPath: 'direct',
    });
  });
});
