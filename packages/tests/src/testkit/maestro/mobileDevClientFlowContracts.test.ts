import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sharedFlowUrls = [
  new URL('../../../suites/mobile-e2e/flows/_shared/connectDevClientIfNeeded.yaml', import.meta.url),
  new URL('../../../suites/mobile-e2e/flows/_shared/connectUsingLaunchUrl.yaml', import.meta.url),
];

const manualEntryFlowUrl = new URL(
  '../../../suites/mobile-e2e/flows/_shared/connectUsingManualEntry.yaml',
  import.meta.url,
);
const expoDevMenuOverlayFlowUrl = new URL(
  '../../../suites/mobile-e2e/flows/_shared/dismissExpoDevMenuOverlayMaybe.yaml',
  import.meta.url,
);
const configureServerIfNeededFlowUrl = new URL(
  '../../../suites/mobile-e2e/flows/_shared/configureServerIfNeeded.yaml',
  import.meta.url,
);
const connectedMachineTerminalAuthFlowUrl = new URL(
  '../../../suites/mobile-e2e/flows/_bootstrap/connectedMachineTerminalAuth.yaml',
  import.meta.url,
);
const mobileFlowsRootUrl = new URL('../../../suites/mobile-e2e/flows', import.meta.url);
const connectTerminalSmokeUrl = new URL(
  '../../../suites/mobile-e2e/flows/F2.connectTerminalSmoke.yaml',
  import.meta.url,
);
const keyboardAndNavigationSmokeUrl = new URL(
  '../../../suites/mobile-e2e/flows/F8.keyboardAndNavigationSmoke.yaml',
  import.meta.url,
);
const connectedMachineKeyboardAndNavigationSmokeUrl = new URL(
  '../../../suites/mobile-e2e/flows/F8.connectedMachineKeyboardAndNavigationSmoke.yaml',
  import.meta.url,
);
const populatedRelayPerformanceSmokeUrl = new URL(
  '../../../suites/mobile-e2e/flows/F12.populatedRelaySessionPerformanceSmoke.yaml',
  import.meta.url,
);
const populatedRelayRestoreAndOpenUrl = new URL(
  '../../../suites/mobile-e2e/flows/F13.populatedRelayRestoreAndOpenSessionPerformance.yaml',
  import.meta.url,
);

function listYamlFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        return listYamlFiles(path);
      }
      return entry.endsWith('.yaml') ? [path] : [];
    });
}

