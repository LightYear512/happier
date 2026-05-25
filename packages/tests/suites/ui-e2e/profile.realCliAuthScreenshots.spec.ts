import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { AIBackendProfileSchema, buildBackendTargetKey } from '@happier-dev/protocol';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { authenticateAndStartDaemon } from '../../src/testkit/uiE2e/authenticateAndStartDaemon';
import {
  gotoDomContentLoadedWithPathFallback,
  normalizeLoopbackBaseUrl,
} from '../../src/testkit/uiE2e/pageNavigation';
import { readCliAccessKey } from '../../src/testkit/cliAccessKey';
import { fetchJson } from '../../src/testkit/http';
import { repoRootDir } from '../../src/testkit/paths';

const run = createRunDirs({ runLabel: 'ui-e2e-real-profile-auth' });
const CLAUDE_TARGET_KEY = buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'claude' });
const CODEX_TARGET_KEY = buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'codex' });

function buildCustomProfile(params: Readonly<{
  id: string;
  name: string;
  claude: boolean;
  codex: boolean;
}>) {
  return AIBackendProfileSchema.parse({
    id: params.id,
    name: params.name,
    environmentVariables: [],
    defaultPermissionModeByAgent: {},
    defaultPermissionModeByTargetKey: {},
    defaultPersistenceModeByAgent: {},
    defaultPersistenceModeByTargetKey: {},
    compatibility: { claude: params.claude, codex: params.codex, gemini: false },
    compatibilityByTargetKey: {
      [CLAUDE_TARGET_KEY]: params.claude,
      [CODEX_TARGET_KEY]: params.codex,
    },
    envVarRequirements: [],
    isBuiltIn: false,
    createdAt: 1,
    updatedAt: 1,
    version: '1.0.0',
  });
}

async function updateSingleAccountSettings(params: Readonly<{
  page: Page;
  baseUrl: string;
  settingsPatch: Readonly<Record<string, unknown>>;
}>): Promise<void> {
  await params.page.evaluate(
    ({ settingsPatch }) => {
      const accountSettingsLogicalKeyPrefix = 'account-settings:v2:';
      const pendingAccountSettingsLogicalKeyPrefix = 'pending-account-settings:v2:';
      const parseSettings = (raw: string | null): Record<string, unknown> => {
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : {};
      };
      const readObjectRecord = (raw: unknown): Record<string, unknown> => (
        typeof raw === 'object' && raw !== null && !Array.isArray(raw)
          ? raw as Record<string, unknown>
          : {}
      );

      const scopedSettingsKeys: Array<{ fullKey: string; logicalKey: string; storageNamespace: string }> = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const rawKey = window.localStorage.key(index);
        if (!rawKey) continue;
        const separatorIndex = rawKey.lastIndexOf('\\');
        if (separatorIndex <= 0 || separatorIndex >= rawKey.length - 1) continue;
        const storageNamespace = rawKey.slice(0, separatorIndex);
        const logicalKey = rawKey.slice(separatorIndex + 1);
        if (!logicalKey.startsWith(accountSettingsLogicalKeyPrefix)) continue;
        scopedSettingsKeys.push({ fullKey: rawKey, logicalKey, storageNamespace });
      }
      if (scopedSettingsKeys.length !== 1) {
        throw new Error(`expected one scoped persisted settings record, got ${scopedSettingsKeys.length}`);
      }

      const settingsKey = scopedSettingsKeys[0]!;
      const pendingSettingsKey = `${settingsKey.storageNamespace}\\${pendingAccountSettingsLogicalKeyPrefix}${settingsKey.logicalKey.slice(accountSettingsLogicalKeyPrefix.length)}`;
      const parsed = parseSettings(window.localStorage.getItem(settingsKey.fullKey));
      const settings = readObjectRecord(parsed.settings);
      const pending = parseSettings(window.localStorage.getItem(pendingSettingsKey));

      window.localStorage.setItem(settingsKey.fullKey, JSON.stringify({
        ...parsed,
        settings: { ...settings, ...settingsPatch },
      }));
      window.localStorage.setItem(pendingSettingsKey, JSON.stringify({ ...pending, ...settingsPatch }));
    },
    { settingsPatch: params.settingsPatch },
  );

  await gotoDomContentLoadedWithPathFallback(params.page, `${params.baseUrl}/?happier_hmr=0`, '/', 180_000);
}

