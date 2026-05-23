import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AccountScopedCryptoMaterial } from '@happier-dev/protocol';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { authenticateAndStartDaemon } from '../../src/testkit/uiE2e/authenticateAndStartDaemon';
import { createSessionFromNewSessionComposer } from '../../src/testkit/uiE2e/createSessionFromNewSessionComposer';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { setUiFeatureToggle } from '../../src/testkit/uiE2e/setUiFeatureToggle';
import { runCliJson } from '../../src/testkit/uiE2e/cliJson';
import { fakeClaudeFixturePath } from '../../src/testkit/fakeClaude';
import { upsertEncryptedAccountSettingsV2 } from '../../src/testkit/accountSettings';

const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws') as {
  WebSocketServer: new (options: { noServer: true }) => WebSocketServerLike;
};

type WebSocketLike = {
  send: (data: string) => void;
  close: () => void;
  on: (event: 'message' | 'close' | 'error', listener: (...args: unknown[]) => void) => void;
};

type WebSocketServerLike = {
  on: (event: 'connection', listener: (socket: WebSocketLike) => void) => void;
  handleUpgrade: (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (socket: WebSocketLike) => void,
  ) => void;
  close: (callback?: (error?: Error) => void) => void;
};

type CliAccountSettingsCredentials = Readonly<{
  token: string;
  material: AccountScopedCryptoMaterial;
}>;

const run = createRunDirs({ runLabel: 'ui-e2e' });
const previewHostBaseDomain = `happier-preview-origin-${run.runId}.localhost`;
const normalizedPreviewHostBaseDomain = previewHostBaseDomain.toLowerCase();

function resolveServerLightSqliteDbPath(params: { suiteDir: string }): string {
  return resolve(join(params.suiteDir, 'server-light-data', 'happier-server-light.sqlite'));
}

function readLatestMachineIdFromServerLightDb(params: { suiteDir: string }): string {
  const dbPath = resolveServerLightSqliteDbPath({ suiteDir: params.suiteDir });
  try {
    const raw = execFileSync('sqlite3', ['-json', dbPath, 'select id from Machine order by createdAt desc limit 1;'], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(raw) as Array<{ id?: unknown }>;
    const id = parsed?.[0]?.id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  } catch {
    // Pollers retry while the daemon registers.
  }
  throw new Error(`Failed to read machine id from server light sqlite db: ${dbPath}`);
}

async function waitForLatestMachineId(params: { suiteDir: string; timeoutMs?: number }): Promise<string> {
  const timeoutMs = params.timeoutMs ?? 60_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return readLatestMachineIdFromServerLightDb({ suiteDir: params.suiteDir });
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
  return readLatestMachineIdFromServerLightDb({ suiteDir: params.suiteDir });
}

function toRelayHostUiBaseUrl(loopbackBaseUrl: string): string {
  const url = new URL(loopbackBaseUrl);
  url.hostname = `happier-preview-${run.runId}.localhost`;
  return url.toString().replace(/\/+$/, '');
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(html);
}

function sendText(res: ServerResponse, text: string): void {
  res.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve preview fixture server address');
  }
  return address.port;
}

async function startPreviewFixtureServer(params: Readonly<{
  initialPath: string;
  rootText: string;
  fetchText: string;
  wsText: string;
}>): Promise<Readonly<{ port: number; previewUrl: string; stop: () => Promise<void> }>> {
  const normalizedInitialPath = params.initialPath.endsWith('/') ? params.initialPath : `${params.initialPath}/`;
  const wss = new WebSocketServer({ noServer: true });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    if (req.method === 'GET' && url.pathname === normalizedInitialPath) {
      sendHtml(res, `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Preview fixture</title></head>
  <body>
    <main id="preview-root">${params.rootText}</main>
    <div id="fetch-state">fetch-pending</div>
    <div id="ws-state">ws-pending</div>
    <script>
      fetch('api/state')
        .then((response) => response.text())
        .then((text) => { document.getElementById('fetch-state').textContent = text; })
        .catch((error) => { document.getElementById('fetch-state').textContent = 'fetch-error:' + error.message; });
      const socketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(socketProtocol + '//' + location.host + location.pathname + 'hmr');
      socket.onmessage = (event) => { document.getElementById('ws-state').textContent = String(event.data); };
      socket.onerror = () => { document.getElementById('ws-state').textContent = 'ws-error'; };
    </script>
  </body>
</html>`);
      return;
    }
    if (req.method === 'GET' && url.pathname === `${normalizedInitialPath}api/state`) {
      sendText(res, params.fetchText);
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    if (url.pathname !== `${normalizedInitialPath}hmr`) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.send(params.wsText);
      ws.on('message', (message) => ws.send(String(message)));
    });
  });

  const port = await listen(server);
  return {
    port,
    previewUrl: `http://127.0.0.1:${port}${normalizedInitialPath}`,
    stop: async () => {
      await new Promise<void>((resolveClose) => wss.close(() => resolveClose()));
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    },
  };
}

