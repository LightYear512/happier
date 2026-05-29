import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AccountScopedCryptoMaterial } from '@happier-dev/protocol';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { authenticateAndStartDaemon } from '../../src/testkit/uiE2e/authenticateAndStartDaemon';
import {
  gotoDomContentLoadedWithPathFallback,
  gotoDomContentLoadedWithRetries,
  normalizeLoopbackBaseUrl,
} from '../../src/testkit/uiE2e/pageNavigation';
import { setUiFeatureToggle } from '../../src/testkit/uiE2e/setUiFeatureToggle';
import { runCliJson } from '../../src/testkit/uiE2e/cliJson';
import { upsertEncryptedAccountSettingsV2 } from '../../src/testkit/accountSettings';
import { openNewSessionMachineSelection } from '../../src/testkit/uiE2e/createSessionFromNewSessionComposer';
import { selectNewSessionAgent } from '../../src/testkit/uiE2e/selectNewSessionAgent';

type CliAccountSettingsCredentials = Readonly<{
  token: string;
  material: AccountScopedCryptoMaterial;
}>;

const run = createRunDirs({ runLabel: 'ui-e2e' });
const previewHostBaseDomain = `hp-${run.runId.slice(-8).toLowerCase()}.localhost`;
const normalizedPreviewHostBaseDomain = previewHostBaseDomain.toLowerCase();
const hostCodexHomeDir = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');

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
  url.hostname = `happier-real-codex-${run.runId}.localhost`;
  return url.toString().replace(/\/+$/, '');
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve website fixture server address');
  }
  return address.port;
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(html);
}

