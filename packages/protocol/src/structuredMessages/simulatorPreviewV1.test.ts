import { describe, expect, it } from 'vitest';

import { SimulatorPreviewV1Schema } from './simulatorPreviewV1';

describe('SimulatorPreviewV1Schema', () => {
  it('parses a simulator preview payload with a screen stream URL', () => {
    const parsed = SimulatorPreviewV1Schema.parse({
      simulatorSessionId: 'sim_1',
      sessionId: 's1',
      platform: 'android',
      deviceName: 'Pixel 8',
      appName: 'Happier',
      streamUrl: 'https://relay.example.test/simulator/sim_1/frame.jpg',
      mode: 'user_control',
      owner: 'user',
      connectionPath: 'relay',
      registeredAtMs: 1,
    });

    expect(parsed.streamUrl).toBe('https://relay.example.test/simulator/sim_1/frame.jpg');
  });

  it('parses relay metadata for a simulator stream routed through the preview relay', () => {
    const parsed = SimulatorPreviewV1Schema.parse({
      simulatorSessionId: 'sim_1',
      sessionId: 's1',
      platform: 'android',
      deviceName: 'Pixel 8',
      streamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
      mode: 'ai_control',
      owner: 'ai',
      connectionPath: 'relay',
      relay: {
        machineId: 'machine_1',
        routeKey: 'route_android_sim_1',
        streamPath: '/stream.mjpeg',
      },
      registeredAtMs: 1,
    });

    expect(parsed.relay).toEqual({
      machineId: 'machine_1',
      routeKey: 'route_android_sim_1',
      streamPath: '/stream.mjpeg',
    });
  });

  it('parses native dev session composition metadata', () => {
    const parsed = SimulatorPreviewV1Schema.parse({
      simulatorSessionId: 'sim_1',
      sessionId: 's1',
      platform: 'android',
      deviceName: 'Pixel 8',
      appName: 'Happier',
      streamUrl: 'https://relay.example.test/simulator/sim_1/stream.mjpeg',
      mode: 'user_control',
      owner: 'user',
      connectionPath: 'relay',
      nativeDevSessionId: 'native_dev_1',
      devServices: {
        metro: { status: 'connected', url: 'http://127.0.0.1:8081' },
        api: { status: 'healthy', url: 'http://127.0.0.1:3000/health' },
        hmr: { status: 'ready' },
      },
      registeredAtMs: 1,
    });

    expect(parsed.nativeDevSessionId).toBe('native_dev_1');
    expect(parsed.devServices).toEqual({
      metro: { status: 'connected', url: 'http://127.0.0.1:8081' },
      api: { status: 'healthy', url: 'http://127.0.0.1:3000/health' },
      hmr: { status: 'ready' },
    });
  });

  it('parses simulator device capability metadata without exposing raw device ids as required fields', () => {
    const parsed = SimulatorPreviewV1Schema.parse({
      simulatorSessionId: 'sim_1',
      sessionId: 's1',
      platform: 'android',
      deviceName: 'Pixel 8 API 35',
      streamUrl: 'https://relay.example.test/simulator/sim_1/stream.mjpeg',
      mode: 'ai_control',
      owner: 'ai',
      connectionPath: 'relay',
      controlCapability: 'readonly',
      controlUnavailableReason: 'device_in_use',
      deviceRef: 'android:emulator-5554',
      deviceDisplayName: 'Pixel 8 API 35',
      registeredAtMs: 1,
    });

    expect(parsed.controlCapability).toBe('readonly');
    expect(parsed.controlUnavailableReason).toBe('device_in_use');
    expect(parsed.deviceRef).toBe('android:emulator-5554');
    expect(parsed.deviceDisplayName).toBe('Pixel 8 API 35');
  });

  it('rejects non-http simulator stream URLs', () => {
    expect(() => SimulatorPreviewV1Schema.parse({
      simulatorSessionId: 'sim_1',
      sessionId: 's1',
      platform: 'android',
      deviceName: 'Pixel 8',
      streamUrl: 'javascript:alert(1)',
      mode: 'user_control',
      connectionPath: 'relay',
      registeredAtMs: 1,
    })).toThrow();
  });
});
