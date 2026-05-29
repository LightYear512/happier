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
      reloadApp: vi.fn(async () => ({ ok: true as const })),
      reconnectDevServices: vi.fn(async () => ({ ok: true as const, reconnectedPorts: [] })),
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
    await expect(registered.get('session.simulatorPreview.input.send')?.({
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      input: { type: 'swipe', x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.8, durationMs: 250 },
    })).resolves.toEqual({ ok: true });
    await expect(registered.get('session.simulatorPreview.input.send')?.({
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      input: { type: 'text', text: 'hello world' },
    })).resolves.toEqual({ ok: true });
    await expect(registered.get('session.simulatorPreview.input.send')?.({
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      input: { type: 'keyevent', key: 'back' },
    })).resolves.toEqual({ ok: true });
    await expect(registered.get('session.simulatorPreview.control.release')?.({
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      owner: 'user',
      holderId: 'browser_tab_1',
    })).resolves.toEqual({ ok: true, generation: 2, mode: 'idle' });
    await expect(registered.get('session.simulatorPreview.app.reload')?.({
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      holderId: 'browser_tab_1',
    })).resolves.toEqual({ ok: true });
    await expect(registered.get('session.simulatorPreview.devServices.reconnect')?.({
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      holderId: 'browser_tab_1',
    })).resolves.toEqual({ ok: true, reconnectedPorts: [] });

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
    expect(registry.sendInput).toHaveBeenCalledWith(expect.objectContaining({
      input: { type: 'swipe', x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.8, durationMs: 250 },
    }));
    expect(registry.sendInput).toHaveBeenCalledWith(expect.objectContaining({
      input: { type: 'text', text: 'hello world' },
    }));
    expect(registry.sendInput).toHaveBeenCalledWith(expect.objectContaining({
      input: { type: 'keyevent', key: 'back' },
    }));
    expect(registry.release).toHaveBeenCalledWith({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      owner: 'user',
      holderId: 'browser_tab_1',
    });
    expect(registry.reloadApp).toHaveBeenCalledWith({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      holderId: 'browser_tab_1',
    });
    expect(registry.reconnectDevServices).toHaveBeenCalledWith({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      holderId: 'browser_tab_1',
    });
  });

  it('rejects simulator input payloads that do not satisfy the protocol action schema', async () => {
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
      release: vi.fn(async () => ({
        ok: true as const,
        generation: 2,
        mode: 'idle' as const,
      })),
      sendInput: vi.fn(async () => ({ ok: true as const })),
      reloadApp: vi.fn(async () => ({ ok: true as const })),
      reconnectDevServices: vi.fn(async () => ({ ok: true as const, reconnectedPorts: [] })),
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

    await expect(registered.get('session.simulatorPreview.input.send')?.({
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      input: { type: 'tap', x: 2, y: 0.25 },
    })).resolves.toEqual({
      ok: false,
      errorCode: 'invalid_parameters',
      error: 'invalid_parameters',
    });
    await expect(registered.get('session.simulatorPreview.input.send')?.({
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      input: { type: 'text', text: 'x'.repeat(2_001) },
    })).resolves.toEqual({
      ok: false,
      errorCode: 'invalid_parameters',
      error: 'invalid_parameters',
    });

    expect(registry.sendInput).not.toHaveBeenCalled();
  });
});
