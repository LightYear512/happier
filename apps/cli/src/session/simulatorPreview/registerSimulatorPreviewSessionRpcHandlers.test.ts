import { describe, expect, it, vi } from 'vitest';

import { registerSimulatorPreviewSessionRpcHandlers } from './registerSimulatorPreviewSessionRpcHandlers';

type RegistryParam = Parameters<typeof registerSimulatorPreviewSessionRpcHandlers>[0]['registry'];

describe('registerSimulatorPreviewSessionRpcHandlers', () => {
  it('routes acquire and input RPCs through the simulator control registry', async () => {
    const registered = new Map<string, (raw: unknown) => Promise<unknown>>();
    const registry: RegistryParam = {
      acquire: vi.fn(async () => ({
        ok: true as const,
        leaseId: 'lease_user_1',
        generation: 1,
        owner: 'user' as const,
        expiresAtMs: 31_000,
        mode: 'user_control' as const,
      })),
      release: vi.fn(async () => ({ ok: true as const, generation: 2, mode: 'idle' as const })),
      sendInput: vi.fn(async () => ({ ok: true as const })),
    };
    const rpcHandlerManager = {
      registerHandler: <TRequest, TResponse>(
        method: string,
        handler: (data: TRequest) => TResponse | Promise<TResponse>,
      ) => {
        registered.set(method, async (raw: unknown) => await handler(raw as TRequest));
      },
    };

    registerSimulatorPreviewSessionRpcHandlers({
      sessionId: 'sess_1',
      rpcHandlerManager,
      registry,
    });

    await expect(registered.get('session.simulatorPreview.control.acquire')?.({
      simulatorSessionId: 'sim_android_1',
      owner: 'user',
      holderId: 'browser_tab_1',
      leaseTtlMs: 30_000,
    })).resolves.toEqual({
      ok: true,
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      expiresAtMs: 31_000,
      mode: 'user_control',
    });
    await expect(registered.get('session.simulatorPreview.input.send')?.({
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      input: { type: 'tap', x: 0.5, y: 0.25 },
    })).resolves.toEqual({ ok: true });

    expect(registry.acquire).toHaveBeenCalledWith({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      owner: 'user',
      holderId: 'browser_tab_1',
      leaseTtlMs: 30_000,
    });
    expect(registry.sendInput).toHaveBeenCalledWith({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      input: { type: 'tap', x: 0.5, y: 0.25 },
    });
  });
});
