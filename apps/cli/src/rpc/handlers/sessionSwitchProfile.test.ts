import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import type { RpcHandler, RpcHandlerRegistrar } from '@/api/rpc/types';
import { SPAWN_SESSION_ERROR_CODES } from '@/rpc/handlers/registerSessionHandlers';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import {
  registerSessionSwitchProfileHandler,
  type SessionSwitchProfileDeps,
  type SessionSwitchProfileResult,
} from './sessionSwitchProfile';

type Handler = RpcHandler;

const tempDirs = new Set<string>();
type SessionSwitchProfileTestDeps =
  Omit<SessionSwitchProfileDeps, 'activeServerDir'> &
  Partial<Pick<SessionSwitchProfileDeps, 'activeServerDir'>>;

function createRegistrar(): { handlers: Map<string, Handler> } & RpcHandlerRegistrar {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    registerHandler: <TRequest, TResponse>(method: string, handler: RpcHandler<TRequest, TResponse>) => {
      handlers.set(method, handler);
    },
  };
}

async function createActiveServerDirWithProfile(params: Readonly<{
  backendId: 'claude' | 'codex';
  profileId: string;
}>): Promise<string> {
  const activeServerDir = await createTempDir(`happier-switch-profile-${params.backendId}-`);
  tempDirs.add(activeServerDir);
  const profileDir = join(activeServerDir, 'profiles', 'native-cli', params.backendId, params.profileId);
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(
    join(profileDir, params.backendId === 'claude' ? '.credentials.json' : 'auth.json'),
    params.backendId === 'claude'
      ? JSON.stringify({ accessToken: 'test-claude-token' })
      : JSON.stringify({ tokens: { access_token: 'test-codex-token' } }),
    'utf8',
  );
  return activeServerDir;
}

function makeDeps(overrides: Partial<SessionSwitchProfileDeps> = {}): SessionSwitchProfileTestDeps {
  return {
    findSessionByHappyId: () => ({
      backendId: 'claude',
      profileId: 'old',
      spawnOptions: {
        directory: '/work',
        backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        initialPrompt: 'do not replay',
        resume: 'vendor-old',
      },
    }),
    stopSession: vi.fn(async () => true),
    spawnSession: vi.fn<SessionSwitchProfileDeps['spawnSession']>(async () => ({ type: 'success', sessionId: 'session-1' })),
    addSuspendedSession: vi.fn(),
    removeSuspendedSession: vi.fn(),
    ...overrides,
  };
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await removeTempDir(dir);
  }
  tempDirs.clear();
});

