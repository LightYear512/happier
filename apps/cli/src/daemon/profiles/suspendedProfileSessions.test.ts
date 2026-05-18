import { describe, expect, it, vi } from 'vitest';

import { SPAWN_SESSION_ERROR_CODES } from '@/rpc/handlers/registerSessionHandlers';
import { createSuspendedProfileSessionRegistry } from './suspendedProfileSessions';

describe('createSuspendedProfileSessionRegistry', () => {
  it('recovers only suspended sessions for the provisioned backend and profile', async () => {
    const spawnSession = vi.fn(async () => ({ type: 'success', sessionId: 'session-work' } as const));
    const registry = createSuspendedProfileSessionRegistry({ spawnSession });

    registry.add({
      sessionId: 'session-work',
      backendId: 'claude',
      profileId: 'work',
      spawnOptions: { directory: '/work', profileId: 'work' },
    });
    registry.add({
      sessionId: 'session-personal',
      backendId: 'claude',
      profileId: 'personal',
      spawnOptions: { directory: '/personal', profileId: 'personal' },
    });
    registry.add({
      sessionId: 'session-codex',
      backendId: 'codex',
      profileId: 'work',
      spawnOptions: { directory: '/codex', profileId: 'work' },
    });

    await expect(registry.recover({ backendId: 'claude', profileId: 'work' })).resolves.toEqual({
      recoveredSessionIds: ['session-work'],
      failedSessionIds: [],
    });

    expect(spawnSession).toHaveBeenCalledTimes(1);
    expect(spawnSession).toHaveBeenCalledWith({ directory: '/work', profileId: 'work' });
    expect(registry.list()).toEqual([
      expect.objectContaining({ sessionId: 'session-personal' }),
      expect.objectContaining({ sessionId: 'session-codex' }),
    ]);
  });

  it('keeps failed recoveries suspended for a later provision event', async () => {
    const spawnSession = vi.fn(async () => ({
      type: 'error',
      errorCode: SPAWN_SESSION_ERROR_CODES.SPAWN_FAILED,
      errorMessage: 'still unavailable',
    } as const));
    const registry = createSuspendedProfileSessionRegistry({ spawnSession });

    registry.add({
      sessionId: 'session-work',
      backendId: 'claude',
      profileId: 'work',
      spawnOptions: { directory: '/work', profileId: 'work' },
    });

    await expect(registry.recover({ backendId: 'claude', profileId: 'work' })).resolves.toEqual({
      recoveredSessionIds: [],
      failedSessionIds: ['session-work'],
    });
    expect(registry.list()).toEqual([
      expect.objectContaining({ sessionId: 'session-work' }),
    ]);
  });
});
