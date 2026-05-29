import { describe, expect, it } from 'vitest';

import { createSessionSimulatorPreviewDetailsTab } from './sessionDetailsTabBuilders';

describe('createSessionSimulatorPreviewDetailsTab', () => {
    it('preserves native development composition metadata in the simulator preview resource', () => {
        const tab = createSessionSimulatorPreviewDetailsTab({
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
                api: { status: 'healthy' },
                hmr: { status: 'ready' },
            },
            registeredAtMs: 1,
        });

        expect(tab.resource).toEqual(expect.objectContaining({
            kind: 'simulatorPreview',
            nativeDevSessionId: 'native_dev_1',
            devServices: {
                metro: { status: 'connected', url: 'http://127.0.0.1:8081' },
                api: { status: 'healthy' },
                hmr: { status: 'ready' },
            },
        }));
    });
});