async function readCliAccountSettingsCredentials(cliHomeDir: string): Promise<CliAccountSettingsCredentials> {
  const candidatePaths = [join(cliHomeDir, 'access.key')];
  const serversDir = join(cliHomeDir, 'servers');
  const serverEntries = await readdir(serversDir, { withFileTypes: true }).catch(() => []);
  for (const entry of serverEntries) {
    if (entry.isDirectory()) {
      candidatePaths.push(join(serversDir, entry.name, 'access.key'));
    }
  }

  for (const path of candidatePaths) {
    const raw = await readFile(path, 'utf8').catch(() => '');
    if (!raw.trim()) continue;
    const parsed = JSON.parse(raw) as {
      token?: unknown;
      secret?: unknown;
      encryption?: { machineKey?: unknown };
    };
    const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
    if (!token) continue;
    if (typeof parsed.encryption?.machineKey === 'string' && parsed.encryption.machineKey.trim()) {
      return {
        token,
        material: {
          type: 'dataKey',
          machineKey: Uint8Array.from(Buffer.from(parsed.encryption.machineKey.trim(), 'base64')),
        },
      };
    }
    if (typeof parsed.secret === 'string' && parsed.secret.trim()) {
      return {
        token,
        material: {
          type: 'legacy',
          secret: Uint8Array.from(Buffer.from(parsed.secret.trim(), 'base64')),
        },
      };
    }
  }

  throw new Error(`Failed to read CLI account credentials from ${cliHomeDir}`);
}

async function enableDevPreviewForUiAndCli(params: Readonly<{
  page: Page;
  uiBaseUrl: string;
  serverUrl: string;
  cliHomeDir: string;
}>): Promise<void> {
  await setUiFeatureToggle({
    page: params.page,
    baseUrl: params.uiBaseUrl,
    featureId: 'sessions.devPreview',
    enabled: true,
  });
  const credentials = await readCliAccountSettingsCredentials(params.cliHomeDir);
  await upsertEncryptedAccountSettingsV2({
    baseUrl: params.serverUrl,
    token: credentials.token,
    material: credentials.material,
    settings: {
      experiments: true,
      featureToggles: {
        'sessions.devPreview': true,
      },
    },
  });
}

