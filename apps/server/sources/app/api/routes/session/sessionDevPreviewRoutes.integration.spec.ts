import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { auth } from '@/app/auth/auth';
import { db } from '@/storage/db';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import { enableErrorHandlers } from '@/app/api/utils/enableErrorHandlers';
import { enableServeUi } from '@/app/api/utils/enableServeUi';
import { buildHostNamespacePreviewHost } from '@/app/devPreview/previewHostNamespace';
import { createSessionDevPreviewToken } from '@/app/api/devPreview/sessionDevPreviewToken';

import { sessionRoutes } from './sessionRoutes';

const relayEnabledEnv = {
  HAPPIER_FEATURE_SESSIONS_DEV_PREVIEW_RELAY__ENABLED: '1',
} as const;

function createTestApp(forwardRpcForUser: (params: {
  userId: string;
  method: string;
  params: unknown;
  timeoutMs?: number;
}) => Promise<{ ok: true; result: unknown } | { ok: false; error: string; errorCode?: string }>) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const typed = app.withTypeProvider<ZodTypeProvider>() as any;

  typed.decorate('authenticate', async (request: any, reply: any) => {
    const authHeader = String(request.headers.authorization ?? '');
    if (!authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing authorization header' });
    }
    const token = authHeader.slice(7);
    const verified = await auth.verifyToken(token);
    if (!verified) {
      return reply.code(401).send({ error: 'Invalid token', code: 'invalid-token' });
    }
    request.userId = verified.userId;
  });
  typed.decorate('forwardRpcForUser', forwardRpcForUser);

  return typed;
}

