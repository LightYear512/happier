import { beforeEach, describe, expect, it } from 'vitest';
import { accountSettingsParse } from '@happier-dev/protocol';

import { createMcpActionSettingsProvider } from './createMcpActionEnablement';
import {
  resetActiveAccountSettingsSnapshotForTests,
  setActiveAccountSettingsSnapshot,
} from '@/settings/accountSettings/activeAccountSettingsSnapshot';

describe('createMcpActionSettingsProvider', () => {
  beforeEach(() => {
    resetActiveAccountSettingsSnapshotForTests();
  });

  it('prefers explicitly injected account settings over a process-global active snapshot', () => {
    setActiveAccountSettingsSnapshot({
      source: 'cache',
      settings: accountSettingsParse({}),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
    });

    const injected = accountSettingsParse({
      actionsSettingsV1: {
        v: 1,
        actions: {
          'session.spawn_new': {
            disabledSurfaces: ['session_agent'],
          },
        },
      },
    });

    const provider = createMcpActionSettingsProvider({ accountSettings: injected });

    expect(provider.getAccountSettings()).toBe(injected);
    expect(provider.getActionsSettings().actions['session.spawn_new']?.disabledSurfaces)
      .toEqual(['session_agent']);
  });
});
