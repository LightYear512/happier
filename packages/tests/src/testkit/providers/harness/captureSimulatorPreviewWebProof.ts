import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { chromium, type Page } from '@playwright/test';

import { repoRootDir } from '../../paths';
import { startUiWeb, type StartedUiWeb } from '../../process/uiWeb';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../uiE2e/pageNavigation';
import { reserveAvailablePort } from '../../network/reserveAvailablePort';

function normalizeTokenStorageServerUrl(raw: string): string {
  const trimmed = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (
      hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname === '[::1]'
      || hostname === 'localhost'
      || hostname.endsWith('.localhost')
    ) {
      parsed.hostname = 'localhost';
    } else {
      parsed.hostname = hostname;
    }

    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    const path = normalizedPath && normalizedPath !== '/' ? normalizedPath : '';
    const port = parsed.port ? `:${parsed.port}` : '';
    const auth = parsed.username ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@` : '';
    return `${parsed.protocol}//${auth}${parsed.hostname}${port}${path}${parsed.search}${parsed.hash}`.replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

function createAuthCredentialsStorageKey(serverUrl: string): string {
  const normalized = normalizeTokenStorageServerUrl(serverUrl);
  const hash = createHash('sha256').update(normalized).digest('base64url');
  return `auth_credentials__srv_${hash}`;
}

function deriveServerIdFromUrl(serverUrl: string): string {
  const normalized = normalizeTokenStorageServerUrl(serverUrl);
  try {
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase();
    const port = url.port ? `-${url.port}` : '';
    const sanitized = `${host}${port}`.replace(/[^a-z0-9._-]/g, '_').replace(/_+/g, '_');
    return sanitized || 'custom';
  } catch {
    const fallback = normalized.toLowerCase().replace(/[^a-z0-9._-]/g, '_').replace(/_+/g, '_');
    return fallback || 'custom';
  }
}

export async function captureSimulatorPreviewWebProof(params: Readonly<{
  workspaceDir: string;
  baseUrl: string;
  token: string;
  sessionId: string;
  secret: Uint8Array;
}>): Promise<Readonly<{ screenshotPath: string; testDirScreenshotPath: string; uiBaseUrl: string }>> {
  const testDir = dirname(params.workspaceDir);
  const proofDir = resolve(join(testDir, 'web-proof'));
  await mkdir(proofDir, { recursive: true });
  const consoleLogPath = resolve(join(proofDir, 'browser.console.log'));
  const diagnosticScreenshotPath = resolve(join(testDir, 'real-codex-simulator-preview-web-diagnostic.png'));
  const diagnosticHtmlPath = resolve(join(proofDir, 'diagnostic.html'));

  let ui: StartedUiWeb | null = null;
  const browser = await chromium.launch({ headless: true });
  try {
    ui = await startUiWeb({
      testDir: proofDir,
      port: await reserveAvailablePort(),
      env: {
        ...process.env,
        EXPO_PUBLIC_DEBUG: '1',
        EXPO_PUBLIC_HAPPY_SERVER_URL: params.baseUrl,
        EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `provider-simulator-preview-${params.sessionId}`,
        HAPPIER_E2E_UI_WEB_MODE: process.env.HAPPIER_E2E_UI_WEB_MODE ?? 'export',
        HAPPIER_E2E_UI_WEB_EXPORT_TIMEOUT_MS: process.env.HAPPIER_E2E_UI_WEB_EXPORT_TIMEOUT_MS ?? '900000',
        HAPPIER_E2E_UI_WEB_EXPORT_FALLBACK_TO_METRO: '0',
        HAPPIER_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS: process.env.HAPPIER_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS ?? '480000',
      },
    });

    const uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('console', (message) => {
      void appendFile(consoleLogPath, `[${message.type()}] ${message.text()}\n`).catch(() => {});
    });
    page.on('pageerror', (error) => {
      void appendFile(consoleLogPath, `[pageerror] ${error.stack ?? error.message}\n`).catch(() => {});
    });
    const credentials = {
      token: params.token,
      secret: Buffer.from(params.secret).toString('base64'),
    };
    const scopedAuthKey = createAuthCredentialsStorageKey(params.baseUrl);
    const serverId = deriveServerIdFromUrl(params.baseUrl);
    const serverState = {
      activeServerIdIsExplicit: true,
      activeServerId: serverId,
      servers: {
        [serverId]: {
          id: serverId,
          name: serverId,
          serverUrl: normalizeTokenStorageServerUrl(params.baseUrl),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastUsedAt: Date.now(),
          source: 'url',
        },
      },
    };

    await page.addInitScript(({ authKey, authCredentials, activeServerId, persistedServerState }) => {
      window.localStorage.setItem('server-profiles:server-state-v1', JSON.stringify(persistedServerState));
      window.sessionStorage.setItem('activeServerId', activeServerId);
      window.localStorage.setItem(authKey, JSON.stringify(authCredentials));
      window.localStorage.setItem(`auth_credentials__srv_${activeServerId}`, JSON.stringify(authCredentials));
      window.localStorage.setItem('auth_credentials', JSON.stringify(authCredentials));
      window.localStorage.setItem('onboarding-showcase-seen-version', 'v4');
      window.localStorage.setItem('mmkv.default\\onboarding-showcase-seen-version', 'v4');
    }, {
      authKey: scopedAuthKey,
      authCredentials: credentials,
      activeServerId: serverId,
      persistedServerState: serverState,
    });

    await navigateToSimulatorPreviewProofSession(page, uiBaseUrl, params.sessionId);
    try {
      await page.getByTestId('transcript-chat-list').waitFor({ state: 'visible', timeout: 120_000 });
      await page.getByTestId('simulator-preview-card').first().waitFor({ state: 'visible', timeout: 120_000 });
      await page.getByTestId('simulator-preview-card').first().click();
      await page.getByTestId('session.simulatorPreview.screenFrame').waitFor({ state: 'visible', timeout: 120_000 });
      await page.getByTestId('session.simulatorPreview.frame').waitFor({ state: 'visible', timeout: 120_000 });
      await page.waitForFunction(() => {
        const frame = document.querySelector('[data-testid="session.simulatorPreview.frame"]');
        return frame instanceof HTMLImageElement && frame.naturalWidth > 0 && frame.naturalHeight > 0;
      }, undefined, { timeout: 120_000 });
      await captureSimulatorPreviewUserControlProof(page);
    } catch (error) {
      await page.screenshot({ path: diagnosticScreenshotPath, fullPage: true }).catch(() => {});
      await writeFile(diagnosticHtmlPath, await page.content().catch(() => ''), 'utf8').catch(() => {});
      throw error;
    }

    const testDirScreenshotPath = resolve(join(testDir, 'real-codex-simulator-preview-web-closed-loop.png'));
    const screenshotPath = resolve(join(repoRootDir(), '.project', 'logs', 'real-codex-simulator-preview-web-closed-loop.png'));
    const proofJsonPath = resolve(join(repoRootDir(), '.project', 'logs', 'real-codex-simulator-preview-web-closed-loop.json'));
    await mkdir(dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: testDirScreenshotPath, fullPage: true });
    await writeFile(
      proofJsonPath,
      JSON.stringify({
        sessionId: params.sessionId,
        uiBaseUrl,
        screenshotPath,
        testDirScreenshotPath,
        controlLease: 'user',
        viewportClick: 'sent',
        capturedAt: new Date().toISOString(),
      }, null, 2),
      'utf8',
    );
    await copyFile(testDirScreenshotPath, screenshotPath);
    await page.close().catch(() => {});

    return { screenshotPath, testDirScreenshotPath, uiBaseUrl };
  } finally {
    await browser.close().catch(() => {});
    await ui?.stop().catch(() => {});
  }
}

export async function navigateToSimulatorPreviewProofSession(
  page: Page,
  uiBaseUrl: string,
  sessionId: string,
): Promise<void> {
  await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
  await page.evaluate((path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/session/${sessionId}?happier_hmr=0`);
}

async function captureSimulatorPreviewUserControlProof(page: Page): Promise<void> {
  const controlButton = page.getByTestId('session.simulatorPreview.requestControl');
  await controlButton.waitFor({ state: 'visible', timeout: 120_000 });
  await controlButton.click();
  await controlButton.waitFor({ state: 'hidden', timeout: 120_000 });

  const viewport = page.getByTestId('session.simulatorPreview.screenViewport');
  await viewport.waitFor({ state: 'visible', timeout: 120_000 });
  const box = await viewport.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error('Simulator preview viewport is not clickable');
  }
  await viewport.click({ position: { x: box.width / 2, y: box.height / 2 } });
}