describe('session dev preview routes (integration)', () => {
  let harness: LightSqliteHarness;

  beforeAll(async () => {
    harness = await createLightSqliteHarness({
      tempDirPrefix: 'happier-session-dev-preview-routes-',
      initAuth: true,
    });
  }, 120_000);

  afterAll(async () => {
    await harness.close();
  });

  afterEach(async () => {
    harness.resetEnv();
    await db.accessKey.deleteMany().catch(() => {});
    await db.session.deleteMany().catch(() => {});
    await db.machine.deleteMany().catch(() => {});
    await db.account.deleteMany().catch(() => {});
    vi.restoreAllMocks();
  });

  async function createFixture() {
    const account = await db.account.create({
      data: { publicKey: 'pk_preview_routes' },
      select: { id: true },
    });
    const machine = await db.machine.create({
      data: {
        id: 'machine_1',
        accountId: account.id,
        metadata: '{}',
      },
      select: { id: true },
    });
    const session = await db.session.create({
      data: {
        tag: 'preview-route-session',
        accountId: account.id,
        metadata: '{}',
      },
      select: { id: true },
    });
    await db.accessKey.create({
      data: {
        accountId: account.id,
        machineId: machine.id,
        sessionId: session.id,
        data: '{}',
      },
    });
    const token = await auth.createToken(account.id);
    return { accountId: account.id, machineId: machine.id, sessionId: session.id, token };
  }

  type DevPreviewRouteFixture = Awaited<ReturnType<typeof createFixture>>;
  type DevPreviewRouteTestApp = ReturnType<typeof createTestApp>;

  async function mintPreviewToken(app: DevPreviewRouteTestApp, fixture: DevPreviewRouteFixture): Promise<string> {
    harness.resetEnv({
      ...relayEnabledEnv,
      NODE_ENV: 'development',
      HAPPIER_PUBLIC_SERVER_URL: 'http://127.0.0.1:3005',
      HAPPIER_WEBAPP_URL: undefined,
      HAPPY_WEBAPP_URL: undefined,
      HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: undefined,
      HAPPIER_DEV_PREVIEW_RELAY_PATH_MODE_ENABLED: '1',
    });
    const mint = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${fixture.sessionId}/dev-preview/${fixture.machineId}/route_1/token`,
      headers: {
        authorization: `Bearer ${fixture.token}`,
        host: 'stack.example.test',
        'x-forwarded-proto': 'https',
      },
    });

    expect(mint.statusCode).toBe(200);
    const tokenPayload = mint.json() as { token: string; previewUrl?: string; namespaceStrategy?: string };
    expect(typeof tokenPayload.token).toBe('string');
    expect(tokenPayload.token.length).toBeGreaterThan(0);
    expect(tokenPayload.namespaceStrategy).toBe('path');
    expect(tokenPayload.previewUrl).toBe(
      `https://stack.example.test/preview/${fixture.sessionId}/${fixture.machineId}/route_1/?previewToken=${encodeURIComponent(tokenPayload.token)}`,
    );
    return tokenPayload.token;
  }

  async function movePreviewTokenIntoCookie(app: DevPreviewRouteTestApp, fixture: DevPreviewRouteFixture, token: string, params?: Readonly<{
    path?: string;
    search?: string;
  }>): Promise<Readonly<{ cookie: string; location: string }>> {
    const path = params?.path ?? '/index.html';
    const search = params?.search ?? '';
    const querySuffix = search.startsWith('?') && search.length > 1
      ? `&${search.slice(1)}`
      : search.trim().length > 0
        ? `&${search}`
        : '';
    const redirect = await app.inject({
      method: 'GET',
      url: `/preview/${fixture.sessionId}/${fixture.machineId}/route_1${path}?previewToken=${encodeURIComponent(token)}${querySuffix}`,
    });

    expect(redirect.statusCode).toBe(302);
    const cookie = String(redirect.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).toContain('happier_dev_preview_token=');
    return {
      cookie,
      location: String(redirect.headers.location ?? ''),
    };
  }

  it('mints a preview token and relays an HTTP response through the machine-scoped RPC method', async () => {
    const fixture = await createFixture();
    const forwardRpcForUser = vi.fn(async ({ method, params }: { method: string; params: any }) => {
      if (method === `${fixture.machineId}:${RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_HTTP}`) {
        return {
          ok: true as const,
          result: {
            ok: true,
            status: 200,
            headers: {
              'content-type': 'text/plain; charset=utf-8',
              'cache-control': 'no-store',
            },
            bodyBase64: Buffer.from('<html>preview relay</html>', 'utf8').toString('base64'),
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });

    const app = createTestApp(forwardRpcForUser);
    sessionRoutes(app as any);
    await app.ready();

    try {
      const previewToken = await mintPreviewToken(app, fixture);
      const cookie = await movePreviewTokenIntoCookie(app, fixture, previewToken, {
        search: '?v=1',
      });

      const preview = await app.inject({
        method: 'GET',
        url: cookie.location,
        headers: {
          authorization: `Bearer ${fixture.token}`,
          cookie: `${cookie.cookie}; session=main-app-cookie`,
        },
      });

      expect(preview.statusCode).toBe(200);
      expect(preview.body).toBe('<html>preview relay</html>');
      expect(preview.headers['content-type']).toContain('text/plain');
      expect(forwardRpcForUser).toHaveBeenCalledWith({
        userId: fixture.accountId,
        method: `${fixture.machineId}:${RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_HTTP}`,
        params: {
          sessionId: fixture.sessionId,
          machineId: fixture.machineId,
          routeKey: 'route_1',
          method: 'GET',
          path: '/index.html',
          search: '?v=1',
          headers: expect.not.objectContaining({
            authorization: expect.anything(),
            cookie: expect.anything(),
          }),
        },
        timeoutMs: undefined,
      });
      const forwardedHeaders = (forwardRpcForUser.mock.calls[0]?.[0] as any)?.params?.headers ?? {};
      expect(forwardedHeaders.authorization).toBeUndefined();
      expect(forwardedHeaders.cookie).toBeUndefined();
      expect('port' in ((forwardRpcForUser.mock.calls[0]?.[0] as any)?.params ?? {})).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('relays an MJPEG simulator stream path through the same preview relay route', async () => {
    const fixture = await createFixture();
    const boundary = 'happier-android-screenshot';
    const multipartBody = Buffer.from(
      [
        `--${boundary}\r\n`,
        'Content-Type: image/jpeg\r\n',
        'Content-Length: 4\r\n\r\n',
        'jpeg\r\n',
      ].join(''),
      'utf8',
    );
    const forwardRpcForUser = vi.fn(async ({ method, params }: { method: string; params: any }) => {
      if (method === `${fixture.machineId}:${RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_HTTP}`) {
        expect(params.path).toBe('/stream.mjpeg');
        return {
          ok: true as const,
          result: {
            ok: true,
            status: 200,
            headers: {
              'content-type': `multipart/x-mixed-replace; boundary=${boundary}`,
              'cache-control': 'no-cache, no-store, must-revalidate',
            },
            bodyBase64: multipartBody.toString('base64'),
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });

    const app = createTestApp(forwardRpcForUser);
    sessionRoutes(app as any);
    await app.ready();

    try {
      const previewToken = await mintPreviewToken(app, fixture);
      const cookie = await movePreviewTokenIntoCookie(app, fixture, previewToken, {
        path: '/stream.mjpeg',
      });

      const preview = await app.inject({
        method: 'GET',
        url: cookie.location,
        headers: {
          cookie: cookie.cookie,
        },
      });

      expect(preview.statusCode).toBe(200);
      expect(preview.headers['content-type']).toBe(`multipart/x-mixed-replace; boundary=${boundary}`);
      expect(preview.rawPayload).toEqual(multipartBody);
      expect(forwardRpcForUser).toHaveBeenCalledWith(expect.objectContaining({
        userId: fixture.accountId,
        method: `${fixture.machineId}:${RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_HTTP}`,
        params: expect.objectContaining({
          sessionId: fixture.sessionId,
          machineId: fixture.machineId,
          routeKey: 'route_1',
          method: 'GET',
          path: '/stream.mjpeg',
          search: '',
        }),
      }));
    } finally {
      await app.close();
    }
  });

  it('uses a host-based preview origin when the server has a preview host base domain configured', async () => {
    harness.resetEnv({
      ...relayEnabledEnv,
      HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.example.test',
      HAPPIER_PUBLIC_SERVER_URL: 'https://api.other.test:9999',
      HAPPIER_WEBAPP_URL: 'https://stack.example.test:43210',
      HANDY_MASTER_SECRET: 'preview-host-secret',
    });
    const fixture = await createFixture();
    const forwardRpcForUser = vi.fn(async ({ method, params }: { method: string; params: any }) => {
      if (method !== `${fixture.machineId}:${RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_HTTP}`) {
        throw new Error(`unexpected method ${method}`);
      }

      if (params.path === '/dashboard/index.html') {
        return {
          ok: true as const,
          result: {
            ok: true,
            status: 200,
            headers: {
              'content-type': 'text/html; charset=utf-8',
            },
            bodyBase64: Buffer.from(
              '<html><head><script type="module" src="/@vite/client"></script></head><body>host preview</body></html>',
              'utf8',
            ).toString('base64'),
          },
        };
      }

      if (params.path === '/@vite/client') {
        return {
          ok: true as const,
          result: {
            ok: true,
            status: 200,
            headers: {
              'content-type': 'application/javascript; charset=utf-8',
            },
            bodyBase64: Buffer.from('console.log("host vite client");', 'utf8').toString('base64'),
          },
        };
      }

      throw new Error(`unexpected preview path ${params.path}`);
    });

    const app = createTestApp(forwardRpcForUser);
    sessionRoutes(app as any);
    enableErrorHandlers(app as any);
    await app.ready();

    try {
      const mint = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${fixture.sessionId}/dev-preview/${fixture.machineId}/route_1/token`,
        headers: {
          authorization: `Bearer ${fixture.token}`,
          host: 'internal.example.test:43210',
          'x-forwarded-host': 'stack.example.test:43210',
          'x-forwarded-proto': 'https',
        },
      });

      expect(mint.statusCode).toBe(200);
      const tokenPayload = mint.json() as { token: string; previewUrl: string; namespaceStrategy: string };
      expect(tokenPayload.namespaceStrategy).toBe('host');
      const previewUrl = new URL(tokenPayload.previewUrl);
      expect(previewUrl.protocol).toBe('https:');
      expect(previewUrl.hostname).toMatch(/^hp-[a-z2-7]{26}\.preview\.example\.test$/);
      expect(previewUrl.port).toBe('43210');
      expect(previewUrl.pathname).toBe('/');
      expect(previewUrl.searchParams.get('previewToken')).toBe(tokenPayload.token);

      const preview = await app.inject({
        method: 'GET',
        url: `/dashboard/index.html?previewToken=${encodeURIComponent(tokenPayload.token)}&v=1`,
        headers: {
          host: 'internal.example.test:43210',
          'x-forwarded-host': previewUrl.host,
          'sec-fetch-dest': 'iframe',
        },
      });

      expect(preview.statusCode).toBe(200);
      expect(preview.body).toContain('host preview');
      expect(preview.body).toContain('/@vite/client?previewToken=');
      expect(preview.body).not.toContain(`/preview/${fixture.sessionId}/${fixture.machineId}/route_1/`);
      expect(forwardRpcForUser).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          params: expect.objectContaining({
            sessionId: fixture.sessionId,
            machineId: fixture.machineId,
            routeKey: 'route_1',
            path: '/dashboard/index.html',
            search: '?v=1',
          }),
        }),
      );

      const asset = await app.inject({
        method: 'GET',
        url: `/@vite/client`,
        headers: {
          host: 'internal.example.test:43210',
          'x-forwarded-host': previewUrl.host,
          cookie: String(preview.headers['set-cookie']).split(';')[0] ?? '',
        },
      });

      expect(asset.statusCode).toBe(200);
      expect(asset.body).toBe('console.log("host vite client");');
      expect(forwardRpcForUser).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          params: expect.objectContaining({
            path: '/@vite/client',
            search: '',
          }),
        }),
      );
    } finally {
      await app.close();
    }
  });

  it('serves host preview relay when UI is mounted at root', async () => {
    harness.resetEnv({
      ...relayEnabledEnv,
      HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.example.test',
      HAPPIER_PUBLIC_SERVER_URL: 'https://stack.example.test:43210',
      HAPPIER_WEBAPP_URL: undefined,
      HAPPY_WEBAPP_URL: undefined,
      HANDY_MASTER_SECRET: 'preview-host-secret',
      HAPPIER_SERVER_UI_DIR: '/tmp/ui',
      HAPPIER_SERVER_UI_PREFIX: '/',
    });
    const fixture = await createFixture();
    const dir = await mkdtemp(join(tmpdir(), 'happier-preview-ui-root-'));
    const forwardRpcForUser = vi.fn(async ({ method, params }: { method: string; params: any }) => {
      if (method === `${fixture.machineId}:${RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_HTTP}` && params.path === '/dashboard') {
        return {
          ok: true as const,
          result: {
            ok: true,
            status: 200,
            headers: {
              'content-type': 'text/plain; charset=utf-8',
            },
            bodyBase64: Buffer.from('host preview wins over ui root', 'utf8').toString('base64'),
          },
        };
      }
      throw new Error(`unexpected preview request ${method} ${params?.path ?? ''}`);
    });
    const app = createTestApp(forwardRpcForUser);

    try {
      await writeFile(join(dir, 'index.html'), '<!doctype html><html><body>ui-root</body></html>\n', 'utf8');
      enableServeUi(app as any, { dir, prefix: '/', mountRoot: true, required: false });
      sessionRoutes(app as any);
      enableErrorHandlers(app as any);
      await app.ready();

      const deepLink = await app.inject({
        method: 'GET',
        url: '/terminal/connect',
        headers: {
          host: 'app.example.test',
        },
      });

      expect(deepLink.statusCode).toBe(200);
      expect(deepLink.body).toContain('ui-root');

      const mint = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${fixture.sessionId}/dev-preview/${fixture.machineId}/route_1/token`,
        headers: {
          authorization: `Bearer ${fixture.token}`,
          host: 'internal.example.test:43210',
          'x-forwarded-host': 'stack.example.test:43210',
          'x-forwarded-proto': 'https',
        },
      });

      expect(mint.statusCode).toBe(200);
      const tokenPayload = mint.json() as { token: string; previewUrl: string };
      const previewUrl = new URL(tokenPayload.previewUrl);
      const previewRedirect = await app.inject({
        method: 'GET',
        url: `/dashboard?previewToken=${encodeURIComponent(tokenPayload.token)}`,
        headers: {
          host: 'internal.example.test:43210',
          'x-forwarded-host': previewUrl.host,
        },
      });

      expect(previewRedirect.statusCode).toBe(302);
      const preview = await app.inject({
        method: 'GET',
        url: String(previewRedirect.headers.location ?? ''),
        headers: {
          host: 'internal.example.test:43210',
          'x-forwarded-host': previewUrl.host,
          cookie: String(previewRedirect.headers['set-cookie']).split(';')[0] ?? '',
        },
      });

      expect(preview.statusCode).toBe(200);
      expect(preview.body).toBe('host preview wins over ui root');
      expect(preview.body).not.toContain('ui-root');
      expect(forwardRpcForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            sessionId: fixture.sessionId,
            machineId: fixture.machineId,
            routeKey: 'route_1',
            path: '/dashboard',
          }),
        }),
      );

      const explodingRedirect = await app.inject({
        method: 'GET',
        url: `/explode?previewToken=${encodeURIComponent(tokenPayload.token)}`,
        headers: {
          host: 'internal.example.test:43210',
          'x-forwarded-host': previewUrl.host,
        },
      });
      expect(explodingRedirect.statusCode).toBe(302);

      const exploding = await app.inject({
        method: 'GET',
        url: String(explodingRedirect.headers.location ?? ''),
        headers: {
          host: 'internal.example.test:43210',
          'x-forwarded-host': previewUrl.host,
          cookie: String(explodingRedirect.headers['set-cookie']).split(';')[0] ?? '',
        },
      });

      expect(exploding.statusCode).toBe(500);
      expect(exploding.body).not.toContain('ui-root');
      expect(exploding.body).not.toContain('Not found');
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps host preview unavailable when server feature policy disables the relay', async () => {
    harness.resetEnv({
      ...relayEnabledEnv,
      HAPPIER_BUILD_FEATURES_DENY: 'sessions.devPreview.relay',
      HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.example.test',
      HAPPIER_PUBLIC_SERVER_URL: 'https://stack.example.test',
      HAPPIER_WEBAPP_URL: undefined,
      HAPPY_WEBAPP_URL: undefined,
      HANDY_MASTER_SECRET: 'preview-host-secret',
    });
    const fixture = await createFixture();
    const dir = await mkdtemp(join(tmpdir(), 'happier-preview-policy-ui-root-'));
    const forwardRpcForUser = vi.fn(async () => {
      throw new Error('forwardRpcForUser should not be called when relay is disabled by policy');
    });
    const app = createTestApp(forwardRpcForUser);
    await writeFile(join(dir, 'index.html'), '<!doctype html><html><body>ui-root</body></html>\n', 'utf8');
    enableServeUi(app as any, { dir, prefix: '/', mountRoot: true, required: false });
    sessionRoutes(app as any);
    enableErrorHandlers(app as any);
    await app.ready();

    try {
      const mint = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${fixture.sessionId}/dev-preview/${fixture.machineId}/route_1/token`,
        headers: {
          authorization: `Bearer ${fixture.token}`,
          host: 'stack.example.test',
          'x-forwarded-proto': 'https',
        },
      });

      expect(mint.statusCode).toBe(404);

      const token = await createSessionDevPreviewToken({
        userId: fixture.accountId,
        sessionId: fixture.sessionId,
        machineId: fixture.machineId,
        routeKey: 'route_1',
      });
      const previewHost = buildHostNamespacePreviewHost({
        sessionId: fixture.sessionId,
        machineId: fixture.machineId,
        routeKey: 'route_1',
      }, process.env);
      expect(previewHost).toBeTruthy();

      const preview = await app.inject({
        method: 'GET',
        url: `/?previewToken=${encodeURIComponent(token)}`,
        headers: {
          host: String(previewHost),
        },
      });

      expect(preview.statusCode).toBe(404);
      expect(preview.body).not.toContain('ui-root');
      expect(forwardRpcForUser).not.toHaveBeenCalled();
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not fall back to the path namespace when the configured preview host base domain is invalid', async () => {
    harness.resetEnv({
      ...relayEnabledEnv,
      HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'https://preview.example.test',
    });
    const fixture = await createFixture();
    const forwardRpcForUser = vi.fn(async () => {
      throw new Error('forwardRpcForUser should not be called when minting a token');
    });

    const app = createTestApp(forwardRpcForUser);
    sessionRoutes(app as any);
    await app.ready();

    try {
      const mint = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${fixture.sessionId}/dev-preview/${fixture.machineId}/route_1/token`,
        headers: {
          authorization: `Bearer ${fixture.token}`,
          host: 'stack.example.test',
          'x-forwarded-proto': 'https',
        },
      });

      expect(mint.statusCode).toBe(503);
      expect(forwardRpcForUser).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('keeps path namespace unavailable in production even when explicitly configured', async () => {
    harness.resetEnv({
      ...relayEnabledEnv,
      NODE_ENV: 'production',
      HAPPIER_PUBLIC_SERVER_URL: 'http://127.0.0.1:3005',
      HAPPIER_WEBAPP_URL: undefined,
      HAPPY_WEBAPP_URL: undefined,
      HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: undefined,
      HAPPIER_DEV_PREVIEW_RELAY_PATH_MODE_ENABLED: '1',
    });
    const fixture = await createFixture();
    const forwardRpcForUser = vi.fn(async () => {
      throw new Error('forwardRpcForUser should not be called for production path mode');
    });

    const app = createTestApp(forwardRpcForUser);
    sessionRoutes(app as any);
    await app.ready();

    try {
      const mint = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${fixture.sessionId}/dev-preview/${fixture.machineId}/route_1/token`,
        headers: {
          authorization: `Bearer ${fixture.token}`,
        },
      });

      expect(mint.statusCode).toBe(503);

      const preview = await app.inject({
        method: 'GET',
        url: `/preview/${fixture.sessionId}/${fixture.machineId}/route_1/?previewToken=token`,
      });
      expect(preview.statusCode).toBe(404);
      expect(forwardRpcForUser).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects preview host requests with a mismatched host id without falling back to UI', async () => {
    harness.resetEnv({
      ...relayEnabledEnv,
      HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.example.test',
      HAPPIER_PUBLIC_SERVER_URL: 'https://stack.example.test',
      HAPPIER_WEBAPP_URL: undefined,
      HAPPY_WEBAPP_URL: undefined,
      HANDY_MASTER_SECRET: 'preview-host-secret',
    });
    const fixture = await createFixture();
    const forwardRpcForUser = vi.fn(async () => {
      throw new Error('forwardRpcForUser should not be called for mismatched host id');
    });
    const app = createTestApp(forwardRpcForUser);
    sessionRoutes(app as any);
    enableErrorHandlers(app as any);
    await app.ready();

    try {
      const mint = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${fixture.sessionId}/dev-preview/${fixture.machineId}/route_1/token`,
        headers: {
          authorization: `Bearer ${fixture.token}`,
          host: 'stack.example.test',
          'x-forwarded-proto': 'https',
        },
      });
      const tokenPayload = mint.json() as { token: string };
      const preview = await app.inject({
        method: 'GET',
        url: `/?previewToken=${encodeURIComponent(tokenPayload.token)}`,
        headers: {
          host: 'hp-abcdefghijklmnopqrstuvwxyz.preview.example.test',
        },
      });

      expect(preview.statusCode).toBe(403);
      expect(preview.headers['content-type']).toMatch(/application\/json/i);
      expect(preview.body).toContain('preview-host-scope-mismatch');
      expect(forwardRpcForUser).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('scrubs preview tokens from GET URLs before opening the daemon relay', async () => {
    harness.resetEnv({
      ...relayEnabledEnv,
      NODE_ENV: 'development',
      HAPPIER_WEBAPP_URL: undefined,
      HAPPY_WEBAPP_URL: undefined,
      HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: undefined,
      HAPPIER_DEV_PREVIEW_RELAY_PATH_MODE_ENABLED: '1',
    });
    const fixture = await createFixture();
    const forwardRpcForUser = vi.fn(async () => {
      throw new Error('forwardRpcForUser should not be called before the token is moved into a preview cookie');
    });

    const app = createTestApp(forwardRpcForUser);
    sessionRoutes(app as any);
    await app.ready();

    try {
      const mint = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${fixture.sessionId}/dev-preview/${fixture.machineId}/route_1/token`,
        headers: {
          authorization: `Bearer ${fixture.token}`,
        },
      });
      const tokenPayload = mint.json() as { token: string };

      const preview = await app.inject({
        method: 'GET',
        url: `/preview/${fixture.sessionId}/${fixture.machineId}/route_1/index.html?previewToken=${encodeURIComponent(tokenPayload.token)}&v=1`,
      });

      expect(preview.statusCode).toBe(302);
      expect(preview.headers.location).toBe(`/preview/${fixture.sessionId}/${fixture.machineId}/route_1/index.html?v=1`);
      expect(String(preview.headers['set-cookie'])).toContain(
        `happier_dev_preview_token=${encodeURIComponent(tokenPayload.token)}`,
      );
      expect(String(preview.headers['set-cookie'])).toContain(
        `Path=/preview/${fixture.sessionId}/${fixture.machineId}/route_1/`,
      );
      expect(forwardRpcForUser).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('relays browser iframe GETs with query tokens but strips tokens before forwarding to the daemon', async () => {
    const fixture = await createFixture();
    const forwardRpcForUser = vi.fn(async ({ method }: { method: string; params: any }) => {
      if (method === `${fixture.machineId}:${RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_HTTP}`) {
        return {
          ok: true as const,
          result: {
            ok: true,
            status: 200,
            headers: {
              'content-type': 'text/html; charset=utf-8',
            },
            bodyBase64: Buffer.from('<html><body>iframe preview</body></html>', 'utf8').toString('base64'),
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });

    const app = createTestApp(forwardRpcForUser);
    sessionRoutes(app as any);
    await app.ready();

    try {
      const previewToken = await mintPreviewToken(app, fixture);
      const preview = await app.inject({
        method: 'GET',
        url: `/preview/${fixture.sessionId}/${fixture.machineId}/route_1/index.html?previewToken=${encodeURIComponent(previewToken)}&v=1`,
        headers: {
          'sec-fetch-dest': 'iframe',
        },
      });

      expect(preview.statusCode).toBe(200);
      expect(preview.body).toContain('iframe preview');
      expect(String(preview.headers['set-cookie'])).toContain(
        `happier_dev_preview_token=${encodeURIComponent(previewToken)}`,
      );
      expect(forwardRpcForUser).toHaveBeenCalledWith(expect.objectContaining({
        params: expect.objectContaining({
          path: '/index.html',
          search: '?v=1',
        }),
      }));
    } finally {
      await app.close();
    }
  });

  it('rewrites HTML asset URLs and allows follow-up asset requests via a path-scoped preview cookie', async () => {
    const fixture = await createFixture();
    const forwardRpcForUser = vi.fn(async ({ method, params }: { method: string; params: any }) => {
      if (method !== `${fixture.machineId}:${RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_HTTP}`) {
        throw new Error(`unexpected method ${method}`);
      }

      if (params.path === '/index.html') {
        return {
          ok: true as const,
          result: {
            ok: true,
            status: 200,
            headers: {
              'content-type': 'text/html; charset=utf-8',
            },
            bodyBase64: Buffer.from(
              [
                '<html><head>',
                '<script type="module" src="/@vite/client"></script>',
                '<link rel="stylesheet" href="http://127.0.0.1:3000/src/main.css">',
                '<meta http-equiv="refresh" content="0; url=/login">',
                '</head><body>',
                '<img srcset="/assets/a.png 1x, http://localhost:3000/assets/b.png 2x">',
                '</body></html>',
              ].join(''),
              'utf8',
            ).toString('base64'),
          },
        };
      }

      if (params.path === '/@vite/client') {
        return {
          ok: true as const,
          result: {
            ok: true,
            status: 200,
            headers: {
              'content-type': 'application/javascript; charset=utf-8',
            },
            bodyBase64: Buffer.from('console.log("vite client");', 'utf8').toString('base64'),
          },
        };
      }

      throw new Error(`unexpected preview path ${params.path}`);
    });

    const app = createTestApp(forwardRpcForUser);
    sessionRoutes(app as any);
    await app.ready();

    try {
      const previewToken = await mintPreviewToken(app, fixture);
      const cookie = await movePreviewTokenIntoCookie(app, fixture, previewToken);

      const preview = await app.inject({
        method: 'GET',
        url: cookie.location,
        headers: {
          cookie: cookie.cookie,
        },
      });

      expect(preview.statusCode).toBe(200);
      expect(preview.body).toContain(`/preview/${fixture.sessionId}/${fixture.machineId}/route_1/@vite/client`);
      expect(preview.body).toContain(`/preview/${fixture.sessionId}/${fixture.machineId}/route_1/src/main.css`);
      expect(preview.body).toContain(`/preview/${fixture.sessionId}/${fixture.machineId}/route_1/assets/a.png`);
      expect(preview.body).toContain(`/preview/${fixture.sessionId}/${fixture.machineId}/route_1/assets/b.png`);
      expect(preview.body).toContain(`/preview/${fixture.sessionId}/${fixture.machineId}/route_1/login`);
      expect(preview.body).toContain('__happierDevPreviewPatched__');
      const nestedAsset = await app.inject({
        method: 'GET',
        url: `/preview/${fixture.sessionId}/${fixture.machineId}/route_1/@vite/client`,
        headers: {
          cookie: cookie.cookie,
        },
      });

      expect(nestedAsset.statusCode).toBe(200);
      expect(nestedAsset.body).toBe('console.log("vite client");');
      expect(forwardRpcForUser).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          params: expect.objectContaining({
            path: '/@vite/client',
            search: '',
          }),
        }),
      );
    } finally {
      await app.close();
    }
  });

  it('adds a nonce to compatible CSP headers so the injected runtime interceptor can execute', async () => {
    const fixture = await createFixture();
    const forwardRpcForUser = vi.fn(async ({ method }: { method: string }) => {
      if (method !== `${fixture.machineId}:${RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_HTTP}`) {
        throw new Error(`unexpected method ${method}`);
      }

      return {
        ok: true as const,
        result: {
          ok: true,
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy': `default-src 'self'; script-src 'self'`,
          },
          bodyBase64: Buffer.from('<html><head></head><body>preview relay</body></html>', 'utf8').toString('base64'),
        },
      };
    });

    const app = createTestApp(forwardRpcForUser);
    sessionRoutes(app as any);
    await app.ready();

    try {
      const previewToken = await mintPreviewToken(app, fixture);
      const cookie = await movePreviewTokenIntoCookie(app, fixture, previewToken);

      const preview = await app.inject({
        method: 'GET',
        url: cookie.location,
        headers: {
          cookie: cookie.cookie,
        },
      });

      expect(preview.statusCode).toBe(200);
      const nonceMatch = preview.body.match(/<script nonce="([^"]+)">/);
      expect(nonceMatch?.[1]).toBeTruthy();
      expect(String(preview.headers['content-security-policy'])).toContain(`'nonce-${nonceMatch?.[1]}'`);
      expect(String(preview.headers['x-happier-preview-runtime-mode'])).toBe('inject');
    } finally {
      await app.close();
    }
  });

  it('returns a visible limitation page when the upstream CSP forbids runtime script injection', async () => {
    const fixture = await createFixture();
    const forwardRpcForUser = vi.fn(async ({ method }: { method: string }) => {
      if (method !== `${fixture.machineId}:${RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_HTTP}`) {
        throw new Error(`unexpected method ${method}`);
      }

      return {
        ok: true as const,
        result: {
          ok: true,
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy': `default-src 'self'; script-src 'none'`,
          },
          bodyBase64: Buffer.from('<html><head></head><body>preview relay</body></html>', 'utf8').toString('base64'),
        },
      };
    });

    const app = createTestApp(forwardRpcForUser);
    sessionRoutes(app as any);
    await app.ready();

    try {
      const previewToken = await mintPreviewToken(app, fixture);
      const cookie = await movePreviewTokenIntoCookie(app, fixture, previewToken);

      const preview = await app.inject({
        method: 'GET',
        url: cookie.location,
        headers: {
          cookie: cookie.cookie,
        },
      });

      expect(preview.statusCode).toBe(200);
      expect(preview.body).toContain('content-security-policy');
      expect(preview.body).not.toContain('preview relay');
      expect(String(preview.headers['x-happier-preview-runtime-mode'])).toBe('csp-blocked');
    } finally {
      await app.close();
    }
  });

  it('rejects relay access when the feature gate is disabled', async () => {
    harness.resetEnv({
      HAPPIER_FEATURE_SESSIONS_DEV_PREVIEW_RELAY__ENABLED: '0',
    });
    const fixture = await createFixture();
    const app = createTestApp(async () => {
      throw new Error('forwardRpcForUser should not be called');
    });
    sessionRoutes(app as any);
    await app.ready();

    try {
      const mint = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${fixture.sessionId}/dev-preview/${fixture.machineId}/route_1/token`,
        headers: {
          authorization: `Bearer ${fixture.token}`,
        },
      });

      expect(mint.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('rejects a preview token when the routeKey in the URL does not match the token scope', async () => {
    harness.resetEnv({
      ...relayEnabledEnv,
      NODE_ENV: 'development',
      HAPPIER_WEBAPP_URL: undefined,
      HAPPY_WEBAPP_URL: undefined,
      HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: undefined,
      HAPPIER_DEV_PREVIEW_RELAY_PATH_MODE_ENABLED: '1',
    });
    const fixture = await createFixture();
    const forwardRpcForUser = vi.fn(async () => {
      throw new Error('forwardRpcForUser should not be called for mismatched routeKey');
    });
    const app = createTestApp(forwardRpcForUser);
    sessionRoutes(app as any);
    await app.ready();

    try {
      const mint = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${fixture.sessionId}/dev-preview/${fixture.machineId}/route_1/token`,
        headers: {
          authorization: `Bearer ${fixture.token}`,
        },
      });
      const tokenPayload = mint.json() as { token: string };

      const preview = await app.inject({
        method: 'GET',
        url: `/preview/${fixture.sessionId}/${fixture.machineId}/route_2/?previewToken=${encodeURIComponent(tokenPayload.token)}`,
      });

      expect(preview.statusCode).toBe(403);
      expect(forwardRpcForUser).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
