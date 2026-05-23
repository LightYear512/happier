import { describe, expect, it } from 'vitest';

import { SPAWN_SESSION_ERROR_CODES } from '@/rpc/handlers/registerSessionHandlers';
import { resolveDaemonSpawnProfileEnvForChild } from './resolveDaemonSpawnProfileEnvForChild';

describe('resolveDaemonSpawnProfileEnvForChild', () => {
  it('returns an empty env overlay when the provider has no profile hook', () => {
    expect(resolveDaemonSpawnProfileEnvForChild({
      daemonSpawnHooks: null,
      profileId: 'work',
      processEnv: {},
      activeServerDir: '/tmp/happier',
    })).toEqual({ ok: true, env: {} });
  });

  it('returns provider profile environment overlays', () => {
    expect(resolveDaemonSpawnProfileEnvForChild({
      daemonSpawnHooks: {
        resolveProfileEnvForChild: () => ({ ok: true, env: { CODEX_HOME: '/tmp/codex-work' } }),
      },
      profileId: 'work',
      processEnv: {},
      activeServerDir: '/tmp/happier',
    })).toEqual({ ok: true, env: { CODEX_HOME: '/tmp/codex-work' } });
  });

  it('maps missing provisioned profiles to a stable spawn error', () => {
    expect(resolveDaemonSpawnProfileEnvForChild({
      daemonSpawnHooks: {
        resolveProfileEnvForChild: () => ({
          ok: false,
          reason: 'profile_not_provisioned',
          profileId: 'work',
          expectedDir: '/tmp/happier/profiles/native-cli/codex/work',
        }),
      },
      profileId: 'work',
      processEnv: {},
      activeServerDir: '/tmp/happier',
    })).toEqual({
      ok: false,
      errorCode: SPAWN_SESSION_ERROR_CODES.PROFILE_NOT_PROVISIONED,
      errorMessage: 'Profile work is not provisioned for this provider on this machine.',
      profileId: 'work',
      expectedDir: '/tmp/happier/profiles/native-cli/codex/work',
    });
  });
});