describe('registerSessionSwitchProfileHandler', () => {
  it('stops and respawns the same Happy session under the target profile', async () => {
    const activeServerDir = await createActiveServerDirWithProfile({ backendId: 'claude', profileId: 'work' });
    const registrar = createRegistrar();
    const deps = makeDeps();

    registerSessionSwitchProfileHandler(registrar, { ...deps, activeServerDir });

    await expect(registrar.handlers.get(RPC_METHODS.SESSION_SWITCH_PROFILE)?.({
      sessionId: 'session-1',
      targetProfileId: 'work',
    })).resolves.toEqual({
      type: 'success',
      events: [
        { type: 'switch_pending', targetProfileId: 'work' },
        { type: 'switch_complete', targetProfileId: 'work' },
      ],
    });

    expect(deps.stopSession).toHaveBeenCalledWith('session-1');
    expect(deps.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
      directory: '/work',
      backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
      profileId: 'work',
      existingSessionId: 'session-1',
      resume: undefined,
      initialPrompt: 'do not replay',
    }));
    expect(deps.removeSuspendedSession).toHaveBeenCalledWith('session-1');
  });

  it('rejects unprovisioned target profiles before stopping the current session', async () => {
    const activeServerDir = await createTempDir('happier-switch-profile-empty-');
    tempDirs.add(activeServerDir);
    const registrar = createRegistrar();
    const deps = makeDeps();

    registerSessionSwitchProfileHandler(registrar, { ...deps, activeServerDir });

    await expect(registrar.handlers.get(RPC_METHODS.SESSION_SWITCH_PROFILE)?.({
      sessionId: 'session-1',
      targetProfileId: 'missing',
    })).resolves.toMatchObject({
      type: 'error',
      errorCode: 'PROFILE_NOT_PROVISIONED',
      events: [],
    });
    expect(deps.stopSession).not.toHaveBeenCalled();
    expect(deps.spawnSession).not.toHaveBeenCalled();
  });

  it('rejects target profile ids that escape the backend profile directory', async () => {
    const activeServerDir = await createTempDir('happier-switch-profile-escaped-');
    tempDirs.add(activeServerDir);
    const escapedProfileDir = join(activeServerDir, 'profiles', 'escaped');
    mkdirSync(escapedProfileDir, { recursive: true });
    writeFileSync(join(escapedProfileDir, '.credentials.json'), '{}', 'utf8');
    const registrar = createRegistrar();
    const deps = makeDeps();

    registerSessionSwitchProfileHandler(registrar, { ...deps, activeServerDir });

    await expect(registrar.handlers.get(RPC_METHODS.SESSION_SWITCH_PROFILE)?.({
      sessionId: 'session-1',
      targetProfileId: '../escaped',
    })).resolves.toMatchObject({
      type: 'error',
      errorCode: 'INVALID_REQUEST',
      events: [],
    });
    expect(deps.stopSession).not.toHaveBeenCalled();
    expect(deps.spawnSession).not.toHaveBeenCalled();
  });

  it('suspends the session for profile recovery when respawn fails', async () => {
    const activeServerDir = await createActiveServerDirWithProfile({ backendId: 'codex', profileId: 'work' });
    const registrar = createRegistrar();
    const deps = makeDeps({
      findSessionByHappyId: () => ({
        backendId: 'codex',
        profileId: 'old',
        spawnOptions: {
          directory: '/work',
          backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
        },
      }),
      spawnSession: vi.fn<SessionSwitchProfileDeps['spawnSession']>(async () => ({
        type: 'error',
        errorCode: SPAWN_SESSION_ERROR_CODES.SPAWN_FAILED,
        errorMessage: 'spawn failed',
      })),
    });

    registerSessionSwitchProfileHandler(registrar, { ...deps, activeServerDir });

    await expect(registrar.handlers.get(RPC_METHODS.SESSION_SWITCH_PROFILE)?.({
      sessionId: 'session-1',
      targetProfileId: 'work',
    })).resolves.toMatchObject({
      type: 'error',
      errorCode: 'SWITCH_SPAWN_FAILED',
      events: [
        { type: 'switch_pending', targetProfileId: 'work' },
        { type: 'switch_interrupted', reason: 'spawn_failed', targetProfileId: 'work' },
      ],
    });
    expect(deps.addSuspendedSession).toHaveBeenCalledWith(
      'session-1',
      'codex',
      'work',
      expect.objectContaining({ existingSessionId: 'session-1', profileId: 'work' }),
    );
  });

  it('rejects unsupported provider sessions instead of coercing them to Claude', async () => {
    const activeServerDir = await createActiveServerDirWithProfile({ backendId: 'claude', profileId: 'work' });
    const registrar = createRegistrar();
    const deps = makeDeps({
      findSessionByHappyId: () => ({
        backendId: 'opencode',
        profileId: null,
        spawnOptions: {
          directory: '/work',
          backendTarget: { kind: 'builtInAgent', agentId: 'opencode' },
        },
      }),
    });

    registerSessionSwitchProfileHandler(registrar, { ...deps, activeServerDir });

    await expect(registrar.handlers.get(RPC_METHODS.SESSION_SWITCH_PROFILE)?.({
      sessionId: 'session-1',
      targetProfileId: 'work',
    })).resolves.toMatchObject({
      type: 'error',
      errorCode: 'UNSUPPORTED_BACKEND',
      events: [],
    });
    expect(deps.stopSession).not.toHaveBeenCalled();
  });

  it('broadcasts each emitted event without failing the switch when broadcast throws', async () => {
    const activeServerDir = await createActiveServerDirWithProfile({ backendId: 'claude', profileId: 'work' });
    const registrar = createRegistrar();
    const broadcastSwitchEvent = vi.fn(() => {
      throw new Error('socket gone');
    });

    registerSessionSwitchProfileHandler(registrar, {
      ...makeDeps(),
      activeServerDir,
      broadcastSwitchEvent,
    });

    await expect(registrar.handlers.get(RPC_METHODS.SESSION_SWITCH_PROFILE)?.({
      sessionId: 'session-1',
      targetProfileId: 'work',
    })).resolves.toMatchObject({ type: 'success' });
    expect(broadcastSwitchEvent).toHaveBeenCalledTimes(2);
  });
});
