import { describe, expect, it, vi } from 'vitest';

import { createIosWebDriverAgentInputBridge } from './createIosWebDriverAgentInputBridge';

describe('createIosWebDriverAgentInputBridge', () => {
  it('creates a WDA session, resolves viewport size, and sends normalized tap coordinates as pointer actions', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: { sessionId: 'wda_session_1' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: { width: 390, height: 844 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: null }), { status: 200 }));
    const bridge = createIosWebDriverAgentInputBridge({
      fetch: fetchImpl,
      wdaUrl: 'http://127.0.0.1:8100',
    });

    await expect(bridge.sendInput({
      input: { type: 'tap', x: 0.5, y: 0.25 },
    })).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:8100/session', expect.objectContaining({
      method: 'POST',
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:8100/session/wda_session_1/window/size', expect.objectContaining({
      method: 'GET',
    }));
    const actionsRequest = fetchImpl.mock.calls[2]?.[1] as RequestInit;
    expect(fetchImpl.mock.calls[2]?.[0]).toBe('http://127.0.0.1:8100/session/wda_session_1/actions');
    expect(actionsRequest.method).toBe('POST');
    expect(JSON.parse(String(actionsRequest.body))).toEqual({
      actions: [
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, origin: 'viewport', x: 195, y: 211 },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 50 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    });
  });

  it('includes iOS Appium capabilities when a simulator device id is provided', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: { sessionId: 'wda_session_1' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: { width: 390, height: 844 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: null }), { status: 200 }));
    const bridge = createIosWebDriverAgentInputBridge({
      fetch: fetchImpl,
      wdaUrl: 'http://127.0.0.1:8100',
    });

    await expect(bridge.sendInput({
      deviceId: 'F3D78E58-6744-47F9-9FFC-5FA39E6D143B',
      input: { type: 'tap', x: 0.5, y: 0.25 },
    })).resolves.toEqual({ ok: true });

    const sessionRequest = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(sessionRequest.body))).toEqual({
      capabilities: {
        alwaysMatch: {
          platformName: 'iOS',
          'appium:automationName': 'XCUITest',
          'appium:udid': 'F3D78E58-6744-47F9-9FFC-5FA39E6D143B',
          'appium:wdaLaunchTimeout': 180_000,
        },
        firstMatch: [{}],
      },
    });
  });
});