describe('mobile Dev Client flow contracts', () => {
  it('dismisses system and Expo overlays before attempting shared bootstrap connection flows', () => {
    const connectIfNeededFlow = readFileSync(sharedFlowUrls[0], 'utf8');
    expect(connectIfNeededFlow).toContain('file: dismissAndroidSystemNotRespondingDialogMaybe.yaml');
    expect(connectIfNeededFlow).toContain('file: dismissDeveloperMenuMaybe.yaml');
    expect(connectIfNeededFlow).toContain('file: dismissExpoDevMenuOverlayMaybe.yaml');

    const launchUrlFlow = readFileSync(sharedFlowUrls[1], 'utf8');
    expect(launchUrlFlow).toContain('file: acceptAndroidOpenWithPromptMaybe.yaml');
    expect(launchUrlFlow).toContain('file: dismissDeveloperMenuMaybe.yaml');
    expect(launchUrlFlow).toContain('file: dismissExpoDevMenuOverlayMaybe.yaml');
  });

  it('prefers the launch-url bootstrap path before falling back to manual entry', () => {
    const flow = readFileSync(sharedFlowUrls[0], 'utf8');
    expect(flow.indexOf('file: connectUsingLaunchUrl.yaml')).toBeGreaterThanOrEqual(0);
    expect(flow.indexOf('file: connectUsingManualEntry.yaml')).toBeGreaterThan(
      flow.indexOf('file: connectUsingLaunchUrl.yaml'),
    );
  });

  it('rewrites the manual-entry Metro field from the env-provided URL before submit', () => {
    const flow = readFileSync(manualEntryFlowUrl, 'utf8');
    const inputTapIndex = flow.indexOf('tapOn: "(http://.*:[0-9]+|exp://.*)"');
    const clipboardIndex = flow.indexOf('setClipboard: ${HAPPIER_E2E_DEV_CLIENT_METRO_URL}');
    const pasteIndex = flow.indexOf('pasteText');
    const androidKeyboardDismissIndex = flow.indexOf('platform: Android', pasteIndex);

    expect(inputTapIndex).toBeGreaterThanOrEqual(0);
    expect(flow).not.toContain('tapOn: "http://localhost:8081"');
    expect(clipboardIndex).toBeGreaterThan(inputTapIndex);
    expect(clipboardIndex).toBeGreaterThan(flow.indexOf('eraseText'));
    expect(pasteIndex).toBeGreaterThan(clipboardIndex);
    expect(androidKeyboardDismissIndex).toBeGreaterThan(pasteIndex);
    expect(flow.indexOf('hideKeyboard', androidKeyboardDismissIndex)).toBeGreaterThan(androidKeyboardDismissIndex);
  });

  it('treats manual-entry submit as complete when Dev Client starts loading', () => {
    const flow = readFileSync(manualEntryFlowUrl, 'utf8');
    const pasteIndex = flow.indexOf('pasteText');
    const conditionalSubmitIndex = flow.indexOf('visible: "Connect"', pasteIndex);
    const submitTapIndex = flow.indexOf('tapOn: "Connect"', conditionalSubmitIndex);
    const loadingWaitIndex = flow.indexOf(
      'visible: "(Loading from|Bundling.*|Downloading.*|Loading\\\\.\\\\.\\\\.|Error loading app|Could not connect to development server|There was a problem loading the project|This is the developer menu.*|Continue|Go home|Go To Home|Login with mobile app|Create account|What would you like to work on\\\\?|Hi! How can I help you today\\\\?|Sessions|Start a session from your computer)"',
      submitTapIndex,
    );

    expect(conditionalSubmitIndex).toBeGreaterThan(pasteIndex);
    expect(submitTapIndex).toBeGreaterThan(conditionalSubmitIndex);
    expect(loadingWaitIndex).toBeGreaterThan(submitTapIndex);
  });

  it('does not assert the manual-entry form while Dev Client is already loading', () => {
    const flow = readFileSync(manualEntryFlowUrl, 'utf8');
    const loadingSurface = '(Loading from|Bundling.*|Downloading.*|Loading\\\\.\\\\.\\\\.)';
    const firstFormAssertIndex = flow.indexOf('assertVisible: "Connect"');
    const loadingGuardIndex = flow.indexOf(`visible: "${loadingSurface}"`);
    const loadingWaitIndex = flow.indexOf(
      'visible: "(Error loading app|Could not connect to development server|There was a problem loading the project|This is the developer menu.*|Continue|Go home|Go To Home|Login with mobile app|Create account|What would you like to work on\\\\?|Hi! How can I help you today\\\\?|Sessions|Start a session from your computer)"',
      loadingGuardIndex,
    );
    const guardedFormIndex = flow.indexOf(`notVisible: "${loadingSurface}"`, loadingWaitIndex);

    expect(loadingGuardIndex).toBeGreaterThanOrEqual(0);
    expect(firstFormAssertIndex === -1 || loadingGuardIndex < firstFormAssertIndex).toBe(true);
    expect(loadingWaitIndex).toBeGreaterThan(loadingGuardIndex);
    expect(guardedFormIndex).toBeGreaterThan(loadingWaitIndex);
  });

  it('recovers from native Dev Client connection redscreens during bootstrap', () => {
    const flow = readFileSync(sharedFlowUrls[0], 'utf8');
    const redscreenText = 'Could not connect to development server';
    const recoveryStart = flow.indexOf('when:\n      visible: "(Error loading app');
    const redscreenRecoveryIndex = flow.indexOf(redscreenText, recoveryStart);
    const reloadTapIndex = flow.indexOf('tapOn: "Reload"', recoveryStart);

    expect(recoveryStart).toBeGreaterThanOrEqual(0);
    expect(redscreenRecoveryIndex).toBeGreaterThan(recoveryStart);
    expect(redscreenRecoveryIndex).toBeLessThan(reloadTapIndex);
    expect(flow.indexOf(redscreenText, reloadTapIndex)).toBeGreaterThan(reloadTapIndex);
  });

  it('retries the launch-url bootstrap path before the manual-entry fallback wait', () => {
    const flow = readFileSync(sharedFlowUrls[0], 'utf8');
    const retryLaunchIndex = flow.lastIndexOf('file: connectUsingLaunchUrl.yaml');
    const manualFallbackWaitIndex = flow.lastIndexOf(
      'visible: "(Login with mobile app|Create account|What would you like to work on\\\\?|Hi! How can I help you today\\\\?|Sessions|Start a session from your computer)"',
    );

    expect(retryLaunchIndex).toBeGreaterThan(flow.indexOf('visible: "Reload"'));
    expect(manualFallbackWaitIndex).toBeGreaterThan(retryLaunchIndex);
  });

  it('waits for Dev Client loading surfaces before manual-entry fallback', () => {
    const launchUrlFlow = readFileSync(sharedFlowUrls[1], 'utf8');
    const loadingSurface = '(Loading from|Bundling.*|Downloading.*|Loading\\\\.\\\\.\\\\.)';
    const loadingWaitIndex = launchUrlFlow.indexOf(`visible: "${loadingSurface}"`);
    const loadingGateIndex = launchUrlFlow.indexOf(`notVisible: "${loadingSurface}"`);
    const manualFallbackIndex = launchUrlFlow.indexOf('file: connectUsingManualEntry.yaml');

    expect(loadingWaitIndex).toBeGreaterThanOrEqual(0);
    expect(loadingWaitIndex).toBeLessThan(manualFallbackIndex);
    expect(loadingGateIndex).toBeGreaterThan(loadingWaitIndex);
    expect(loadingGateIndex).toBeLessThan(manualFallbackIndex);
  });

  it('treats Dev Client overlays as loading completion surfaces', () => {
    const expectedLoadingCompletionSurface =
      'visible: "(Error loading app|Could not connect to development server|There was a problem loading the project|This is the developer menu.*|Continue|Go home|Go To Home|Login with mobile app|Create account|What would you like to work on\\\\?|Hi! How can I help you today\\\\?|Sessions|Start a session from your computer)"';

    for (const flowUrl of [sharedFlowUrls[1], manualEntryFlowUrl]) {
      const flow = readFileSync(flowUrl, 'utf8');
      const loadingGuardIndex = flow.indexOf('visible: "(Loading from|Bundling.*|Downloading.*|Loading\\\\.\\\\.\\\\.)"');
      const completionWaitIndex = flow.indexOf(expectedLoadingCompletionSurface, loadingGuardIndex);

      expect(loadingGuardIndex).toBeGreaterThanOrEqual(0);
      expect(completionWaitIndex).toBeGreaterThan(loadingGuardIndex);
    }
  });

  it('applies the configured server before mobile login even when default auth actions are visible', () => {
    const flow = readFileSync(configureServerIfNeededFlowUrl, 'utf8');
    const serverDeepLink = 'openLink: ${HAPPIER_E2E_MOBILE_APP_SCHEME}:///server?auto=1&url=${HAPPIER_E2E_SERVER_URL}';
    const serverDeepLinkIndex = flow.indexOf(serverDeepLink);
    const createAccountGateIndex = flow.indexOf('notVisible:\n        id: welcome-create-account');
    const finalCreateAccountWaitIndex = flow.lastIndexOf('id: welcome-create-account');

    expect(serverDeepLinkIndex).toBeGreaterThanOrEqual(0);
    expect(createAccountGateIndex).toBe(-1);
    expect(serverDeepLinkIndex).toBeLessThan(finalCreateAccountWaitIndex);
    expect(flow.indexOf('file: acceptIosOpenInPromptMaybe.yaml', serverDeepLinkIndex)).toBeLessThan(
      finalCreateAccountWaitIndex,
    );
    expect(flow.indexOf('file: acceptAndroidOpenWithPromptMaybe.yaml', serverDeepLinkIndex)).toBeLessThan(
      finalCreateAccountWaitIndex,
    );
  });

  it('accepts localized terminal-connect success dialogs', () => {
    const flow = readFileSync(connectedMachineTerminalAuthFlowUrl, 'utf8');
    const approveTapIndex = flow.indexOf('id: terminal-connect-approve');
    const successWaitIndex = flow.indexOf('visible: "(Success|成功)"', approveTapIndex);
    const acknowledgeTapIndex = flow.indexOf('tapOn: "(OK|确定)"', successWaitIndex);
    const homeWaitIndex = flow.indexOf('id: main-header-start-new-session', acknowledgeTapIndex);

    expect(approveTapIndex).toBeGreaterThanOrEqual(0);
    expect(successWaitIndex).toBeGreaterThan(approveTapIndex);
    expect(acknowledgeTapIndex).toBeGreaterThan(successWaitIndex);
    expect(homeWaitIndex).toBeGreaterThan(acknowledgeTapIndex);
  });

  it('dismisses the keyboard after F8 composer input before querying send controls', () => {
    for (const flowUrl of [keyboardAndNavigationSmokeUrl, connectedMachineKeyboardAndNavigationSmokeUrl]) {
      const flow = readFileSync(flowUrl, 'utf8');
      const inputIndex = flow.indexOf('inputText: "MOBILE_E2E_KEYBOARD_SMOKE"');
      const keyboardDismissIndex = flow.indexOf('hideKeyboard', inputIndex);
      const sendAssertIndex = flow.indexOf('id: new-session-composer-send', inputIndex);

      expect(inputIndex).toBeGreaterThanOrEqual(0);
      expect(keyboardDismissIndex).toBeGreaterThan(inputIndex);
      expect(keyboardDismissIndex).toBeLessThan(sendAssertIndex);
    }
  });

  it('accepts app-open prompts after app-scheme navigation smoke deep links', () => {
    const flows = [
      {
        flowUrl: connectTerminalSmokeUrl,
        openLink: '${HAPPIER_E2E_MOBILE_APP_SCHEME}:///settings',
        nextSurface: 'id: settings-connect-terminal-scan',
      },
      {
        flowUrl: keyboardAndNavigationSmokeUrl,
        openLink: '${HAPPIER_E2E_MOBILE_APP_SCHEME}:///settings',
        nextSurface: 'id: settings-connect-terminal-scan',
      },
      {
        flowUrl: keyboardAndNavigationSmokeUrl,
        openLink: '${HAPPIER_E2E_MOBILE_APP_SCHEME}:///',
        nextSurface: 'id: main-header-start-new-session',
      },
      {
        flowUrl: connectedMachineKeyboardAndNavigationSmokeUrl,
        openLink: '${HAPPIER_E2E_MOBILE_APP_SCHEME}:///settings',
        nextSurface: 'id: settings-connect-terminal-scan',
      },
      {
        flowUrl: connectedMachineKeyboardAndNavigationSmokeUrl,
        openLink: '${HAPPIER_E2E_MOBILE_APP_SCHEME}:///',
        nextSurface: 'id: main-header-start-new-session',
      },
    ];

    for (const { flowUrl, openLink, nextSurface } of flows) {
      const flow = readFileSync(flowUrl, 'utf8');
      const openLinkIndex = flow.indexOf(`openLink: ${openLink}`);
      const acceptIosPromptIndex = flow.indexOf('file: _shared/acceptIosOpenInPromptMaybe.yaml', openLinkIndex);
      const acceptAndroidPromptIndex = flow.indexOf(
        'file: _shared/acceptAndroidOpenWithPromptMaybe.yaml',
        openLinkIndex,
      );
      const nextSurfaceIndex = flow.indexOf(nextSurface, openLinkIndex);

      expect(openLinkIndex).toBeGreaterThanOrEqual(0);
      expect(acceptIosPromptIndex).toBeGreaterThan(openLinkIndex);
      expect(acceptIosPromptIndex).toBeLessThan(nextSurfaceIndex);
      expect(acceptAndroidPromptIndex).toBeGreaterThan(openLinkIndex);
      expect(acceptAndroidPromptIndex).toBeLessThan(nextSurfaceIndex);
    }
  });

  it('does not retry manual entry from the shared bootstrap while Dev Client is loading', () => {
    const flow = readFileSync(sharedFlowUrls[0], 'utf8');
    const loadingSurface = '(Loading from|Bundling.*|Downloading.*|Loading\\\\.\\\\.\\\\.)';
    const manualFallbackIndex = flow.lastIndexOf('file: connectUsingManualEntry.yaml');
    const loadingGateIndex = flow.lastIndexOf(`notVisible: "${loadingSurface}"`, manualFallbackIndex);
    const finalCompletionWaitIndex = flow.indexOf(
      'visible: "(Error loading app|Could not connect to development server|There was a problem loading the project|Login with mobile app|使用移动应用登录|Create account|创建账户|What would you like to work on\\\\?|Hi! How can I help you today\\\\?|Sessions|会话|Start a session from your computer|从你的电脑启动会话|开始新会话|准备开始编程？)"',
      manualFallbackIndex,
    );
    const finalAssertIndex = flow.indexOf('assertNotVisible: "There was a problem loading the project"');

    expect(loadingGateIndex).toBeGreaterThanOrEqual(0);
    expect(loadingGateIndex).toBeLessThan(manualFallbackIndex);
    expect(finalCompletionWaitIndex).toBeGreaterThan(manualFallbackIndex);
    expect(finalCompletionWaitIndex).toBeLessThan(finalAssertIndex);
  });

  it('keeps overlay dismissal resilient with both close-first and back fallback branches', () => {
    const flow = readFileSync(expoDevMenuOverlayFlowUrl, 'utf8');

    expect(flow.match(/tapOn:\s*"Close"/g)).toHaveLength(1);
    expect(flow.match(/-\s+back/g)).toHaveLength(2);
    expect(flow.indexOf('tapOn: "Close"')).toBeGreaterThan(flow.indexOf('when:\n            visible: "Close"'));
  });

  it('keeps runFlow file references resolvable relative to their owner flow', () => {
    const missingReferences: string[] = [];
    for (const flowPath of listYamlFiles(mobileFlowsRootUrl.pathname)) {
      const flow = readFileSync(flowPath, 'utf8');
      for (const match of flow.matchAll(/^\s*file:\s*([^#\n]+?)\s*$/gm)) {
        const referencedFile = match[1]?.trim();
        if (!referencedFile || referencedFile.includes('${')) continue;
        const target = join(dirname(flowPath), referencedFile);
        if (!existsSync(target)) {
          missingReferences.push(`${flowPath} -> ${referencedFile}`);
        }
      }
    }

    expect(missingReferences).toEqual([]);
  });

  it('waits for a stable transcript or empty-session surface after populated relay session open', () => {
    const flow = readFileSync(populatedRelayPerformanceSmokeUrl, 'utf8');

    expect(flow).toContain('id: "(transcript-chat-list|session-empty-messages)"');
  });

  it('returns to the session list before populated relay row selection', () => {
    const flow = readFileSync(populatedRelayPerformanceSmokeUrl, 'utf8');

    expect(flow).toContain('id: session-header-back');
    expect(flow.indexOf('id: session-header-back')).toBeLessThan(flow.indexOf('id: "session-list-item-.*"'));
  });

  it('force-loads the current Metro bundle before populated relay telemetry waits', () => {
    const flow = readFileSync(populatedRelayPerformanceSmokeUrl, 'utf8');

    expect(flow).toContain('file: _shared/connectUsingLaunchUrl.yaml');
    expect(flow.indexOf('file: _shared/connectUsingLaunchUrl.yaml')).toBeLessThan(
      flow.indexOf('file: _shared/connectDevClientIfNeeded.yaml'),
    );
  });

  it('restores populated relay accounts from an environment-provided secret beyond the original 64-character limit', () => {
    const flow = readFileSync(populatedRelayRestoreAndOpenUrl, 'utf8');

    const firstChunkIndex = flow.indexOf('inputText: ${HAPPIER_E2E_RESTORE_KEY_CHUNK_01}');
    const ninthChunkIndex = flow.indexOf('inputText: ${HAPPIER_E2E_RESTORE_KEY_CHUNK_09}');

    expect(firstChunkIndex).toBeGreaterThan(flow.indexOf('id: restore-manual-secret-input'));
    expect(ninthChunkIndex).toBeGreaterThan(firstChunkIndex);
    expect(flow).not.toContain('setClipboard: ${HAPPIER_E2E_RESTORE_KEY}');
    expect(flow).not.toContain('pasteText');
    expect(flow).toContain('id: restore-manual-submit');
    expect(ninthChunkIndex).toBeLessThan(flow.indexOf('id: "session-list-item-.*"'));
  });

  it('clears Expo overlays after populated relay server selection before restore', () => {
    const flow = readFileSync(populatedRelayRestoreAndOpenUrl, 'utf8');
    const serverSelectionIndex = flow.indexOf(':///settings/server?auto=1');
    const overlayDismissIndex = flow.indexOf('file: _shared/dismissExpoDevMenuOverlayMaybe.yaml', serverSelectionIndex);
    const restoreIndex = flow.indexOf(':///restore/manual');

    expect(serverSelectionIndex).toBeGreaterThanOrEqual(0);
    expect(overlayDismissIndex).toBeGreaterThan(serverSelectionIndex);
    expect(overlayDismissIndex).toBeLessThan(restoreIndex);
  });

  it('waits for the populated relay server URL before restoring', () => {
    const flow = readFileSync(populatedRelayRestoreAndOpenUrl, 'utf8');
    const serverSelectionIndex = flow.indexOf(':///settings/server?auto=1');
    const serverUrlWaitIndex = flow.indexOf('visible: ".*${HAPPIER_E2E_SERVER_VISIBLE_HOST_PATTERN}.*"', serverSelectionIndex);
    const restoreIndex = flow.indexOf(':///restore/manual');

    expect(serverSelectionIndex).toBeGreaterThanOrEqual(0);
    expect(serverUrlWaitIndex).toBeGreaterThan(serverSelectionIndex);
    expect(serverUrlWaitIndex).toBeLessThan(restoreIndex);
  });

  it('accepts the Android app chooser after populated relay app-scheme deep links', () => {
    const flow = readFileSync(populatedRelayRestoreAndOpenUrl, 'utf8');
    const androidChooserFlow = 'file: _shared/acceptAndroidOpenWithPromptMaybe.yaml';

    const serverSelectionIndex = flow.indexOf(':///settings/server?auto=1');
    const serverChooserIndex = flow.indexOf(androidChooserFlow, serverSelectionIndex);
    const serverUrlWaitIndex = flow.indexOf(
      'visible: ".*${HAPPIER_E2E_SERVER_VISIBLE_HOST_PATTERN}.*"',
      serverSelectionIndex,
    );

    const restoreIndex = flow.indexOf(':///restore/manual');
    const restoreChooserIndex = flow.indexOf(androidChooserFlow, restoreIndex);
    const restoreInputWaitIndex = flow.indexOf('id: restore-manual-secret-input', restoreIndex);

    expect(serverSelectionIndex).toBeGreaterThanOrEqual(0);
    expect(serverChooserIndex).toBeGreaterThan(serverSelectionIndex);
    expect(serverChooserIndex).toBeLessThan(serverUrlWaitIndex);
    expect(restoreIndex).toBeGreaterThanOrEqual(0);
    expect(restoreChooserIndex).toBeGreaterThan(restoreIndex);
    expect(restoreChooserIndex).toBeLessThan(restoreInputWaitIndex);
  });

  it('accepts the current session cockpit surface after populated relay session open', () => {
    const flow = readFileSync(populatedRelayRestoreAndOpenUrl, 'utf8');

    expect(flow).toContain('id: "session-cockpit-tabbar-.*"');
  });
});