async function readMachineIdsFromServer(params: Readonly<{
  cliHomeDir: string;
  serverBaseUrl: string;
}>): Promise<string[]> {
  const accessKey = await readCliAccessKey(params.cliHomeDir);
  if (!accessKey?.token) return [];
  try {
    const res = await fetchJson<Array<{ id?: unknown }>>(`${params.serverBaseUrl}/v1/machines`, {
      headers: { Authorization: `Bearer ${accessKey.token}` },
      timeoutMs: 5_000,
    });
    if (res.status !== 200 || !Array.isArray(res.data)) return [];
    return res.data
      .map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : ''))
      .filter((value) => value.length > 0);
  } catch {
    return [];
  }
}

async function waitForSingleMachineId(params: Readonly<{
  cliHomeDir: string;
  serverBaseUrl: string;
  timeoutMs?: number;
}>): Promise<string> {
  const timeoutMs = params.timeoutMs ?? 180_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ids = await readMachineIdsFromServer(params);
    if (ids.length > 0) return ids[ids.length - 1]!;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for a machine id from ${params.serverBaseUrl}`);
}

async function waitForTerminalText(page: Page, predicate: (text: string) => boolean): Promise<string> {
  const terminal = page.getByTestId('profile-provision-terminal-xterm');
  await expect(terminal).toHaveCount(1, { timeout: 120_000 });
  let latest = '';
  await expect.poll(async () => {
    latest = await terminal.first().getAttribute('data-happier-terminal-text', { timeout: 1_000 }).catch(() => '') ?? '';
    return predicate(latest);
  }, { timeout: 240_000, intervals: [500, 1_000, 2_000] }).toBe(true);
  return latest;
}

async function openProvisionModal(params: Readonly<{
  page: Page;
  uiBaseUrl: string;
  machineId: string;
  profileId: string;
  backendName: 'Claude' | 'Codex';
  entryScreenshotPath?: string;
  modalScreenshotPath?: string;
}>): Promise<void> {
  await gotoDomContentLoadedWithPathFallback(
    params.page,
    `${params.uiBaseUrl}/new/pick/profile-edit?profileId=${params.profileId}&machineId=${encodeURIComponent(params.machineId)}&happier_hmr=0`,
    '/new/pick/profile-edit',
    180_000,
  );
  const provisionAction = params.page.getByRole('button', { name: new RegExp(`Provision on machine\\s+${params.backendName}`, 'i') }).first();
  await expect(provisionAction).toHaveCount(1, { timeout: 60_000 });
  await provisionAction.scrollIntoViewIfNeeded();
  if (params.entryScreenshotPath) {
    await params.page.screenshot({ path: params.entryScreenshotPath, fullPage: true });
  }
  await provisionAction.click();
  await expect(params.page.getByTestId('profile-provision-auth-prompt')).toHaveCount(1, { timeout: 240_000 });
  if (params.modalScreenshotPath) {
    await params.page.screenshot({ path: params.modalScreenshotPath, fullPage: true });
  }
}

async function waitForLoginUrlText(page: Page, predicate: (text: string) => boolean): Promise<string> {
  const loginUrl = page.getByTestId('profile-provision-login-url');
  await expect(loginUrl).toHaveCount(1, { timeout: 240_000 });
  let latest = '';
  await expect.poll(async () => {
    latest = await loginUrl.first().innerText({ timeout: 1_000 }).catch(() => '');
    return predicate(latest);
  }, { timeout: 240_000, intervals: [500, 1_000, 2_000] }).toBe(true);
  return latest;
}

function normalizeDisplayedLoginUrl(text: string): string {
  return text.replace(/\s+/g, '');
}

test.describe('ui e2e: real profile auth screenshots', () => {
  test.describe.configure({ mode: 'serial' });

  const suiteDir = run.testDir('profile-real-cli-auth-screenshots-suite');
  const cliHomeDir = resolve(join(suiteDir, 'cli-home'));
  const screenshotsDir = resolve(join(suiteDir, 'screenshots'));

  let server: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let uiBaseUrl: string | null = null;
  let daemon: StartedDaemon | null = null;

  test.beforeAll(async () => {
    const uiWebEnv = {
      ...process.env,
      EXPO_PUBLIC_DEBUG: '1',
      HAPPIER_E2E_EXPO_CLEAR: process.env.HAPPIER_E2E_EXPO_CLEAR ?? '1',
      HAPPIER_UI_METRO_FORCE_WATCHMAN: '1',
      HAPPIER_UI_METRO_EXTRA_WATCH_FOLDERS: [
        join(repoRootDir(), 'node_modules'),
        join(repoRootDir(), 'apps/ui/node_modules'),
      ].join(delimiter),
      HAPPIER_E2E_UI_WEB_MODE: process.env.HAPPIER_E2E_UI_WEB_MODE ?? 'export',
      HAPPIER_E2E_UI_WEB_EXPORT_FALLBACK_TO_METRO: process.env.HAPPIER_E2E_UI_WEB_EXPORT_FALLBACK_TO_METRO ?? '0',
      EXPO_PUBLIC_HAPPY_SERVER_URL: server?.baseUrl ?? '',
      EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-real-profile-auth-${run.runId}`,
      HAPPIER_E2E_UI_WEB_EXPORT_TIMEOUT_MS: process.env.HAPPIER_E2E_UI_WEB_EXPORT_TIMEOUT_MS ?? '900000',
      HAPPIER_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS: process.env.HAPPIER_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS ?? '480000',
    };
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(uiWebEnv));
    await mkdir(cliHomeDir, { recursive: true });
    await mkdir(screenshotsDir, { recursive: true });

    server = await startServerLight({
      testDir: suiteDir,
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys',
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
        HAPPIER_PRESENCE_SESSION_TIMEOUT_MS: '60000',
        HAPPIER_PRESENCE_MACHINE_TIMEOUT_MS: '60000',
        HAPPIER_PRESENCE_TIMEOUT_TICK_MS: '1000',
      },
    });
    ui = await startUiWeb({
      testDir: suiteDir,
      env: { ...uiWebEnv, EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl },
    });
    uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await daemon?.stop().catch(() => {});
    await ui?.stop().catch(() => {});
    await server?.stop().catch(() => {});
  });

  test('captures real Claude OAuth link and Codex device code in profile auth PTYs', async ({ page }) => {
    test.setTimeout(720_000);
    if (!server || !uiBaseUrl) throw new Error('missing fixtures');
    await page.setViewportSize({ width: 1440, height: 900 });

    const realClaudePath = process.env.HAPPIER_REAL_CLAUDE_PATH ?? process.env.HAPPIER_CLAUDE_PATH;
    const realCodexPath = process.env.HAPPIER_REAL_CODEX_PATH ?? process.env.HAPPIER_CODEX_PATH;
    if (!realClaudePath) throw new Error('Set HAPPIER_REAL_CLAUDE_PATH or HAPPIER_CLAUDE_PATH');
    if (!realCodexPath) throw new Error('Set HAPPIER_REAL_CODEX_PATH or HAPPIER_CODEX_PATH');

    daemon = await authenticateAndStartDaemon({
      page,
      testDir: resolve(join(suiteDir, 't1-real-profile-auth-screenshots')),
      cliHomeDir,
      serverUrl: server.baseUrl,
      uiBaseUrl,
      initialUiTimeoutMs: 600_000,
      extraEnv: {
        HOME: cliHomeDir,
        HAPPIER_CLAUDE_PATH: realClaudePath,
        HAPPIER_CODEX_PATH: realCodexPath,
        CLAUDE_CONFIG_DIR: resolve(join(cliHomeDir, '.claude')),
        CODEX_HOME: resolve(join(cliHomeDir, '.codex')),
      },
    });

    const machineId = await waitForSingleMachineId({
      cliHomeDir,
      serverBaseUrl: server.baseUrl,
      timeoutMs: 180_000,
    });
    await updateSingleAccountSettings({
      page,
      baseUrl: uiBaseUrl,
      settingsPatch: {
        useProfiles: true,
        lastUsedProfile: 'real-claude',
        lastUsedAgent: 'claude',
        profiles: [
          buildCustomProfile({ id: 'real-claude', name: 'Real Claude Auth', claude: true, codex: false }),
          buildCustomProfile({ id: 'real-codex', name: 'Real Codex Auth', claude: false, codex: true }),
        ],
      },
    });

    await openProvisionModal({
      page,
      uiBaseUrl,
      machineId,
      profileId: 'real-claude',
      backendName: 'Claude',
      entryScreenshotPath: resolve(join(screenshotsDir, 'profile-edit-provision-entry-claude.png')),
      modalScreenshotPath: resolve(join(screenshotsDir, 'claude-provision-modal-default.png')),
    });
    const claudeText = await waitForTerminalText(page, (text) => /https:\/\/[^\s]*\/oauth\/authorize[^\s]*/.test(text));
    expect(claudeText).toMatch(/https:\/\/[^\s]*\/oauth\/authorize[^\s]*/);
    const claudeUrlText = await waitForLoginUrlText(page, (text) => {
      const normalized = normalizeDisplayedLoginUrl(text);
      return normalized.includes('/oauth/authorize')
        && normalized.includes('response_type=code')
        && normalized.includes('redirect_uri=')
        && normalized.includes('code_challenge=')
        && normalized.includes('code_challenge_method=S256')
        && /[?&]state=/.test(normalized);
    });
    const normalizedClaudeUrlText = normalizeDisplayedLoginUrl(claudeUrlText);
    expect(normalizedClaudeUrlText).toContain('/oauth/authorize');
    expect(normalizedClaudeUrlText).toContain('code_challenge_method=S256');
    expect(normalizedClaudeUrlText).toMatch(/[?&]state=[A-Za-z0-9_-]+/);
    await expect(page.getByTestId('profile-provision-device-code')).toHaveCount(0);
    await expect(page.getByTestId('profile-provision-copy-link')).toContainText('Copy URL');
    await expect(page.getByTestId('profile-provision-close')).toHaveCount(0);
    await page.screenshot({ path: resolve(join(screenshotsDir, 'claude-real-oauth-link.png')), fullPage: true });
    await page.getByTestId('profile-provision-toggle-details').click();
    await expect(page.getByTestId('profile-provision-terminal-xterm')).toHaveCount(1, { timeout: 60_000 });
    await page.screenshot({ path: resolve(join(screenshotsDir, 'claude-real-oauth-link-details.png')), fullPage: true });
    await page.getByTestId('profile-provision-header-close').click();
    await expect(page.getByTestId('profile-provision-header-close')).toHaveCount(0, { timeout: 60_000 });

    await openProvisionModal({
      page,
      uiBaseUrl,
      machineId,
      profileId: 'real-codex',
      backendName: 'Codex',
      entryScreenshotPath: resolve(join(screenshotsDir, 'profile-edit-provision-entry-codex.png')),
      modalScreenshotPath: resolve(join(screenshotsDir, 'codex-provision-modal-default.png')),
    });
    const codexText = await waitForTerminalText(page, (text) => {
      const normalized = text.toLowerCase();
      return (normalized.includes('device') && normalized.includes('code'))
        || /[a-z0-9]{4,}[- ][a-z0-9]{4,}/i.test(text)
        || normalized.includes('/codex/device');
    });
    expect(codexText.toLowerCase()).toMatch(/device|code|codex/);
    const codexUrlText = await waitForLoginUrlText(page, (text) => text.includes('https://auth.openai.com/codex/device'));
    expect(codexUrlText).toContain('https://auth.openai.com/codex/device');
    await expect(page.getByTestId('profile-provision-device-code')).toHaveCount(1, { timeout: 240_000 });
    await expect(page.getByTestId('profile-provision-device-code')).toContainText(/[A-Z0-9]{4}-[A-Z0-9]{4,6}/, { timeout: 240_000 });
    await expect(page.getByTestId('profile-provision-copy-link')).toContainText('Copy URL');
    await expect(page.getByTestId('profile-provision-copy-code')).toContainText('Copy Code');
    await expect(page.getByTestId('profile-provision-close')).toHaveCount(0);
    await page.screenshot({ path: resolve(join(screenshotsDir, 'codex-real-device-code.png')), fullPage: true });
    await page.getByTestId('profile-provision-toggle-details').click();
    await expect(page.getByTestId('profile-provision-terminal-xterm')).toHaveCount(1, { timeout: 60_000 });
    await page.screenshot({ path: resolve(join(screenshotsDir, 'codex-real-device-code-details.png')), fullPage: true });

  });
});
