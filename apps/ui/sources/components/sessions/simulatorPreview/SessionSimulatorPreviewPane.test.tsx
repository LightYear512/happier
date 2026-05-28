import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const platformState = vi.hoisted(() => ({
    os: 'web' as 'web' | 'ios',
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            get OS() {
                return platformState.os;
            },
            select: (options: any) => options?.[platformState.os] ?? options?.default ?? null,
        },
    });
});

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: any) => React.createElement('Text', props, props.children),
}));

describe('SessionSimulatorPreviewPane', () => {
    beforeEach(() => {
        platformState.os = 'web';
    });

    it('uses a browser image element for MJPEG streams on web', async () => {
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="android"
                deviceName="Android SDK"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
            />,
        );

        const frame = screen.findByProps({ 'data-testid': 'session.simulatorPreview.frame' });

        expect(frame.type).toBe('img');
        expect(frame.props.src).toBe('http://127.0.0.1:9812/stream.mjpeg');
    });

    it('wraps the simulator screen in phone chrome', async () => {
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="android"
                deviceName="Android SDK"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
            />,
        );

        expect(screen.findByProps({ testID: 'session.simulatorPreview.deviceChrome' })).toBeTruthy();
        expect(screen.findByProps({ testID: 'session.simulatorPreview.deviceSpeaker' })).toBeTruthy();
        expect(screen.findByProps({ testID: 'session.simulatorPreview.deviceHomeIndicator' })).toBeTruthy();
    });

    it('keeps React Native Image rendering on native platforms', async () => {
        platformState.os = 'ios';
        vi.resetModules();
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="ios"
                deviceName="iPhone 16"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
            />,
        );

        const frame = screen.findByProps({ testID: 'session.simulatorPreview.frame' });

        expect(frame.type).toBe('Image');
        expect(frame.props.source).toEqual({ uri: 'http://127.0.0.1:9812/stream.mjpeg' });
    });
});
