import { test, expect, type Page } from '@playwright/test';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { AIBackendProfileSchema, buildBackendTargetKey } from '@happier-dev/protocol';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { fakeClaudeFixturePath, waitForFakeClaudeInvocation } from '../../src/testkit/fakeClaude';
import { readCliAccessKey } from '../../src/testkit/cliAccessKey';
import { fetchJson } from '../../src/testkit/http';
import { authenticateAndStartDaemon } from '../../src/testkit/uiE2e/authenticateAndStartDaemon';
import { createSessionFromNewSessionComposer } from '../../src/testkit/uiE2e/createSessionFromNewSessionComposer';
import {
  gotoDomContentLoadedWithPathFallback,
  normalizeLoopbackBaseUrl,
} from '../../src/testkit/uiE2e/pageNavigation';
import { repoRootDir } from '../../src/testkit/paths';

const run = createRunDirs({ runLabel: 'ui-e2e' });
const CLAUDE_TARGET_KEY = buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'claude' });

function buildCustomClaudeProfile(params: Readonly<{ id: string; name: string }>) {
  return AIBackendProfileSchema.parse({
    id: params.id,
    name: params.name,
    environmentVariables: [],
    defaultPermissionModeByAgent: {},
    defaultPermissionModeByTargetKey: {},
    defaultPersistenceModeByAgent: {},
    defaultPersistenceModeByTargetKey: {},
    compatibility: { claude: true, codex: false, gemini: false },
    compatibilityByTargetKey: {
      [CLAUDE_TARGET_KEY]: true,
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

      window.localStorage.setItem(
        settingsKey.fullKey,
        JSON.stringify({
          ...parsed,
          settings: {
            ...settings,
            ...settingsPatch,
          },
        }),
      );
      window.localStorage.setItem(
        pendingSettingsKey,
        JSON.stringify({
          ...pending,
          ...settingsPatch,
        }),
      );
    },
    { settingsPatch: params.settingsPatch },
  );

  await gotoDomContentLoadedWithPathFallback(
    params.page,
    `${params.baseUrl}/?happier_hmr=0`,
    '/',
    180_000,
  );
}

async function resolveActiveServerDir(cliHomeDir: string): Promise<string> {
  try {
    const raw = await readFile(join(cliHomeDir, 'settings.json'), 'utf8');
    const parsed = JSON.parse(raw) as { activeServerId?: unknown } | null;
    const activeServerId = typeof parsed?.activeServerId === 'string' ? parsed.activeServerId.trim() : '';
    if (activeServerId) {
      return resolve(join(cliHomeDir, 'servers', activeServerId));
    }
  } catch {
    // fall through to directory scan
  }

  const serversDir = resolve(join(cliHomeDir, 'servers'));
  const serverIds = (await readdir(serversDir).catch(() => []))
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort();
  if (serverIds.length === 0) {
    throw new Error(`No active server directory found in ${serversDir}`);
  }
  return resolve(join(serversDir, serverIds[serverIds.length - 1]!));
}

async function seedProvisionedClaudeProfileDir(params: Readonly<{
  activeServerDir: string;
  profileId: string;
}>): Promise<void> {
  const profileDir = resolve(join(params.activeServerDir, 'profiles', 'native-cli', 'claude', params.profileId));
  await mkdir(resolve(join(profileDir, 'projects')), { recursive: true });
  await mkdir(resolve(join(profileDir, 'skills')), { recursive: true });
  await mkdir(resolve(join(profileDir, 'agents')), { recursive: true });
  await mkdir(resolve(join(profileDir, 'commands')), { recursive: true });
  await writeFile(resolve(join(profileDir, '.credentials.json')), '{"accessToken":"test-token"}\n', 'utf8');
  await writeFile(resolve(join(profileDir, 'settings.json')), '{}\n', 'utf8');
}

async function readMachineIdsFromServer(params: Readonly<{
  cliHomeDir: string;
  serverBaseUrl: string;
}>): Promise<string[]> {
  const accessKey = await readCliAccessKey(params.cliHomeDir);
  if (!accessKey?.token) return [];
  try {
    const res = await fetchJson<Array<{ id?: unknown }>>(`${params.serverBaseUrl}/v1/machines`, {
      headers: {
        Authorization: `Bearer ${accessKey.token}`,
      },
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
  const timeoutMs = params.timeoutMs ?? 120_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ids = await readMachineIdsFromServer(params);
    if (ids.length > 0) {
      return ids[ids.length - 1]!;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for a machine id from ${params.serverBaseUrl}`);
}

function transcriptMessageLocator(page: Page) {
  return page.locator('[data-testid^="transcript-message-"]');
}

function sessionProfileChip(page: Page) {
  return page.getByTestId('agent-input-profile-chip').first();
}

async function waitForTerminalTranscriptOrProvisionCompletion(page: Page, testId: string, needle: string): Promise<void> {
  const terminal = page.getByTestId(testId);
  await expect.poll(async () => {
    const statusText = await page.getByTestId('profile-provision-status-text').innerText({ timeout: 1_000 }).catch(() => '');
    if (statusText.includes('Profile provisioning completed.')) return 'completed';
    if (await terminal.count() === 0) return 'pending';
    const text = await terminal.first().getAttribute('data-happier-terminal-text', { timeout: 1_000 }).catch(() => null);
    return text?.includes(needle) ? 'terminal-output' : 'pending';
  }, { timeout: 180_000 }).not.toBe('pending');
}

function visibleDropdownOptions(page: Page) {
  return page.locator('[data-testid^="dropdown-option-"]:visible');
}

function switchProfileDropdownOption(page: Page) {
  return page.locator('[data-testid="dropdown-option-session_switchProfile"]:visible').first();
}

async function openSessionActionsMenu(page: Page): Promise<void> {
  const sessionActionsTrigger = page.getByLabel('Open session actions');
  await expect(sessionActionsTrigger).toHaveCount(1, { timeout: 60_000 });
  await sessionActionsTrigger.click();
  await expect.poll(async () => visibleDropdownOptions(page).count(), { timeout: 60_000 }).toBeGreaterThan(0);
}

test.describe('ui e2e: profile provision + switch', () => {
  test.describe.configure({ mode: 'serial' });

  const suiteDir = run.testDir('profile-provision-switch-suite');
  const cliHomeDir = resolve(join(suiteDir, 'cli-home'));
  const fakeClaudeLogPath = resolve(join(suiteDir, 'fake-claude.jsonl'));

  let server: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let uiBaseUrl: string | null = null;
  let daemon: StartedDaemon | null = null;

  test.beforeAll(async () => {
    const uiWebEnv = {
      ...process.env,
      EXPO_PUBLIC_DEBUG: '1',
      HAPPIER_E2E_EXPO_CLEAR: '1',
      HAPPIER_UI_METRO_FORCE_WATCHMAN: '1',
      HAPPIER_UI_METRO_EXTRA_WATCH_FOLDERS: [
        join(repoRootDir(), 'node_modules'),
        join(repoRootDir(), 'apps/ui/node_modules'),
      ].join(delimiter),
      HAPPIER_E2E_UI_WEB_MODE: 'export',
      HAPPIER_E2E_UI_WEB_EXPORT_FALLBACK_TO_METRO: '0',
      EXPO_PUBLIC_HAPPY_SERVER_URL: server?.baseUrl ?? '',
      EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-${run.runId}`,
      HAPPIER_E2E_UI_WEB_EXPORT_TIMEOUT_MS: process.env.HAPPIER_E2E_UI_WEB_EXPORT_TIMEOUT_MS ?? '900000',
      HAPPIER_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS: process.env.HAPPIER_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS ?? '480000',
    };
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(uiWebEnv));
    await mkdir(cliHomeDir, { recursive: true });

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
      env: {
        ...uiWebEnv,
        EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl,
      },
    });
    uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await daemon?.stop().catch(() => {});
    await ui?.stop().catch(() => {});
    await server?.stop().catch(() => {});
  });

  test('verifies provision entry and end-to-end session profile switch', async ({ page }) => {
    test.setTimeout(600_000);
    if (!server) throw new Error('missing server fixture');
    if (!uiBaseUrl) throw new Error('missing ui base url');

    daemon = await authenticateAndStartDaemon({
      page,
      testDir: resolve(join(suiteDir, 't1-profile-provision-switch')),
      cliHomeDir,
      serverUrl: server.baseUrl,
      uiBaseUrl,
      extraEnv: {
        HAPPIER_CLAUDE_PATH: fakeClaudeFixturePath(),
        HAPPIER_E2E_FAKE_CLAUDE_LOG: fakeClaudeLogPath,
      },
    });

    const machineId = await waitForSingleMachineId({
      cliHomeDir,
      serverBaseUrl: server.baseUrl,
      timeoutMs: 180_000,
    });
    const activeServerDir = await resolveActiveServerDir(cliHomeDir);
    await seedProvisionedClaudeProfileDir({ activeServerDir, profileId: 'anthropic' });

    await updateSingleAccountSettings({
      page,
      baseUrl: uiBaseUrl,
      settingsPatch: {
        useProfiles: true,
        lastUsedProfile: 'anthropic',
        lastUsedAgent: 'claude',
        profiles: [
          buildCustomClaudeProfile({ id: 'work', name: 'Work Claude' }),
        ],
      },
    });

    await gotoDomContentLoadedWithPathFallback(
      page,
      `${uiBaseUrl}/new/pick/profile-edit?profileId=work&machineId=${encodeURIComponent(machineId)}`,
      '/new/pick/profile-edit',
      180_000,
    );
    const provisionAction = page.getByRole('button', { name: /Provision on machine\s+Claude/i }).first();
    await expect(provisionAction).toHaveCount(1, { timeout: 60_000 });
    await provisionAction.scrollIntoViewIfNeeded();
    await provisionAction.click();
    await waitForTerminalTranscriptOrProvisionCompletion(
      page,
      'profile-provision-terminal-xterm',
      'https://example.test/fake-claude-profile-auth',
    );
    const workProfileDir = resolve(join(activeServerDir, 'profiles', 'native-cli', 'claude', 'work'));
    await expect.poll(async () => {
      try {
        const raw = await readFile(resolve(join(workProfileDir, '.credentials.json')), 'utf8');
        return raw.includes('fake-claude-profile-auth-token');
      } catch {
        return false;
      }
    }, { timeout: 60_000 }).toBe(true);
    await waitForFakeClaudeInvocation(fakeClaudeLogPath, (invocation) => (
      invocation.mode === 'local'
      && Array.isArray(invocation.argv)
      && invocation.argv.length === 0
      && invocation.cwd === workProfileDir
    ), { timeoutMs: 60_000 });
    await expect(page.getByTestId('profile-provision-status-text')).toContainText('Profile provisioning completed.', { timeout: 60_000 });
    await expect(page.getByTestId('profile-provision-close')).toHaveCount(0);
    await page.getByTestId('profile-provision-header-close').click();
    await expect(page.getByTestId('profile-provision-header-close')).toHaveCount(0, { timeout: 60_000 });

    const sessionId = await createSessionFromNewSessionComposer({
      page,
      uiBaseUrl,
      machineId,
      prompt: `PROFILE_SWITCH_QA_INITIAL_${run.runId}`,
    });
    await expect.poll(async () => transcriptMessageLocator(page).count(), { timeout: 180_000 }).toBeGreaterThan(1);
    await expect(sessionProfileChip(page)).toContainText('Anthropic', { timeout: 180_000 });

    const transcriptCountBeforeSwitch = await transcriptMessageLocator(page).count();

    await openSessionActionsMenu(page);
    await expect(switchProfileDropdownOption(page)).toHaveCount(1, { timeout: 60_000 });
    await switchProfileDropdownOption(page).click();
    await expect(page.getByTestId('web-modal-confirm')).toHaveCount(1, { timeout: 60_000 });
    await page.getByTestId('web-modal-confirm').click();

    await expect(sessionProfileChip(page)).toContainText('Work Claude', { timeout: 180_000 });

    const sessionComposer = page.locator('textarea[data-testid="session-composer-input"]:visible').first();
    await expect(sessionComposer).toHaveCount(1, { timeout: 180_000 });
    await sessionComposer.fill(`PROFILE_SWITCH_QA_AFTER_${run.runId}`);
    const sendButton = page.getByTestId('session-composer-send');
    await expect(sendButton).toBeEnabled({ timeout: 60_000 });
    await sendButton.click();
    await expect.poll(async () => transcriptMessageLocator(page).count(), { timeout: 180_000 }).toBeGreaterThan(
      transcriptCountBeforeSwitch,
    );

    await openSessionActionsMenu(page);
    await expect(switchProfileDropdownOption(page)).toHaveCount(0, { timeout: 60_000 });
  });
});
