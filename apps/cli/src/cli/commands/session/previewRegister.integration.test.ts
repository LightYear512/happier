import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveBoxPublicKeyFromSeed } from '@happier-dev/protocol';

import { reloadConfiguration } from '@/configuration';
import { clearDaemonState, writeDaemonState } from '@/persistence';
import { resetInMemoryAccountSettingsContextForTests } from '@/settings/accountSettings/bootstrapAccountSettingsContext';
import { captureConsoleJsonOutput } from '@/testkit/logger/captureOutput';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';

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
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve server address');
  }
  return address.port;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

describe('happier session preview register', () => {
  const envKeys = ['HAPPIER_SERVER_URL', 'HAPPIER_WEBAPP_URL', 'HAPPIER_HOME_DIR'] as const;
  let envScope = createEnvKeyScope(envKeys);
  let apiServer: Server | null = null;
  let daemonServer: Server | null = null;
  let happyHomeDir = '';
  const committedMessages: Record<string, unknown>[] = [];
  const daemonRequests: Record<string, unknown>[] = [];

  beforeEach(async () => {
    resetInMemoryAccountSettingsContextForTests();
    committedMessages.length = 0;
    daemonRequests.length = 0;
    happyHomeDir = await createTempDir('happier-cli-preview-register-');

    const sessionId = 'sess_preview_register_123';
    const metadataPlain = JSON.stringify({
      path: '/tmp/preview-project',
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
            id: 'msg-preview-1',
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

    daemonServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (req.method === 'POST' && url.pathname === '/dev-preview/register') {
        const body = await readJsonBody(req);
        daemonRequests.push(body);
        sendJson(res, 200, {
          success: true,
          preview: {
            resourceId: 'preview_manual_1',
            sessionId,
            machineId: 'machine-local',
            port: body.port,
            url: body.url,
            origin: body.origin,
            name: body.name,
            framework: body.framework,
            source: 'manual',
            registeredAtMs: 10,
            health: { status: 'ready', checkedAtMs: 11 },
            preview: {
              rewriteUrls: body.rewriteUrls,
              supportsWebSocket: true,
              routeKey: 'route_manual_1',
              initialPath: '/ai-console/develop/',
            },
          },
        });
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    const [apiPort, daemonPort] = await Promise.all([
      listen(apiServer),
      listen(daemonServer),
    ]);

    envScope.patch({
      HAPPIER_SERVER_URL: `http://127.0.0.1:${apiPort}`,
      HAPPIER_WEBAPP_URL: 'http://127.0.0.1:3000',
      HAPPIER_HOME_DIR: happyHomeDir,
    });
    reloadConfiguration();
    writeDaemonState({
      pid: process.pid,
      httpPort: daemonPort,
      startedAt: Date.now(),
      startedWithCliVersion: 'test',
      controlToken: 'control-token',
      machineId: 'machine-local',
    });
  });

  afterEach(async () => {
    resetInMemoryAccountSettingsContextForTests();
    await clearDaemonState();
    if (apiServer) {
      await new Promise<void>((resolve, reject) => apiServer!.close((error) => (error ? reject(error) : resolve())));
      apiServer = null;
    }
    if (daemonServer) {
      await new Promise<void>((resolve, reject) => daemonServer!.close((error) => (error ? reject(error) : resolve())));
      daemonServer = null;
    }
    if (happyHomeDir) {
      await removeTempDir(happyHomeDir);
      happyHomeDir = '';
    }
    envScope.restore();
    envScope = createEnvKeyScope(envKeys);
    reloadConfiguration();
  });

  it('registers a manual preview through the daemon and commits a structured transcript message', async () => {
    const { handleSessionCommand } = await import('./index');
    const output = captureConsoleJsonOutput();

    try {
      const machineKeySeed = new Uint8Array(32).fill(8);
      await handleSessionCommand(
        [
          'preview',
          'register',
          'sess_preview_register_123',
          '--url',
          'http://127.0.0.1:5173/ai-console/develop/',
          '--name',
          'Manual preview',
          '--framework',
          'vite',
          '--no-rewrite-urls',
          '--json',
        ],
        {
          readCredentialsFn: async () => ({
            token: 'token_test',
            encryption: {
              type: 'dataKey',
              publicKey: deriveBoxPublicKeyFromSeed(machineKeySeed),
              machineKey: machineKeySeed,
            },
          }),
        },
      );

      const parsed = output.json();
      if (parsed.ok !== true) {
        throw new Error(`Unexpected session_preview_register envelope: ${JSON.stringify(parsed)}`);
      }
      expect(parsed).toMatchObject({
        ok: true,
        kind: 'session_preview_register',
        data: {
          sessionId: 'sess_preview_register_123',
          resourceId: 'preview_manual_1',
          routeKey: 'route_manual_1',
          port: 5173,
        },
      });
      expect(daemonRequests).toEqual([
        {
          sessionId: 'sess_preview_register_123',
          expectedMachineId: 'machine-local',
          port: 5173,
          url: 'http://127.0.0.1:5173/ai-console/develop/',
          name: 'Manual preview',
          framework: 'vite',
          rewriteUrls: false,
        },
      ]);
      expect(committedMessages).toHaveLength(1);
      const committedContent = committedMessages[0]?.content as any;
      expect(committedContent?.t).toBe('plain');
      expect(committedContent?.v?.role).toBe('user');
      expect(committedContent?.v?.meta?.happier?.kind).toBe('local_service_preview.v1');
      expect(committedContent?.v?.meta?.happier?.payload?.preview?.routeKey).toBe('route_manual_1');
      expect(committedContent?.v?.meta?.happier?.payload?.preview?.initialPath).toBe('/ai-console/develop/');
    } finally {
      output.restore();
    }
  });
});
