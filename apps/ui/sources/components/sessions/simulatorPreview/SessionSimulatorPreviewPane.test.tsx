import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

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

    it('sends normalized taps only when a user control lease is active', async () => {
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');
        const onSendInput = vi.fn();

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="android"
                deviceName="Android SDK"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
                mode="user_control"
                owner="user"
                controlLease={{
                    leaseId: 'lease_user_1',
                    generation: 1,
                    owner: 'user',
                }}
                onSendInput={onSendInput}
            />,
        );

        const viewport = screen.findByProps({ testID: 'session.simulatorPreview.screenViewport' });
        viewport.props.onLayout({
            nativeEvent: {
                layout: {
                    x: 0,
                    y: 0,
                    width: 200,
                    height: 400,
                },
            },
        });
        viewport.props.onPress({
            nativeEvent: {
                locationX: 50,
                locationY: 100,
            },
        });

        expect(onSendInput).toHaveBeenCalledWith({
            simulatorSessionId: 'sim_1',
            leaseId: 'lease_user_1',
            generation: 1,
            owner: 'user',
            input: {
                type: 'tap',
                x: 0.25,
                y: 0.25,
            },
        });
    });

    it('does not send taps while AI owns control', async () => {
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');
        const onSendInput = vi.fn();

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="android"
                deviceName="Android SDK"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
                mode="ai_control"
                owner="ai"
                onSendInput={onSendInput}
            />,
        );

        const viewport = screen.findByProps({ testID: 'session.simulatorPreview.screenViewport' });
        expect(viewport.props.onPress).toBeUndefined();
    });

    it('sends basic key and text input from the manual control bar', async () => {
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');
        const onSendInput = vi.fn();
        const onReleaseControl = vi.fn();

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="android"
                deviceName="Android SDK"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
                mode="user_control"
                owner="user"
                controlLease={{
                    leaseId: 'lease_user_1',
                    generation: 1,
                    owner: 'user',
                }}
                onSendInput={onSendInput}
                onReleaseControl={onReleaseControl}
            />,
        );

        screen.findByProps({ testID: 'session.simulatorPreview.key.back' }).props.onPress();
        screen.findByProps({ testID: 'session.simulatorPreview.key.home' }).props.onPress();
        screen.findByProps({ testID: 'session.simulatorPreview.key.enter' }).props.onPress();

        const textInput = screen.findByProps({ testID: 'session.simulatorPreview.textInput' });
        await act(async () => {
            textInput.props.onChangeText('hello world');
        });
        await act(async () => {
            screen.findByProps({ testID: 'session.simulatorPreview.textSend' }).props.onPress();
        });
        screen.findByProps({ testID: 'session.simulatorPreview.releaseControl' }).props.onPress();

        expect(onSendInput).toHaveBeenCalledWith(expect.objectContaining({
            input: { type: 'keyevent', key: 'back' },
        }));
        expect(onSendInput).toHaveBeenCalledWith(expect.objectContaining({
            input: { type: 'keyevent', key: 'home' },
        }));
        expect(onSendInput).toHaveBeenCalledWith(expect.objectContaining({
            input: { type: 'keyevent', key: 'enter' },
        }));
        expect(onSendInput).toHaveBeenCalledWith(expect.objectContaining({
            input: { type: 'text', text: 'hello world' },
        }));
        expect(onReleaseControl).toHaveBeenCalledTimes(1);
    });
});