test.describe('ui e2e: dev preview relay', () => {
  test.describe.configure({ mode: 'serial' });

  const suiteDir = run.testDir('session-dev-preview-relay-suite');
  const cliHomeDir = resolve(join(suiteDir, 'cli-home'));

  let server: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let uiBaseUrl: string | null = null;
  let daemon: StartedDaemon | null = null;
  let previewServers: Array<Awaited<ReturnType<typeof startPreviewFixtureServer>>> = [];

  test.beforeAll(async () => {
    const uiWebEnv = {
      ...process.env,
      EXPO_PUBLIC_DEBUG: '1',
      EXPO_PUBLIC_HAPPY_SERVER_URL: '',
      EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-${run.runId}`,
      HAPPIER_E2E_UI_WEB_MODE: 'export',
      HAPPIER_E2E_UI_WEB_EXPORT_TIMEOUT_MS: process.env.HAPPIER_E2E_UI_WEB_EXPORT_TIMEOUT_MS ?? '900000',
      HAPPIER_E2E_UI_WEB_EXPORT_FALLBACK_TO_METRO: '0',
      HAPPIER_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS: process.env.HAPPIER_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS ?? '480000',
    };
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(uiWebEnv));
    await mkdir(cliHomeDir, { recursive: true });
    await writeFile(resolve(join(cliHomeDir, 'AGENTS.md')), '# UI e2e fixture\n', 'utf8');

    server = await startServerLight({
      testDir: suiteDir,
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys',
        HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: previewHostBaseDomain,
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
        HAPPIER_PRESENCE_SESSION_TIMEOUT_MS: '60000',
        HAPPIER_PRESENCE_MACHINE_TIMEOUT_MS: '60000',
        HAPPIER_PRESENCE_TIMEOUT_TICK_MS: '1000',
      },
    });
    ui = await startUiWeb({
      testDir: suiteDir,
      env: {
        ...uiWebEnv,
        EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl,
      },
    });
    uiBaseUrl = toRelayHostUiBaseUrl(normalizeLoopbackBaseUrl(ui.baseUrl));
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await Promise.all(previewServers.map((previewServer) => previewServer.stop().catch(() => {})));
    await daemon?.stop().catch(() => {});
    await ui?.stop().catch(() => {});
    await server?.stop().catch(() => {});
  });

  test('loads a registered local service path through the HTTP and WebSocket relay', async ({ page }, testInfo) => {
    test.setTimeout(540_000);
    if (!server || !uiBaseUrl) throw new Error('missing server/ui fixtures');

    await page.setViewportSize({ width: 1440, height: 900 });
    const testDir = resolve(join(suiteDir, 't1-preview-relay'));
    await mkdir(testDir, { recursive: true });

    const fakeClaudeLogPath = resolve(join(testDir, 'fake-claude.jsonl'));
    daemon = await authenticateAndStartDaemon({
      page,
      testDir,
      cliHomeDir,
      serverUrl: server.baseUrl,
      uiBaseUrl,
      extraEnv: {
        ...process.env,
        HOME: cliHomeDir,
        HAPPIER_CLAUDE_PATH: fakeClaudeFixturePath(),
        HAPPIER_E2E_FAKE_CLAUDE_LOG: fakeClaudeLogPath,
        HAPPIER_E2E_FAKE_CLAUDE_SESSION_ID: `fake-claude-session-${run.runId}`,
        HAPPIER_E2E_FAKE_CLAUDE_INVOCATION_ID: `fake-claude-invocation-${run.runId}`,
      },
    });

    await enableDevPreviewForUiAndCli({
      page,
      uiBaseUrl,
      serverUrl: server.baseUrl,
      cliHomeDir,
    });

    const machineId = await waitForLatestMachineId({ suiteDir, timeoutMs: 120_000 });
    const sessionId = await createSessionFromNewSessionComposer({
      page,
      uiBaseUrl,
      machineId,
      prompt: `dev preview relay ${run.runId}`,
    });
    await expect(page.getByTestId('transcript-chat-list')).toHaveCount(1, { timeout: 120_000 });

    const primaryPreviewServer = await startPreviewFixtureServer({
      initialPath: '/ai-console/develop/',
      rootText: 'Primary preview fixture loaded at /ai-console/develop/',
      fetchText: 'primary-fetch-ok',
      wsText: 'primary-ws-ok',
    });
    const secondaryPreviewServer = await startPreviewFixtureServer({
      initialPath: '/docs/',
      rootText: 'Secondary preview fixture loaded at /docs/',
      fetchText: 'secondary-fetch-ok',
      wsText: 'secondary-ws-ok',
    });
    previewServers = [primaryPreviewServer, secondaryPreviewServer];
    const registerEnvelope = await runCliJson({
      testDir,
      cliHomeDir,
      serverUrl: server.baseUrl,
      webappUrl: uiBaseUrl,
      env: {
        ...process.env,
        HOME: cliHomeDir,
        HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
      },
      label: 'session-preview-register',
      args: [
        'session',
        'preview',
        'register',
        sessionId,
        '--url',
        primaryPreviewServer.previewUrl,
        '--name',
        'Primary relay preview fixture',
        '--framework',
        'vite',
        '--json',
      ],
      timeoutMs: 180_000,
      launchOptions: {
        preferSourceEntrypoint: true,
        skipSourceFreshnessCheck: true,
      },
    });
    expect(registerEnvelope.ok).toBe(true);
    expect(registerEnvelope.kind).toBe('session_preview_register');
    expect(registerEnvelope.data).toEqual(expect.objectContaining({
      url: primaryPreviewServer.previewUrl,
    }));
    const registeredPreviewResourceId = typeof registerEnvelope.data === 'object'
      && registerEnvelope.data !== null
      && typeof (registerEnvelope.data as { resourceId?: unknown }).resourceId === 'string'
      ? (registerEnvelope.data as { resourceId: string }).resourceId
      : '';
    expect(registeredPreviewResourceId).toMatch(/^preview_/);
    const secondaryRegisterEnvelope = await runCliJson({
      testDir,
      cliHomeDir,
      serverUrl: server.baseUrl,
      webappUrl: uiBaseUrl,
      env: {
        ...process.env,
        HOME: cliHomeDir,
        HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
      },
      label: 'session-preview-register-secondary',
      args: [
        'session',
        'preview',
        'register',
        sessionId,
        '--url',
        secondaryPreviewServer.previewUrl,
        '--name',
        'Secondary relay preview fixture',
        '--framework',
        'vite',
        '--json',
      ],
      timeoutMs: 180_000,
      launchOptions: {
        preferSourceEntrypoint: true,
        skipSourceFreshnessCheck: true,
      },
    });
    expect(secondaryRegisterEnvelope.ok).toBe(true);
    expect(secondaryRegisterEnvelope.kind).toBe('session_preview_register');
    const secondaryPreviewResourceId = typeof secondaryRegisterEnvelope.data === 'object'
      && secondaryRegisterEnvelope.data !== null
      && typeof (secondaryRegisterEnvelope.data as { resourceId?: unknown }).resourceId === 'string'
      ? (secondaryRegisterEnvelope.data as { resourceId: string }).resourceId
      : '';
    expect(secondaryPreviewResourceId).toMatch(/^preview_/);
    expect(secondaryPreviewResourceId).not.toBe(registeredPreviewResourceId);

    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/session/${sessionId}?happier_hmr=0`, 180_000);
    await expect(page.getByTestId('local-service-preview-card')).toHaveCount(2, { timeout: 120_000 });
    await expect(page.getByTestId('session-header-dev-preview-button')).toHaveCount(1, { timeout: 120_000 });
    await page.getByTestId('session-header-dev-preview-button').click();
    await page.getByTestId(`session-header-dev-preview-menu-item-${registeredPreviewResourceId}`).click();

    const iframe = page.locator('iframe[data-testid="session.localServicePreview.iframe"]').first();
    await expect(iframe).toHaveCount(1, { timeout: 120_000 });
    const previewTabKey = `localServicePreview_${registeredPreviewResourceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    await expect(page.getByTestId(`session-details-tab-pin-${previewTabKey}`)).toHaveCount(0);
    await expect(page.getByTestId(`session-details-tab-unpin-${previewTabKey}`)).toHaveCount(0);
    await expect(page.getByTestId(`session-details-tab-close-${previewTabKey}`)).toHaveCount(1);
    await expect
      .poll(async () => iframe.getAttribute('src'), { timeout: 60_000 })
      .toContain(normalizedPreviewHostBaseDomain);
    await expect
      .poll(async () => iframe.getAttribute('src'), { timeout: 60_000 })
      .not.toContain('/preview/');

    const frameHandle = await iframe.elementHandle();
    const frame = await frameHandle?.contentFrame();
    if (!frame) {
      throw new Error('Failed to resolve preview iframe frame');
    }

    await expect(frame.locator('#preview-root')).toContainText('Primary preview fixture loaded at /ai-console/develop/', { timeout: 120_000 });
    await expect(frame.locator('#fetch-state')).toContainText('primary-fetch-ok', { timeout: 120_000 });
    await expect(frame.locator('#ws-state')).toContainText('primary-ws-ok', { timeout: 120_000 });
    await expect
      .poll(() => frame.url(), { timeout: 60_000 })
      .not.toContain('previewToken=');
    await expect
      .poll(() => frame.url(), { timeout: 60_000 })
      .toContain('/ai-console/develop/');
    await expect
      .poll(() => new URL(frame.url()).hostname, { timeout: 60_000 })
      .toContain(normalizedPreviewHostBaseDomain);

    const screenshotPath = resolve(join(testDir, 'dev-preview-panel-host-origin.png'));
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('dev-preview-panel-host-origin.png', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });
});