async function startRealWebsitePage(): Promise<Readonly<{ port: number; previewUrl: string; stop: () => Promise<void> }>> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    if (req.method !== 'GET' || (url.pathname !== '/' && url.pathname !== '/launch/')) {
      res.statusCode = 404;
      res.end();
      return;
    }
    sendHtml(res, `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Northstar Coffee Roasters</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; background: #f4efe7; color: #1f2933; }
      .hero { min-height: 100vh; display: grid; grid-template-columns: 1.05fr 0.95fr; }
      .copy { padding: 48px; display: flex; flex-direction: column; justify-content: center; gap: 24px; }
      .eyebrow { color: #1f7a5c; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; font-size: 13px; }
      h1 { margin: 0; font-size: 54px; line-height: 1.02; letter-spacing: 0; max-width: 720px; }
      p { font-size: 18px; line-height: 1.6; max-width: 620px; color: #52616f; }
      .actions { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
      .button { background: #111827; color: white; border-radius: 8px; padding: 13px 18px; font-weight: 750; }
      .metric { border-left: 4px solid #e0a458; padding-left: 14px; font-weight: 750; }
      .visual { background: linear-gradient(135deg, #224236, #e0a458); display: grid; place-items: center; padding: 40px; }
      .panel { width: min(520px, 90%); aspect-ratio: 4 / 5; background: #fffaf2; border-radius: 8px; box-shadow: 0 24px 80px rgba(17, 24, 39, .24); overflow: hidden; }
      .photo { height: 62%; background:
        radial-gradient(circle at 30% 25%, rgba(255,255,255,.68), transparent 18%),
        radial-gradient(circle at 58% 46%, #5c3424 0 16%, #2b1710 17% 24%, transparent 25%),
        linear-gradient(135deg, #d7b889, #7a4f34); }
      .menu { padding: 28px; display: grid; gap: 14px; }
      .line { display: flex; justify-content: space-between; border-bottom: 1px solid #eadfce; padding-bottom: 10px; font-weight: 700; }
      @media (max-width: 850px) { .hero { grid-template-columns: 1fr; } h1 { font-size: 38px; } .copy { padding: 32px; } }
    </style>
  </head>
  <body>
    <main class="hero" data-testid="real-website-page">
      <section class="copy">
        <div class="eyebrow">Real preview website</div>
        <h1 id="website-title">Northstar Coffee Roasters</h1>
        <p>Small-batch espresso, seasonal filter roasts, and a compact tasting room schedule rendered through Happier's dev preview relay.</p>
        <div class="actions">
          <div class="button">View tasting menu</div>
          <div class="metric">42 origin lots cupped this month</div>
        </div>
      </section>
      <section class="visual" aria-label="Coffee menu preview">
        <div class="panel">
          <div class="photo"></div>
          <div class="menu">
            <div class="line"><span>Ethiopia Guji</span><span>Floral</span></div>
            <div class="line"><span>Colombia Huila</span><span>Cacao</span></div>
            <div class="line"><span>Kenya Nyeri</span><span>Citrus</span></div>
          </div>
        </div>
      </section>
    </main>
  </body>
</html>`);
  });
  const port = await listen(server);
  return {
    port,
    previewUrl: `http://127.0.0.1:${port}/launch/`,
    stop: async () => {
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
  await setUiFeatureToggle({
    page: params.page,
    baseUrl: params.uiBaseUrl,
    featureId: 'sessions.devPreview.relay',
    enabled: true,
  });
  const credentials = await readCliAccountSettingsCredentials(params.cliHomeDir);
  await upsertEncryptedAccountSettingsV2({
    baseUrl: params.serverUrl,
    token: credentials.token,
    material: credentials.material,
    settings: {
      codexBackendMode: 'acp',
      experiments: true,
      featureToggles: {
        'sessions.devPreview': true,
        'sessions.devPreview.relay': true,
      },
    },
  });
}

async function createRealCodexSessionFromComposer(params: Readonly<{
  page: Page;
  uiBaseUrl: string;
  machineId: string;
  prompt: string;
}>): Promise<string> {
  await gotoDomContentLoadedWithPathFallback(params.page, `${params.uiBaseUrl}/new`, '/new');
  const machineSelectionResult = await openNewSessionMachineSelection({
    page: params.page,
    uiBaseUrl: params.uiBaseUrl,
  });
  const pickDeadlineMs = Date.now() + 120_000;
  while (true) {
    const machineOption = params.page.locator(`[data-testid="new-session-machine:${params.machineId}"]:visible`).first();
    if ((await machineOption.count()) > 0) {
      await expect(machineOption).toBeEnabled({ timeout: 120_000 });
      await machineOption.click();
      break;
    }
    if (machineSelectionResult === 'returned_to_new') break;
    if (Date.now() > pickDeadlineMs) {
      await expect(machineOption).toHaveCount(1, { timeout: 1_000 });
    }
    await params.page.waitForTimeout(250);
  }

  await params.page.waitForURL((url) => url.pathname.endsWith('/new'), { timeout: 60_000 });
  await expect(params.page.getByTestId('new-session-composer-input')).toHaveCount(1, { timeout: 120_000 });
  await selectNewSessionAgent({ page: params.page, agentId: 'codex' });
  await params.page.getByTestId('new-session-composer-input').fill(params.prompt);
  const sendButton = params.page.getByTestId('new-session-composer-send');
  await expect(sendButton).toBeEnabled({ timeout: 120_000 });
  await sendButton.click();

  await expect(params.page.locator('textarea[data-testid="session-composer-input"]:visible')).toHaveCount(1, {
    timeout: 180_000,
  });
  const pathname = new URL(params.page.url()).pathname;
  const parts = pathname.split('/').filter(Boolean);
  const sessionId = parts[0] === 'session' ? parts[1] : null;
  if (!sessionId) {
    throw new Error(`failed to parse session id from url: ${params.page.url()}`);
  }
  return sessionId;
}

test.describe('ui e2e: real Codex conversation with dev preview screenshot', () => {
  test.describe.configure({ mode: 'serial' });

  const suiteDir = run.testDir('session-dev-preview-real-codex-screenshot-suite');
  const cliHomeDir = resolve(join(suiteDir, 'cli-home'));

  let server: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let uiBaseUrl: string | null = null;
  let daemon: StartedDaemon | null = null;
  let website: Awaited<ReturnType<typeof startRealWebsitePage>> | null = null;

  test.beforeAll(async () => {
    const uiWebEnv = {
      ...process.env,
      EXPO_PUBLIC_DEBUG: '1',
      EXPO_PUBLIC_HAPPY_SERVER_URL: '',
      EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-${run.runId}-real-codex-preview`,
      HAPPIER_E2E_UI_WEB_MODE: 'export',
      HAPPIER_E2E_UI_WEB_EXPORT_TIMEOUT_MS: process.env.HAPPIER_E2E_UI_WEB_EXPORT_TIMEOUT_MS ?? '900000',
      HAPPIER_E2E_UI_WEB_EXPORT_FALLBACK_TO_METRO: '0',
      HAPPIER_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS: process.env.HAPPIER_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS ?? '480000',
    };
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(uiWebEnv));
    await mkdir(cliHomeDir, { recursive: true });
    await writeFile(resolve(join(cliHomeDir, 'AGENTS.md')), '# Real Codex UI e2e fixture\n', 'utf8');

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
    await website?.stop().catch(() => {});
    await daemon?.stop().catch(() => {});
    await ui?.stop().catch(() => {});
    await server?.stop().catch(() => {});
  });

  test('captures a real Codex chat with a real website open in the dev preview panel', async ({ page }, testInfo) => {
    test.setTimeout(720_000);
    if (!server || !uiBaseUrl) throw new Error('missing server/ui fixtures');

    const codexAcpBin = process.env.HAPPIER_E2E_PROVIDER_CODEX_ACP_BIN ?? process.env.HAPPIER_CODEX_ACP_BIN;
    if (!codexAcpBin) {
      throw new Error('HAPPIER_E2E_PROVIDER_CODEX_ACP_BIN or HAPPIER_CODEX_ACP_BIN is required for this real Codex UI e2e.');
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const testDir = resolve(join(suiteDir, 't1-real-codex-preview-screenshot'));
    await mkdir(testDir, { recursive: true });

    daemon = await authenticateAndStartDaemon({
      page,
      testDir,
      cliHomeDir,
      serverUrl: server.baseUrl,
      uiBaseUrl,
      daemonStartupTimeoutMs: 180_000,
      extraEnv: {
        ...process.env,
        HOME: cliHomeDir,
        CODEX_HOME: hostCodexHomeDir,
        HAPPIER_CODEX_BACKEND_MODE: 'acp',
        HAPPIER_EXPERIMENTAL_CODEX_ACP: '1',
        HAPPIER_CODEX_ACP_BIN: codexAcpBin,
        HAPPIER_E2E_ACP_TRACE_MARKERS: '1',
        HAPPIER_ACP_PROBE_TIMEOUT_CODEX_MS: '20000',
        HAPPIER_INSTALLABLES_LAUNCH_AUTO_INSTALL_TIMEOUT_MS: '10000',
      },
    });

    await enableDevPreviewForUiAndCli({
      page,
      uiBaseUrl,
      serverUrl: server.baseUrl,
      cliHomeDir,
    });

    const machineId = await waitForLatestMachineId({ suiteDir, timeoutMs: 120_000 });
    const marker = `REAL_AI_DEV_PREVIEW_OK_${run.runId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const sessionId = await createRealCodexSessionFromComposer({
      page,
      uiBaseUrl,
      machineId,
      prompt: `Do not inspect files, do not call tools, and do not change the workspace. Reply only with this exact marker followed by one short sentence about a website preview: ${marker}`,
    });
    const transcript = page.getByTestId('transcript-chat-list');
    await expect(transcript).toHaveCount(1, { timeout: 120_000 });
    await expect
      .poll(async () => transcript.getByText(marker).count(), { timeout: 240_000 })
      .toBeGreaterThanOrEqual(2);

    website = await startRealWebsitePage();
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
      label: 'session-preview-register-real-website',
      args: [
        'session',
        'preview',
        'register',
        sessionId,
        '--url',
        website.previewUrl,
        '--name',
        'Northstar Coffee Roasters',
        '--framework',
        'custom',
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
    const registeredPreviewResourceId = typeof registerEnvelope.data === 'object'
      && registerEnvelope.data !== null
      && typeof (registerEnvelope.data as { resourceId?: unknown }).resourceId === 'string'
      ? (registerEnvelope.data as { resourceId: string }).resourceId
      : '';
    expect(registeredPreviewResourceId).toMatch(/^preview_/);

    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/session/${sessionId}?happier_hmr=0`, 180_000);
    await expect(page.getByTestId('local-service-preview-card')).toHaveCount(1, { timeout: 120_000 });
    await expect(page.getByTestId('session-header-dev-preview-button')).toHaveCount(1, { timeout: 120_000 });
    const previewTabKey = `localServicePreview_${registeredPreviewResourceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    await page.getByTestId('session-header-dev-preview-button').click();
    await page.getByTestId(`session-details-tab-${previewTabKey}`).click();

    const iframe = page.locator('iframe[data-testid="session.localServicePreview.iframe"][title="Northstar Coffee Roasters"]');
    await expect(iframe).toHaveCount(1, { timeout: 120_000 });
    await expect
      .poll(async () => iframe.getAttribute('src'), { timeout: 60_000 })
      .toContain(normalizedPreviewHostBaseDomain);

    const frameHandle = await iframe.elementHandle();
    const frame = await frameHandle?.contentFrame();
    if (!frame) {
      throw new Error('Failed to resolve preview iframe frame');
    }
    await expect(frame.locator('#website-title')).toContainText('Northstar Coffee Roasters', { timeout: 120_000 });
    await expect(frame.locator('[data-testid="real-website-page"]')).toContainText('Real preview website', {
      timeout: 120_000,
    });
    await expect
      .poll(async () => transcript.getByText(marker).count(), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(2);

    const screenshotPath = resolve(join(testDir, 'real-ai-chat-with-real-website-preview.png'));
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('real-ai-chat-with-real-website-preview.png', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });
});
