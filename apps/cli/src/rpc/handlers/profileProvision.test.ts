import { describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import type { RpcHandler, RpcHandlerRegistrar } from '@/api/rpc/types';
import {
  __test_profileProvisionProgress,
  registerProfileProvisionHandlers,
  type ProfileProvisionDeps,
} from './profileProvision';
import type { CliProfileAuthProvider } from '@/backends/types';

type Handler = RpcHandler;

function createRegistrar(): { handlers: Map<string, Handler> } & RpcHandlerRegistrar {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    registerHandler: <TRequest, TResponse>(method: string, handler: RpcHandler<TRequest, TResponse>) => {
      handlers.set(method, handler);
    },
  };
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createProfileAuthProvider(overrides: Partial<CliProfileAuthProvider> = {}): CliProfileAuthProvider {
  return {
    providerId: 'claude',
    buildProfileDir: ({ activeServerDir, profileId }) => `${activeServerDir}/profiles/native-cli/claude/${profileId}`,
    prepareProfileDir: ({ activeServerDir, profileId }) => ({
      profileDir: `${activeServerDir}/profiles/native-cli/claude/${profileId}`,
      createdByThisRun: true,
    }),
    buildIsolatedLoginContext: ({ profileDir }) => ({
      command: '/bin/claude',
      args: ['--flag'],
      initialInput: '/login\r',
      env: { PATH: '/usr/bin', CLAUDE_CONFIG_DIR: profileDir },
      allowlistedEnvKeys: ['CLAUDE_CONFIG_DIR'],
    }),
    isProfileProvisioned: () => false,
    cleanupFailedPrepare: vi.fn(),
    ...overrides,
  };
}

describe('registerProfileProvisionHandlers', () => {
  it('registers provision and progress polling RPC methods', () => {
    const registrar = createRegistrar();

    registerProfileProvisionHandlers(registrar);

    expect(registrar.handlers.has(RPC_METHODS.PROFILE_PROVISION)).toBe(true);
    expect(registrar.handlers.has(RPC_METHODS.PROFILE_PROVISION_POLL_PROGRESS)).toBe(true);
  });

  it('prepares a provider-owned profile auth session without spawning the provider CLI', async () => {
    const registrar = createRegistrar();
    const provider = createProfileAuthProvider();
    const getProfileAuthProvider = vi.fn(async () => provider);
    const create = vi.fn((params: Parameters<ProfileProvisionDeps['profileAuthSessions']['create']>[0]) => ({
      profileAuthSessionId: 'auth-work',
      providerId: params.providerId,
      profileId: params.profileId,
      profileDir: params.profileDir,
      terminalKey: params.terminalKey,
      command: params.loginContext.command,
      args: params.loginContext.args,
      env: params.loginContext.env,
      initialInput: params.loginContext.initialInput,
      cwd: params.loginContext.cwd,
      expiresAtMs: Number.MAX_SAFE_INTEGER,
    }));

    registerProfileProvisionHandlers(registrar, {
      deps: {
        getProfileAuthProvider,
        profileAuthSessions: {
          create,
          get: () => null,
          delete: () => {},
          reset: () => {},
        },
      },
      activeServerDir: '/active',
      processEnv: { PATH: '/usr/bin' },
    });

    await expect(registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION)?.({
      profileId: 'work',
      backendId: 'claude',
      machineId: 'machine-a',
    })).resolves.toMatchObject({
      type: 'success',
      profileDir: '/active/profiles/native-cli/claude/work',
      alreadyProvisioned: false,
      ptyOutput: '',
      terminalKey: 'profile-login:machine-a:claude:work',
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      terminalKey: 'profile-login:machine-a:claude:work',
    }));
    const response = await registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION)?.({
      profileId: 'other',
      backendId: 'claude',
      machineId: 'machine-a',
    }) as any;
    expect(response.profileAuthSessionId).toEqual(expect.any(String));
    expect(getProfileAuthProvider).toHaveBeenCalledWith('claude');
  });

  it('deduplicates concurrent prepare calls by machine, backend, and profile', async () => {
    const registrar = createRegistrar();
    const provider = createProfileAuthProvider();
    const getProfileAuthProvider = vi.fn(async () => provider);

    registerProfileProvisionHandlers(registrar, {
      deps: { getProfileAuthProvider },
      activeServerDir: '/active',
      processEnv: {},
    });

    const handler = registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION);
    const first = handler?.({ profileId: 'work', backendId: 'claude', machineId: 'machine-a' });
    const second = handler?.({ profileId: 'work', backendId: 'claude', machineId: 'machine-b' });

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ type: 'success', terminalKey: 'profile-login:machine-a:claude:work' }),
      expect.objectContaining({ type: 'success', terminalKey: 'profile-login:machine-b:claude:work' }),
    ]);
    expect(getProfileAuthProvider).toHaveBeenCalledTimes(2);
  });

  it('prepares Claude profiles without recovering suspended sessions before credentials exist', async () => {
    const registrar = createRegistrar();
    const tryRecoverSuspendedSessions = vi.fn();
    const provider = createProfileAuthProvider();

    registerProfileProvisionHandlers(registrar, {
      deps: { getProfileAuthProvider: async () => provider },
      tryRecoverSuspendedSessions,
      activeServerDir: '/active',
      processEnv: {},
    });

    await expect(registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION)?.({
      profileId: 'work',
      backendId: 'claude',
      machineId: 'm1',
    })).resolves.toEqual({
      type: 'success',
      profileDir: '/active/profiles/native-cli/claude/work',
      alreadyProvisioned: false,
      ptyOutput: '',
      profileAuthSessionId: expect.any(String),
      terminalKey: 'profile-login:m1:claude:work',
    });
    expect(tryRecoverSuspendedSessions).not.toHaveBeenCalled();
  });

  it('recovers suspended sessions when prepare finds an already provisioned profile', async () => {
    const registrar = createRegistrar();
    const tryRecoverSuspendedSessions = vi.fn();
    const provider = createProfileAuthProvider({
      isProfileProvisioned: () => true,
    });

    registerProfileProvisionHandlers(registrar, {
      deps: { getProfileAuthProvider: async () => provider },
      tryRecoverSuspendedSessions,
      activeServerDir: '/active',
      processEnv: {},
    });

    await expect(registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION)?.({
      profileId: 'work',
      backendId: 'claude',
      machineId: 'm1',
    })).resolves.toMatchObject({
      type: 'success',
      alreadyProvisioned: true,
      profileAuthSessionId: null,
    });
    expect(tryRecoverSuspendedSessions).toHaveBeenCalledWith('work', 'claude');
  });

  it('reports prepare completion through progress polling', async () => {
    const registrar = createRegistrar();
    const provider = createProfileAuthProvider();

    registerProfileProvisionHandlers(registrar, {
      deps: { getProfileAuthProvider: async () => provider },
      activeServerDir: '/active',
      processEnv: {},
    });

    await expect(registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION)?.({
      profileId: 'work',
      backendId: 'claude',
      machineId: 'm1',
    })).resolves.toMatchObject({ type: 'success' });

    await expect(registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION_POLL_PROGRESS)?.({
      profileId: 'work',
      backendId: 'claude',
      machineId: 'm1',
    })).resolves.toEqual({
      output: '',
      completed: true,
    });
  });

  it('deduplicates concurrent prepare calls for the same machine, backend, and profile', async () => {
    const registrar = createRegistrar();
    const deferred = createDeferred();
    const provider = createProfileAuthProvider({
      buildIsolatedLoginContext: async (params) => {
        await deferred.promise;
        return {
          command: '/bin/claude',
          args: [],
          env: { CLAUDE_CONFIG_DIR: params.profileDir },
          allowlistedEnvKeys: ['CLAUDE_CONFIG_DIR'],
        };
      },
    });
    const getProfileAuthProvider = vi.fn(async () => provider);

    registerProfileProvisionHandlers(registrar, {
      deps: { getProfileAuthProvider },
      activeServerDir: '/active',
      processEnv: {},
    });

    const handler = registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION);
    const first = handler?.({ profileId: 'work', backendId: 'claude', machineId: 'm1' });
    const second = handler?.({ profileId: 'work', backendId: 'claude', machineId: 'm1' });
    deferred.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ type: 'success', profileDir: '/active/profiles/native-cli/claude/work' }),
      expect.objectContaining({ type: 'success', profileDir: '/active/profiles/native-cli/claude/work' }),
    ]);
    expect(getProfileAuthProvider).toHaveBeenCalledTimes(1);
  });

  it('verify-only requests do not create a new auth session when credentials are still missing', async () => {
    const registrar = createRegistrar();
    const create = vi.fn();
    const provider = createProfileAuthProvider({
      isProfileProvisioned: () => false,
    });

    registerProfileProvisionHandlers(registrar, {
      deps: {
        getProfileAuthProvider: async () => provider,
        profileAuthSessions: {
          create,
          get: () => null,
          delete: () => {},
          reset: () => {},
        },
      },
      activeServerDir: '/active',
      processEnv: {},
    });

    await expect(registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION)?.({
      profileId: 'work',
      backendId: 'claude',
      machineId: 'm1',
      profileAuthSessionId: 'auth-1',
      verifyOnly: true,
    })).resolves.toMatchObject({
      type: 'error',
      errorCode: 'PROVISION_FAILED',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('verify-only requests report success when credentials are present', async () => {
    const registrar = createRegistrar();
    const create = vi.fn();
    const deleteSession = vi.fn();
    const provider = createProfileAuthProvider({
      isProfileProvisioned: () => true,
    });

    registerProfileProvisionHandlers(registrar, {
      deps: {
        getProfileAuthProvider: async () => provider,
        profileAuthSessions: {
          create,
          get: () => null,
          delete: deleteSession,
          reset: () => {},
        },
      },
      activeServerDir: '/active',
      processEnv: {},
    });

    await expect(registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION)?.({
      profileId: 'work',
      backendId: 'claude',
      machineId: 'm1',
      profileAuthSessionId: 'auth-1',
      verifyOnly: true,
    })).resolves.toEqual({
      type: 'success',
      profileDir: '/active/profiles/native-cli/claude/work',
      alreadyProvisioned: true,
      ptyOutput: '',
      profileAuthSessionId: null,
      terminalKey: 'profile-login:m1:claude:work',
    });
    expect(create).not.toHaveBeenCalled();
    expect(deleteSession).toHaveBeenCalledWith('auth-1');
  });

  it('rejects malformed profile provision requests', async () => {
    const registrar = createRegistrar();
    const getProfileAuthProvider = vi.fn<ProfileProvisionDeps['getProfileAuthProvider']>();

    registerProfileProvisionHandlers(registrar, {
      deps: { getProfileAuthProvider },
    });

    await expect(registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION)?.({
      profileId: '',
      backendId: 'claude',
      machineId: 'm1',
    })).resolves.toMatchObject({
      type: 'error',
      errorCode: 'INVALID_REQUEST',
    });

    await expect(registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION)?.({
      profileId: '../escaped',
      backendId: 'claude',
      machineId: 'm1',
    })).resolves.toMatchObject({
      type: 'error',
      errorCode: 'INVALID_REQUEST',
    });
    expect(getProfileAuthProvider).not.toHaveBeenCalled();
  });
});

describe('__test_profileProvisionProgress', () => {
  it('resets stale completed entries after the progress ttl', () => {
    vi.useFakeTimers();
    try {
      __test_profileProvisionProgress.reset();
      vi.setSystemTime(new Date(2030, 0, 1));
      const key = __test_profileProvisionProgress.progressKey('claude', 'work');
      const entry = __test_profileProvisionProgress.ensureProgressEntry(key);
      entry.output = 'old';
      __test_profileProvisionProgress.markProgressCompleted(key);

      vi.setSystemTime(Date.now() + __test_profileProvisionProgress.ttlMs + 1);
      expect(__test_profileProvisionProgress.ensureProgressEntry(key)).toEqual({
        output: '',
        completed: false,
        completedAt: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
