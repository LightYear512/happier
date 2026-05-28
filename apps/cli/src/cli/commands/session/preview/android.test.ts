import { describe, expect, it, vi } from 'vitest';

import { captureConsoleJsonOutput } from '@/testkit/logger/captureOutput';

import { cmdSessionPreviewAndroid } from './android';

describe('cmdSessionPreviewAndroid', () => {
  it('starts an Android screenshot stream and registers the simulator preview', async () => {
    const close = vi.fn(async () => {});
    const startAndroidStream = vi.fn(async () => ({
      host: '127.0.0.1',
      port: 9812,
      frameUrl: 'http://127.0.0.1:9812/frame.jpg',
      streamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
      close,
    }));
    const registerSimulatorPreview = vi.fn(async () => ({
      ok: true as const,
      sessionId: 'sess_1',
      preview: {
        simulatorSessionId: 'sim_1',
        sessionId: 'sess_1',
        platform: 'android' as const,
        deviceName: 'Pixel 8',
        appName: 'Fixture App',
        streamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
        mode: 'ai_control' as const,
        owner: 'ai' as const,
        connectionPath: 'direct' as const,
        registeredAtMs: 1,
      },
      localId: 'local_1',
      messageId: 'msg_1',
    }));
    const output = captureConsoleJsonOutput();

    try {
      await cmdSessionPreviewAndroid(
        [
          'preview',
          'android',
          'sess_1',
          '--device-id',
          'emulator-5554',
          '--port',
          '9812',
          '--poll-ms',
          '125',
          '--device-name',
          'Pixel 8',
          '--app-name',
          'Fixture App',
          '--json',
        ],
        {
          readCredentialsFn: async () => ({ token: 'token_test' } as any),
          loadAccountSettings: async () => ({ experiments: true, featureToggles: { 'sessions.devPreview': true } } as any),
          startAndroidStream,
          registerSimulatorPreview,
          holdOpen: async () => {},
        },
      );

      expect(startAndroidStream).toHaveBeenCalledWith({
        host: '127.0.0.1',
        port: 9812,
        pollIntervalMs: 125,
        deviceId: 'emulator-5554',
      });
      expect(registerSimulatorPreview).toHaveBeenCalledWith(expect.objectContaining({
        idOrPrefix: 'sess_1',
        platform: 'android',
        deviceName: 'Pixel 8',
        appName: 'Fixture App',
        streamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
        mode: 'ai_control',
        owner: 'ai',
        connectionPath: 'direct',
      }));
      expect(close).toHaveBeenCalledTimes(1);
      expect(output.json()).toMatchObject({
        ok: true,
        kind: 'session_preview_android',
        data: {
          sessionId: 'sess_1',
          simulatorSessionId: 'sim_1',
          streamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
        },
      });
    } finally {
      output.restore();
    }
  });
});
