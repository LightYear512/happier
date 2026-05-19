import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { openAccountScopedBlobCiphertext } from '@happier-dev/protocol';

import { upsertEncryptedAccountSettingsV2 } from './accountSettings';

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
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

describe('upsertEncryptedAccountSettingsV2', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => server!.close((error) => (error ? reject(error) : resolve())));
      server = null;
    }
  });

  it('seals settings with dataKey account material', async () => {
    const postedBodies: Record<string, unknown>[] = [];
    server = createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/v2/account/settings') {
        sendJson(res, 200, { version: 7, content: null });
        return;
      }
      if (req.method === 'POST' && req.url === '/v2/account/settings') {
        postedBodies.push(await readJsonBody(req));
        sendJson(res, 200, { success: true });
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    const port = await listen(server);
    const machineKey = new Uint8Array(32).fill(6);
    const settings = {
      experiments: true,
      featureToggles: {
        'sessions.devPreview': true,
      },
    };

    await upsertEncryptedAccountSettingsV2({
      baseUrl: `http://127.0.0.1:${port}`,
      token: 'token-1',
      material: { type: 'dataKey', machineKey },
      settings,
    });

    const postedBody = postedBodies[0];
    expect(postedBody).toBeDefined();
    if (!postedBody) {
      throw new Error('Expected account settings request body to be posted');
    }
    expect(postedBody.expectedVersion).toBe(7);
    const content = postedBody.content as { t?: unknown; c?: unknown } | undefined;
    expect(content?.t).toBe('encrypted');
    expect(typeof content?.c).toBe('string');
    const opened = openAccountScopedBlobCiphertext({
      kind: 'account_settings',
      material: { type: 'dataKey', machineKey },
      ciphertext: String(content?.c ?? ''),
    });
    expect(opened?.value).toEqual(settings);
  });
});
