import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = process.env;

describe('createHappierMcpServer', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...env };
    delete process.env.HAPPIER_ACTIONS_SETTINGS_V1;
  });

  it('returns toolNames aligned with current MCP action settings', async () => {
    process.env.HAPPIER_ACTIONS_SETTINGS_V1 = JSON.stringify({
      v: 1,
      actions: {
        'review.start': { enabled: true, disabledSurfaces: ['session_agent'], disabledPlacements: [] },
      },
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const fakeClient = {
      sessionId: 'sess_mcp_tool_names_1',
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      sendClaudeSessionMessage: () => {},
      updateMetadata: () => {},
    } as any;

    const { toolNames } = createHappierMcpServer(fakeClient);
    expect(toolNames).not.toContain('review_start');
    expect(toolNames).not.toContain('subagents_plan_start');
    expect(toolNames).toContain('action_execute');
  });

  it('uses account action settings for the in-session MCP tool registry when provided', async () => {
    process.env.HAPPIER_ACTIONS_SETTINGS_V1 = JSON.stringify({
      v: 1,
      actions: {
        'session.list': { enabled: true, disabledSurfaces: ['session_agent'], disabledPlacements: [] },
      },
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const fakeClient = {
      sessionId: 'sess_mcp_tool_names_account_settings_1',
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      sendClaudeSessionMessage: () => {},
      updateMetadata: () => {},
    } as any;

    const { toolNames } = createHappierMcpServer(fakeClient, {
      accountSettings: {
        actionsSettingsV1: {
          v: 1,
          actions: {
            'session.list': {
              disabledSurfaces: [],
              toolExposureModes: { session_agent: 'direct' },
            },
          },
        },
      },
    } as any);

    expect(toolNames).toContain('session_list');
  });

  it('hides the session dev preview tool until the experimental feature toggle is enabled', async () => {
    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const fakeClient = {
      sessionId: 'sess_mcp_tool_names_dev_preview_1',
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      sendClaudeSessionMessage: () => {},
      updateMetadata: () => {},
    } as any;

    const disabled = createHappierMcpServer(fakeClient, {
      accountSettings: {
        experiments: true,
        featureToggles: {
          'sessions.devPreview': false,
        },
      },
    } as any);
    const enabled = createHappierMcpServer(fakeClient, {
      accountSettings: {
        experiments: true,
        featureToggles: {
          'sessions.devPreview': true,
        },
      },
    } as any);

    expect(disabled.toolNames).not.toContain('happier_dev_preview_register');
    expect(enabled.toolNames).toContain('happier_dev_preview_register');
  });

  it('hides the session simulator preview tool until the experimental feature toggle is enabled', async () => {
    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const fakeClient = {
      sessionId: 'sess_mcp_tool_names_simulator_preview_1',
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      sendClaudeSessionMessage: () => {},
      updateMetadata: () => {},
    } as any;

    const disabled = createHappierMcpServer(fakeClient, {
      accountSettings: {
        experiments: true,
        featureToggles: {
          'sessions.devPreview': false,
        },
      },
    } as any);
    const enabled = createHappierMcpServer(fakeClient, {
      accountSettings: {
        experiments: true,
        featureToggles: {
          'sessions.devPreview': true,
        },
      },
    } as any);

    expect(disabled.toolNames).not.toContain('happier_simulator_preview_register');
    expect(enabled.toolNames).toContain('happier_simulator_preview_register');
    expect(disabled.toolNames).not.toContain('happier_simulator_preview_android_start');
    expect(enabled.toolNames).toContain('happier_simulator_preview_android_start');
    expect(disabled.toolNames).not.toContain('happier_simulator_preview_ios_start');
    expect(enabled.toolNames).toContain('happier_simulator_preview_ios_start');
  });

  it('emits a simulator preview structured message from the in-session action bridge', async () => {
    const captured: { deps?: any } = {};

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          captured.deps = deps;
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const sendClaudeSessionMessage = vi.fn();
    createHappierMcpServer({
      sessionId: 'sess_simulator_preview_1',
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      sendClaudeSessionMessage,
      updateMetadata: () => {},
    } as any);

    expect(captured.deps).toBeDefined();
    const result = await captured.deps.sessionSimulatorPreviewRegister({
      sessionId: 'sess_simulator_preview_1',
      platform: 'ios',
      deviceName: 'iPhone 15 Pro',
      appName: 'Example App',
      streamUrl: 'http://127.0.0.1:9100/frame.mjpeg',
      mode: 'ai_control',
      owner: 'ai',
      connectionPath: 'relay',
    });

    expect(result).toEqual(expect.objectContaining({
      sessionId: 'sess_simulator_preview_1',
      platform: 'ios',
      deviceName: 'iPhone 15 Pro',
      streamUrl: 'http://127.0.0.1:9100/frame.mjpeg',
      mode: 'ai_control',
      owner: 'ai',
      connectionPath: 'relay',
    }));
    expect(sendClaudeSessionMessage).toHaveBeenCalledWith(
      {
        type: 'user',
        message: {
          content: 'iPhone 15 Pro simulator preview',
        },
      },
      {
        happier: {
          kind: 'simulator_preview.v1',
          payload: expect.objectContaining({
            sessionId: 'sess_simulator_preview_1',
            platform: 'ios',
            deviceName: 'iPhone 15 Pro',
            streamUrl: 'http://127.0.0.1:9100/frame.mjpeg',
          }),
        },
      },
    );
  });

  it('starts an Android simulator stream and emits a preview message from the in-session action bridge', async () => {
    const captured: { deps?: any } = {};

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          captured.deps = deps;
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const sendClaudeSessionMessage = vi.fn();
    const daemonDevPreviewRegister = vi.fn(async () => ({
      success: true,
      preview: {
        sessionId: 'sess_simulator_preview_android_start_1',
        machineId: 'machine_android_1',
        port: 9812,
        resourceId: 'preview_android_stream_1',
        origin: 'http://127.0.0.1:9812',
        name: 'Android SDK API 34 simulator',
        source: 'mcp_tool',
        registeredAtMs: 1,
        health: { status: 'ready' },
        preview: {
          rewriteUrls: false,
          supportsWebSocket: false,
          routeKey: 'route_android_stream_1',
          initialPath: '/stream.mjpeg',
        },
      },
    }));
    const close = vi.fn(async () => {});
    const resolveAndroidSimulatorPreviewGeometry = vi.fn(async () => ({
      deviceWidth: 720,
      deviceHeight: 1600,
    }));
    const { mcp } = createHappierMcpServer({
      sessionId: 'sess_simulator_preview_android_start_1',
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      sendClaudeSessionMessage,
      updateMetadata: () => {},
      getMetadataSnapshot: () => ({ machineId: 'machine_android_1' }),
    } as any, {
      daemonDevPreviewRegister,
      startAndroidSimulatorPreviewStream: vi.fn(async () => ({
        host: '127.0.0.1',
        port: 9812,
        frameUrl: 'http://127.0.0.1:9812/frame.jpg',
        streamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
        close,
      })),
      resolveAndroidSimulatorPreviewGeometry,
    } as any);

    expect(captured.deps).toBeDefined();
    const result = await captured.deps.sessionSimulatorPreviewAndroidStart({
      sessionId: 'sess_simulator_preview_android_start_1',
      deviceId: 'emulator-5554',
      port: 9812,
      pollMs: 500,
      deviceName: 'Android SDK API 34',
      appName: 'Example Android App',
    });

    expect(result).toEqual(expect.objectContaining({
      sessionId: 'sess_simulator_preview_android_start_1',
      platform: 'android',
      deviceName: 'Android SDK API 34',
      appName: 'Example Android App',
      streamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
      mode: 'ai_control',
      owner: 'ai',
      connectionPath: 'relay',
      relay: {
        machineId: 'machine_android_1',
        routeKey: 'route_android_stream_1',
        streamPath: '/stream.mjpeg',
      },
    }));
    expect(daemonDevPreviewRegister).toHaveBeenCalledWith({
      sessionId: 'sess_simulator_preview_android_start_1',
      expectedMachineId: 'machine_android_1',
      port: 9812,
      name: 'Android SDK API 34 simulator',
      healthPath: '/frame.jpg',
      rewriteUrls: false,
    });
    expect(sendClaudeSessionMessage).toHaveBeenCalledWith(
      {
        type: 'user',
        message: {
          content: 'Android SDK API 34 simulator preview',
        },
      },
      {
        happier: {
          kind: 'simulator_preview.v1',
          payload: expect.objectContaining({
            sessionId: 'sess_simulator_preview_android_start_1',
            platform: 'android',
            deviceName: 'Android SDK API 34',
            streamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
            connectionPath: 'relay',
            relay: {
              machineId: 'machine_android_1',
              routeKey: 'route_android_stream_1',
              streamPath: '/stream.mjpeg',
            },
          }),
        },
      },
    );

    expect(close).not.toHaveBeenCalled();
    expect(resolveAndroidSimulatorPreviewGeometry).toHaveBeenCalledWith({ deviceId: 'emulator-5554' });
    await mcp.close();
    expect(close).not.toHaveBeenCalled();
  });

  it('starts an iOS simulator stream and emits a preview message from the in-session action bridge', async () => {
    const captured: { deps?: any } = {};

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          captured.deps = deps;
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const sendClaudeSessionMessage = vi.fn();
    const daemonDevPreviewRegister = vi.fn(async () => ({
      success: true,
      preview: {
        sessionId: 'sess_simulator_preview_ios_start_1',
        machineId: 'machine_ios_1',
        port: 9814,
        resourceId: 'preview_ios_stream_1',
        origin: 'http://127.0.0.1:9814',
        name: 'iPhone 15 Pro simulator',
        source: 'mcp_tool',
        registeredAtMs: 1,
        health: { status: 'ready' },
        preview: {
          rewriteUrls: false,
          supportsWebSocket: false,
          routeKey: 'route_ios_stream_1',
          initialPath: '/stream.mjpeg',
        },
      },
    }));
    const close = vi.fn(async () => {});
    const { mcp } = createHappierMcpServer({
      sessionId: 'sess_simulator_preview_ios_start_1',
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      sendClaudeSessionMessage,
      updateMetadata: () => {},
      getMetadataSnapshot: () => ({ machineId: 'machine_ios_1' }),
    } as any, {
      daemonDevPreviewRegister,
      startIosSimulatorPreviewStream: vi.fn(async () => ({
        host: '127.0.0.1',
        port: 9814,
        frameUrl: 'http://127.0.0.1:9814/frame.jpg',
        streamUrl: 'http://127.0.0.1:9814/stream.mjpeg',
        close,
      })),
    } as any);

    expect(captured.deps).toBeDefined();
    const result = await captured.deps.sessionSimulatorPreviewIosStart({
      sessionId: 'sess_simulator_preview_ios_start_1',
      deviceId: 'A1B2-C3D4',
      port: 9814,
      pollMs: 500,
      deviceName: 'iPhone 15 Pro',
      appName: 'Example iOS App',
    });

    expect(result).toEqual(expect.objectContaining({
      sessionId: 'sess_simulator_preview_ios_start_1',
      platform: 'ios',
      deviceName: 'iPhone 15 Pro',
      appName: 'Example iOS App',
      streamUrl: 'http://127.0.0.1:9814/stream.mjpeg',
      mode: 'ai_control',
      owner: 'ai',
      connectionPath: 'relay',
      relay: {
        machineId: 'machine_ios_1',
        routeKey: 'route_ios_stream_1',
        streamPath: '/stream.mjpeg',
      },
    }));
    expect(daemonDevPreviewRegister).toHaveBeenCalledWith({
      sessionId: 'sess_simulator_preview_ios_start_1',
      expectedMachineId: 'machine_ios_1',
      port: 9814,
      name: 'iPhone 15 Pro simulator',
      healthPath: '/frame.jpg',
      rewriteUrls: false,
    });
    expect(sendClaudeSessionMessage).toHaveBeenCalledWith(
      {
        type: 'user',
        message: {
          content: 'iPhone 15 Pro simulator preview',
        },
      },
      {
        happier: {
          kind: 'simulator_preview.v1',
          payload: expect.objectContaining({
            sessionId: 'sess_simulator_preview_ios_start_1',
            platform: 'ios',
            deviceName: 'iPhone 15 Pro',
            streamUrl: 'http://127.0.0.1:9814/stream.mjpeg',
            connectionPath: 'relay',
            relay: {
              machineId: 'machine_ios_1',
              routeKey: 'route_ios_stream_1',
              streamPath: '/stream.mjpeg',
            },
          }),
        },
      },
    );

    expect(close).not.toHaveBeenCalled();
    await mcp.close();
    expect(close).not.toHaveBeenCalled();
  });

  it('routes iOS simulator preview control and input through the shared iOS control registry', async () => {
    const capturedDeps: any[] = [];

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          capturedDeps.push(deps);
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const iosSimulatorPreviewControlRegistry = {
      registerIosPreview: vi.fn(),
      acquire: vi.fn(async () => ({ ok: true as const, leaseId: 'lease_ios_1', generation: 1 })),
      release: vi.fn(async () => ({ ok: true as const, generation: 2, mode: 'idle' as const })),
      sendInput: vi.fn(async () => ({ ok: true as const })),
      reloadApp: vi.fn(async () => ({ ok: false as const, errorCode: 'unsupported_ios_operation' as const, error: 'unsupported_ios_operation' as const })),
      reconnectDevServices: vi.fn(async () => ({ ok: true as const, reconnectedPorts: [] as number[] })),
    };
    createHappierMcpServer({
      sessionId: 'sess_simulator_preview_ios_control_1',
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      sendClaudeSessionMessage: () => {},
      updateMetadata: () => {},
    } as any, {
      daemonDevPreviewRegister: null,
      startIosSimulatorPreviewStream: vi.fn(async () => ({
        host: '127.0.0.1',
        port: 9814,
        frameUrl: 'http://127.0.0.1:9814/frame.jpg',
        streamUrl: 'http://127.0.0.1:9814/stream.mjpeg',
        close: vi.fn(async () => {}),
      })),
      iosSimulatorPreviewControlRegistry,
    } as any);

    const preview = await capturedDeps[0].sessionSimulatorPreviewIosStart({
      sessionId: 'sess_simulator_preview_ios_control_1',
      deviceId: 'A1B2-C3D4',
      wdaUrl: 'http://127.0.0.1:8100',
      deviceName: 'iPhone 15 Pro',
    });
    await capturedDeps[0].sessionSimulatorPreviewControlAcquire({
      sessionId: 'sess_simulator_preview_ios_control_1',
      simulatorSessionId: preview.simulatorSessionId,
      owner: 'user',
      holderId: 'browser_tab_1',
    });
    await capturedDeps[0].sessionSimulatorPreviewInputSend({
      sessionId: 'sess_simulator_preview_ios_control_1',
      simulatorSessionId: preview.simulatorSessionId,
      leaseId: 'lease_ios_1',
      generation: 1,
      owner: 'user',
      holderId: 'browser_tab_1',
      input: { type: 'tap', x: 0.5, y: 0.25 },
    });

    expect(iosSimulatorPreviewControlRegistry.registerIosPreview).toHaveBeenCalledWith({
      sessionId: 'sess_simulator_preview_ios_control_1',
      simulatorSessionId: preview.simulatorSessionId,
      deviceId: 'A1B2-C3D4',
      wdaUrl: 'http://127.0.0.1:8100',
    });
    expect(iosSimulatorPreviewControlRegistry.acquire).toHaveBeenCalledWith(expect.objectContaining({
      simulatorSessionId: preview.simulatorSessionId,
      owner: 'user',
    }));
    expect(iosSimulatorPreviewControlRegistry.sendInput).toHaveBeenCalledWith(expect.objectContaining({
      simulatorSessionId: preview.simulatorSessionId,
      input: { type: 'tap', x: 0.5, y: 0.25 },
    }));
  });

  it('replaces Android simulator streams through a shared registry across per-request MCP servers', async () => {
    const capturedDeps: any[] = [];

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          capturedDeps.push(deps);
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const firstClose = vi.fn(async () => {});
    const secondClose = vi.fn(async () => {});
    const startAndroidSimulatorPreviewStream = vi
      .fn()
      .mockResolvedValueOnce({
        host: '127.0.0.1',
        port: 9812,
        frameUrl: 'http://127.0.0.1:9812/frame.jpg',
        streamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
        close: firstClose,
      })
      .mockResolvedValueOnce({
        host: '127.0.0.1',
        port: 9813,
        frameUrl: 'http://127.0.0.1:9813/frame.jpg',
        streamUrl: 'http://127.0.0.1:9813/stream.mjpeg',
        close: secondClose,
      });
    const androidSimulatorPreviewStreams = new Map();
    const fakeClient = {
      sessionId: 'sess_simulator_preview_android_replace_1',
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      sendClaudeSessionMessage: () => {},
      updateMetadata: () => {},
    } as any;

    createHappierMcpServer(fakeClient, {
      startAndroidSimulatorPreviewStream,
      androidSimulatorPreviewStreams,
    } as any);
    createHappierMcpServer(fakeClient, {
      startAndroidSimulatorPreviewStream,
      androidSimulatorPreviewStreams,
    } as any);

    await capturedDeps[0].sessionSimulatorPreviewAndroidStart({
      sessionId: 'sess_simulator_preview_android_replace_1',
      deviceName: 'Android SDK API 34',
    });
    await capturedDeps[1].sessionSimulatorPreviewAndroidStart({
      sessionId: 'sess_simulator_preview_android_replace_1',
      deviceName: 'Android SDK API 34',
    });

    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(secondClose).not.toHaveBeenCalled();
    expect(androidSimulatorPreviewStreams.get('sess_simulator_preview_android_replace_1')?.port).toBe(9813);
  });

  it('replaces iOS simulator streams through a shared registry across per-request MCP servers', async () => {
    const capturedDeps: any[] = [];

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          capturedDeps.push(deps);
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const firstClose = vi.fn(async () => {});
    const secondClose = vi.fn(async () => {});
    const startIosSimulatorPreviewStream = vi
      .fn()
      .mockResolvedValueOnce({
        host: '127.0.0.1',
        port: 9814,
        frameUrl: 'http://127.0.0.1:9814/frame.jpg',
        streamUrl: 'http://127.0.0.1:9814/stream.mjpeg',
        close: firstClose,
      })
      .mockResolvedValueOnce({
        host: '127.0.0.1',
        port: 9815,
        frameUrl: 'http://127.0.0.1:9815/frame.jpg',
        streamUrl: 'http://127.0.0.1:9815/stream.mjpeg',
        close: secondClose,
      });
    const iosSimulatorPreviewStreams = new Map();
    const fakeClient = {
      sessionId: 'sess_simulator_preview_ios_replace_1',
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      sendClaudeSessionMessage: () => {},
      updateMetadata: () => {},
    } as any;

    createHappierMcpServer(fakeClient, {
      startIosSimulatorPreviewStream,
      iosSimulatorPreviewStreams,
    } as any);
    createHappierMcpServer(fakeClient, {
      startIosSimulatorPreviewStream,
      iosSimulatorPreviewStreams,
    } as any);

    await capturedDeps[0].sessionSimulatorPreviewIosStart({
      sessionId: 'sess_simulator_preview_ios_replace_1',
      deviceName: 'iPhone 15 Pro',
    });
    await capturedDeps[1].sessionSimulatorPreviewIosStart({
      sessionId: 'sess_simulator_preview_ios_replace_1',
      deviceName: 'iPhone 15 Pro',
    });

    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(secondClose).not.toHaveBeenCalled();
    expect(iosSimulatorPreviewStreams.get('sess_simulator_preview_ios_replace_1')?.port).toBe(9815);
  });

  it('routes simulator preview control and input through a shared Android control registry', async () => {
    const capturedDeps: any[] = [];

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          capturedDeps.push(deps);
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const androidSimulatorPreviewControlRegistry = {
      registerAndroidPreview: vi.fn(),
      acquire: vi.fn(async () => ({ ok: true, leaseId: 'lease_user_1', generation: 1 })),
      release: vi.fn(async () => ({ ok: true, generation: 2 })),
      sendInput: vi.fn(async () => ({ ok: true })),
      reloadApp: vi.fn(async () => ({ ok: true })),
      reconnectDevServices: vi.fn(async () => ({ ok: true, reconnectedPorts: [] })),
    };
    const fakeClient = {
      sessionId: 'sess_simulator_preview_control_1',
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      sendClaudeSessionMessage: () => {},
      updateMetadata: () => {},
    } as any;

    createHappierMcpServer(fakeClient, {
      androidSimulatorPreviewControlRegistry,
    } as any);

    await expect(capturedDeps[0].sessionSimulatorPreviewControlAcquire({
      sessionId: 'sess_simulator_preview_control_1',
      simulatorSessionId: 'sim_android_1',
      owner: 'user',
      holderId: 'browser_tab_1',
      leaseTtlMs: 30_000,
    })).resolves.toEqual({ ok: true, leaseId: 'lease_user_1', generation: 1 });
    await expect(capturedDeps[0].sessionSimulatorPreviewInputSend({
      sessionId: 'sess_simulator_preview_control_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      input: { type: 'tap', x: 0.5, y: 0.25 },
    })).resolves.toEqual({ ok: true });
    await expect(capturedDeps[0].sessionSimulatorPreviewControlRelease({
      sessionId: 'sess_simulator_preview_control_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      owner: 'user',
      holderId: 'browser_tab_1',
    })).resolves.toEqual({ ok: true, generation: 2 });
    await expect(capturedDeps[0].sessionSimulatorPreviewAppReload({
      sessionId: 'sess_simulator_preview_control_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      holderId: 'browser_tab_1',
    })).resolves.toEqual({ ok: true });
    await expect(capturedDeps[0].sessionSimulatorPreviewDevServicesReconnect({
      sessionId: 'sess_simulator_preview_control_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      holderId: 'browser_tab_1',
    })).resolves.toEqual({ ok: true, reconnectedPorts: [] });

    expect(androidSimulatorPreviewControlRegistry.acquire).toHaveBeenCalledWith({
      sessionId: 'sess_simulator_preview_control_1',
      simulatorSessionId: 'sim_android_1',
      owner: 'user',
      holderId: 'browser_tab_1',
      leaseTtlMs: 30_000,
    });
    expect(androidSimulatorPreviewControlRegistry.sendInput).toHaveBeenCalledWith({
      sessionId: 'sess_simulator_preview_control_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      input: { type: 'tap', x: 0.5, y: 0.25 },
    });
    expect(androidSimulatorPreviewControlRegistry.release).toHaveBeenCalledWith({
      sessionId: 'sess_simulator_preview_control_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      owner: 'user',
      holderId: 'browser_tab_1',
    });
    expect(androidSimulatorPreviewControlRegistry.reloadApp).toHaveBeenCalledWith({
      sessionId: 'sess_simulator_preview_control_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      holderId: 'browser_tab_1',
    });
    expect(androidSimulatorPreviewControlRegistry.reconnectDevServices).toHaveBeenCalledWith({
      sessionId: 'sess_simulator_preview_control_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      holderId: 'browser_tab_1',
    });
  });

  it('uses account action settings for in-session MCP approval policy when provided', async () => {
    process.env.HAPPIER_ACTIONS_SETTINGS_V1 = JSON.stringify({
      v: 1,
      actions: {
        'session.list': { disabledSurfaces: [] },
      },
    });
    const captured: { deps?: any } = {};

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          captured.deps = deps;
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    createHappierMcpServer({
      sessionId: 'sess_mcp_approval_policy_1',
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      sendClaudeSessionMessage: () => {},
      updateMetadata: () => {},
    } as any, {
      accountSettings: {
        actionsSettingsV1: {
          v: 1,
          actions: {
            'session.list': {
              disabledSurfaces: [],
              approvalRequiredSurfaces: ['session_agent'],
            },
          },
        },
      },
    } as any);

    expect(captured.deps).toBeDefined();
    expect(captured.deps.isActionApprovalRequired('session.list', { surface: 'session_agent' })).toBe(true);
  });

  it('forwards execution.run.list request payloads through the shared action executor deps', async () => {
    const captured: { deps?: any } = {};

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          captured.deps = deps;
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const invokeLocal = vi.fn(async (_method: string, params: unknown) => params);
    createHappierMcpServer({
      sessionId: 'sess_mcp_payload_1',
      rpcHandlerManager: { invokeLocal },
      sendClaudeSessionMessage: () => {},
      updateMetadata: () => {},
    } as any);

    expect(captured.deps).toBeDefined();
    await captured.deps.executionRunList('sess_mcp_payload_1', { status: 'running' });
    expect(invokeLocal).toHaveBeenCalledWith('execution.run.list', { status: 'running' });
  });

  it('prefers the session execution-run service when the client provides one', async () => {
    const captured: { deps?: any } = {};

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          captured.deps = deps;
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const invokeLocal = vi.fn(async (_method: string, params: unknown) => params);
    const list = vi.fn(async () => ({ ok: true, data: { runs: [{ runId: 'run_1' }] } }));
    createHappierMcpServer({
      sessionId: 'sess_mcp_payload_2',
      rpcHandlerManager: { invokeLocal },
      sendClaudeSessionMessage: () => {},
      updateMetadata: () => {},
      executionRuns: {
        start: vi.fn(),
        list,
        get: vi.fn(),
        send: vi.fn(),
        stop: vi.fn(),
        action: vi.fn(),
      },
    } as any);

    expect(captured.deps).toBeDefined();
    await captured.deps.executionRunList('sess_mcp_payload_2', { status: 'running' });
    expect(list).toHaveBeenCalledWith({ status: 'running' });
    expect(invokeLocal).not.toHaveBeenCalled();
  });

  it('treats raw local execution-run rpc error payloads as errors in the fallback bridge', async () => {
    const captured: { deps?: any } = {};

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          captured.deps = deps;
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const invokeLocal = vi.fn(async () => ({
      error: 'RPC method not available',
      errorCode: 'RPC_METHOD_NOT_AVAILABLE',
    }));
    createHappierMcpServer({
      sessionId: 'sess_mcp_payload_3',
      rpcHandlerManager: { invokeLocal },
      sendClaudeSessionMessage: () => {},
      updateMetadata: () => {},
    } as any);

    expect(captured.deps).toBeDefined();
    await expect(captured.deps.executionRunList('sess_mcp_payload_3', { status: 'running' })).resolves.toEqual({
      ok: false,
      code: 'RPC_METHOD_NOT_AVAILABLE',
      message: 'RPC method not available',
    });
  });

  it('forwards prompt_registry.install through the shared action executor deps', async () => {
    const captured: { deps?: any } = {};

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          captured.deps = deps;
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const invokeLocal = vi.fn(async (_method: string, params: unknown) => ({
      ok: true,
      digest: 'sha256:deadbeef',
      request: params,
    }));
    createHappierMcpServer({
      sessionId: 'sess_mcp_prompt_registry_1',
      rpcHandlerManager: { invokeLocal },
      sendClaudeSessionMessage: () => {},
      updateMetadata: () => {},
    } as any);

    expect(captured.deps).toBeDefined();
    const res = await captured.deps.promptRegistryInstall({
      machineId: 'machine_1',
      sourceId: 'source_1',
      itemId: 'item_1',
      configuredSources: [],
      installTarget: {
        assetTypeId: 'codex.prompts',
        scope: 'user',
        targetName: 'example-skill',
        installMode: 'copy',
      },
    });
    expect(invokeLocal).toHaveBeenCalledWith('daemon.promptRegistry.install', {
      sourceId: 'source_1',
      itemId: 'item_1',
      configuredSources: [],
      installTarget: {
        assetTypeId: 'codex.prompts',
        scope: 'user',
        targetName: 'example-skill',
        installMode: 'copy',
      },
    });
    expect(res).toMatchObject({ ok: true, digest: 'sha256:deadbeef' });
  });

  it('routes session control deps through the shared CLI action deps (not unsupported stubs)', async () => {
    const captured: { deps?: any } = {};

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          captured.deps = deps;
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    createHappierMcpServer({
      sessionId: 'sess_mcp_session_control_1',
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      sendClaudeSessionMessage: () => {},
      updateMetadata: () => {},
    } as any);

    expect(captured.deps).toBeDefined();
    await expect(
      captured.deps.sessionList({ limit: 1, cursor: null, activeOnly: false, archivedOnly: false, includeSystem: false, resumableOnly: false }),
    ).resolves.toEqual({ ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' });
  });

  it('dispatches registered tools using the session_agent surface (internal MCP)', async () => {
    const captured: { surface?: string } = {};
    const handlers: Record<string, (args: any) => Promise<any>> = {};

    vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
      McpServer: class FakeMcpServer {
        registerResource() {}
        registerTool(name: string, _meta: any, handler: any) {
          handlers[name] = handler;
        }
      },
    }));

    vi.doMock('@/agent/tools/happierTools/dispatchBuiltInHappierTool', () => ({
      dispatchBuiltInHappierTool: async (params: any) => {
        captured.surface = params.surface;
        return { ok: true, result: { ok: true } };
      },
    }));

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const fakeClient = {
      sessionId: 'sess_mcp_surface_1',
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      sendClaudeSessionMessage: () => {},
      updateMetadata: () => {},
    } as any;

    createHappierMcpServer(fakeClient);

    expect(typeof handlers.change_title).toBe('function');
    await handlers.change_title({ title: 'Hello' });
    expect(captured.surface).toBe('session_agent');
  });

  it('routes change_title through the action executor (so approvals/enablement apply)', async () => {
    const execute = vi.fn(async () => ({ ok: true, result: { ok: true } }));
    const captured: { deps?: any } = {};

    vi.doMock('@/session/actions/createCliActionExecutorHarness', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/session/actions/createCliActionExecutorHarness')>();
      return {
        ...actual,
        createCliActionExecutorHarness: () => ({ executor: { execute } }),
      };
    });

    vi.doMock('@/mcp/server/registerHappierMcpBuiltInTools', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/mcp/server/registerHappierMcpBuiltInTools')>();
      return {
        ...actual,
        registerHappierMcpBuiltInTools: (_server: any, params: any) => {
          captured.deps = params.deps;
          return { toolNames: [] };
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');
    createHappierMcpServer(
      {
        sessionId: 'sess_change_title_1',
        rpcHandlerManager: { invokeLocal: async () => ({}) },
        sendClaudeSessionMessage: () => {},
        updateMetadata: () => {},
      } as any,
      { credentials: null },
    );

    expect(captured.deps).toBeDefined();
    await captured.deps.changeTitle('sess_change_title_1', 'New title');
    expect(execute).toHaveBeenCalledWith(
      'session.title.set',
      { sessionId: 'sess_change_title_1', title: 'New title' },
      { surface: 'session_agent', defaultSessionId: 'sess_change_title_1' },
    );
  });

  it('treats session-agent metadata refresh after change_title as best-effort', async () => {
    const execute = vi.fn(async () => ({ ok: true, result: { ok: true } }));
    const updateMetadata = vi.fn(() => {
      throw new Error('local metadata sync failed');
    });
    const captured: { deps?: any } = {};

    vi.doMock('@/session/actions/createCliActionExecutorHarness', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/session/actions/createCliActionExecutorHarness')>();
      return {
        ...actual,
        createCliActionExecutorHarness: () => ({ executor: { execute } }),
      };
    });

    vi.doMock('@/mcp/server/registerHappierMcpBuiltInTools', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/mcp/server/registerHappierMcpBuiltInTools')>();
      return {
        ...actual,
        registerHappierMcpBuiltInTools: (_server: any, params: any) => {
          captured.deps = params.deps;
          return { toolNames: [] };
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');
    createHappierMcpServer(
      {
        sessionId: 'sess_change_title_refresh_1',
        rpcHandlerManager: { invokeLocal: async () => ({}) },
        sendClaudeSessionMessage: () => {},
        updateMetadata,
      } as any,
      { credentials: null },
    );

    expect(captured.deps).toBeDefined();
    await expect(captured.deps.changeTitle('sess_change_title_refresh_1', 'New title')).resolves.toEqual({
      success: true,
      title: 'New title',
    });
    expect(updateMetadata).toHaveBeenCalledTimes(1);
  });

  it('routes execution_run_start through the action executor (so approvals/enablement apply)', async () => {
    const execute = vi.fn(async () => ({ ok: true, result: { ok: true } }));
    const captured: { deps?: any } = {};

    vi.doMock('@/session/actions/createCliActionExecutorHarness', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/session/actions/createCliActionExecutorHarness')>();
      return {
        ...actual,
        createCliActionExecutorHarness: () => ({ executor: { execute } }),
      };
    });

    vi.doMock('@/mcp/server/registerHappierMcpBuiltInTools', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/mcp/server/registerHappierMcpBuiltInTools')>();
      return {
        ...actual,
        registerHappierMcpBuiltInTools: (_server: any, params: any) => {
          captured.deps = params.deps;
          return { toolNames: [] };
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');
    createHappierMcpServer(
      {
        sessionId: 'sess_execution_run_start_1',
        rpcHandlerManager: { invokeLocal: async () => ({}) },
        sendClaudeSessionMessage: () => {},
        updateMetadata: () => {},
      } as any,
      { credentials: null },
    );

    expect(captured.deps).toBeDefined();
    await captured.deps.startExecutionRun('sess_execution_run_start_1', { intent: 'plan' });
    expect(execute).toHaveBeenCalledWith(
      'execution.run.start',
      { intent: 'plan' },
      { surface: 'session_agent', defaultSessionId: 'sess_execution_run_start_1' },
    );
  });

  it('registers session dev previews with the daemon registry for relay lookups', async () => {
    const captured: { deps?: any } = {};
    const metadataUpdates: Array<Record<string, unknown>> = [];
    const daemonDevPreviewRegister = vi.fn(async () => ({
      success: true,
      preview: {
        resourceId: 'preview_daemon_1',
        sessionId: 'sess_dev_preview_daemon_1',
        machineId: 'machine-1',
        port: 52112,
        origin: 'http://127.0.0.1:52112',
        name: 'Preview app',
        source: 'manual',
        registeredAtMs: 1,
        health: { status: 'ready' },
        preview: {
          rewriteUrls: true,
          supportsWebSocket: true,
          routeKey: 'route_daemon_1',
          initialPath: '/',
        },
      },
    } as const));

    vi.doMock('@/session/actions/createCliActionExecutorHarness', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/session/actions/createCliActionExecutorHarness')>();
      return {
        ...actual,
        createCliActionExecutorHarness: (_ctx: any, deps: any) => {
          captured.deps = deps;
          return { executor: { execute: vi.fn() } };
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');
    createHappierMcpServer(
      {
        sessionId: 'sess_dev_preview_daemon_1',
        rpcHandlerManager: { invokeLocal: async () => ({}) },
        sendClaudeSessionMessage: () => {},
        updateMetadata: (updater: (metadata: Record<string, unknown>) => Record<string, unknown>) => {
          const next = updater(metadataUpdates.at(-1) ?? { machineId: 'machine-1' });
          metadataUpdates.push(next);
          return next;
        },
        getMetadataSnapshot: () => ({ machineId: 'machine-1' }),
      } as any,
      {
        credentials: null,
        daemonDevPreviewRegister,
      },
    );

    expect(captured.deps).toBeDefined();
    const result = await captured.deps.sessionDevPreviewRegister({
      sessionId: 'sess_dev_preview_daemon_1',
      port: 52112,
      name: 'Preview app',
      framework: 'vite',
      rewriteUrls: true,
    });

    expect(result).toEqual(expect.objectContaining({
      resourceId: 'preview_daemon_1',
      preview: expect.objectContaining({
        routeKey: 'route_daemon_1',
      }),
    }));
    expect(daemonDevPreviewRegister).toHaveBeenCalledWith({
      sessionId: 'sess_dev_preview_daemon_1',
      expectedMachineId: 'machine-1',
      port: 52112,
      name: 'Preview app',
      framework: 'vite',
      rewriteUrls: true,
    });
    expect(metadataUpdates.at(-1)).toMatchObject({
      localServicePreviewsV1: {
        v: 1,
        previews: [
          expect.objectContaining({
            resourceId: 'preview_daemon_1',
            preview: expect.objectContaining({ routeKey: 'route_daemon_1' }),
          }),
        ],
      },
    });
  });
});
