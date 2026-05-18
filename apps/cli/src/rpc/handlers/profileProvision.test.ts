import { describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import type { RpcHandler, RpcHandlerRegistrar } from '@/api/rpc/types';
import {
  __test_profileProvisionProgress,
  registerProfileProvisionHandlers,
  type ProfileProvisionDeps,
} from './profileProvision';

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

describe('registerProfileProvisionHandlers', () => {
  it('registers provision and progress polling RPC methods', () => {
    const registrar = createRegistrar();

    registerProfileProvisionHandlers(registrar);

    expect(registrar.handlers.has(RPC_METHODS.PROFILE_PROVISION)).toBe(true);
    expect(registrar.handlers.has(RPC_METHODS.PROFILE_PROVISION_POLL_PROGRESS)).toBe(true);
  });

  it('provisions Claude profiles and calls suspended-session recovery', async () => {
    const registrar = createRegistrar();
    const tryRecoverSuspendedSessions = vi.fn();
    const deps: ProfileProvisionDeps = {
      provisionClaude: async ({ onPtyOutput }) => {
        onPtyOutput('login-url');
        return { profileDir: '/profiles/claude/work', alreadyProvisioned: false };
      },
      provisionCodex: async () => {
        throw new Error('unexpected codex provision');
      },
    };

    registerProfileProvisionHandlers(registrar, {
      deps,
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
      profileDir: '/profiles/claude/work',
      alreadyProvisioned: false,
      ptyOutput: 'login-url',
    });
    expect(tryRecoverSuspendedSessions).toHaveBeenCalledWith('work', 'claude');
  });

  it('exposes live PTY output while provision is still running', async () => {
    const registrar = createRegistrar();
    const deferred = createDeferred();
    const deps: ProfileProvisionDeps = {
      provisionClaude: async ({ onPtyOutput }) => {
        onPtyOutput('oauth-url');
        await deferred.promise;
        return { profileDir: '/profiles/claude/work', alreadyProvisioned: false };
      },
      provisionCodex: async () => {
        throw new Error('unexpected codex provision');
      },
    };

    registerProfileProvisionHandlers(registrar, {
      deps,
      activeServerDir: '/active',
      processEnv: {},
    });

    const provisionPromise = registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION)?.({
      profileId: 'work',
      backendId: 'claude',
      machineId: 'm1',
    });

    await expect(registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION_POLL_PROGRESS)?.({
      profileId: 'work',
      backendId: 'claude',
    })).resolves.toEqual({
      output: 'oauth-url',
      completed: false,
    });

    deferred.resolve();
    await expect(provisionPromise).resolves.toMatchObject({ type: 'success' });
    await expect(registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION_POLL_PROGRESS)?.({
      profileId: 'work',
      backendId: 'claude',
    })).resolves.toEqual({
      output: 'oauth-url',
      completed: true,
    });
  });

  it('deduplicates concurrent provisions for the same backend and profile', async () => {
    const registrar = createRegistrar();
    const provisionClaude = vi.fn(async ({ onPtyOutput }: Parameters<ProfileProvisionDeps['provisionClaude']>[0]) => {
      onPtyOutput('done');
      return { profileDir: '/profiles/claude/work', alreadyProvisioned: false };
    });

    registerProfileProvisionHandlers(registrar, {
      deps: {
        provisionClaude,
        provisionCodex: async () => {
          throw new Error('unexpected codex provision');
        },
      },
      activeServerDir: '/active',
      processEnv: {},
    });

    const handler = registrar.handlers.get(RPC_METHODS.PROFILE_PROVISION);
    const first = handler?.({ profileId: 'work', backendId: 'claude', machineId: 'm1' });
    const second = handler?.({ profileId: 'work', backendId: 'claude', machineId: 'm1' });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { type: 'success', profileDir: '/profiles/claude/work', alreadyProvisioned: false, ptyOutput: 'done' },
      { type: 'success', profileDir: '/profiles/claude/work', alreadyProvisioned: false, ptyOutput: 'done' },
    ]);
    expect(provisionClaude).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed profile provision requests', async () => {
    const registrar = createRegistrar();
    const provisionClaude = vi.fn<ProfileProvisionDeps['provisionClaude']>();

    registerProfileProvisionHandlers(registrar, {
      deps: {
        provisionClaude,
        provisionCodex: vi.fn<ProfileProvisionDeps['provisionCodex']>(),
      },
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
    expect(provisionClaude).not.toHaveBeenCalled();
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
