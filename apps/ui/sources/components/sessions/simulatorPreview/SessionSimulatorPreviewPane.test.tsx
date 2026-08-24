import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderScreen } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return style.reduce<Record<string, unknown>>((acc, entry) => ({
            ...acc,
            ...flattenStyle(entry),
        }), {});
    }
    if (style && typeof style === 'object') {
        return style as Record<string, unknown>;
    }
    return {};
}

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
        vi.useRealTimers();
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

    it('falls back to polling the latest JPEG frame when the web MJPEG image does not load', async () => {
        vi.useFakeTimers();
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="ios"
                deviceName="iPhone 17 Pro"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
            />,
        );

        expect(screen.findByProps({ 'data-testid': 'session.simulatorPreview.frame' }).props.src)
            .toBe('http://127.0.0.1:9812/stream.mjpeg');

        await act(async () => {
            vi.advanceTimersByTime(1_500);
        });

        const frame = screen.findByProps({ 'data-testid': 'session.simulatorPreview.frame' });
        expect(frame.props.src).toBe('http://127.0.0.1:9812/frame.jpg?happier_frame=1');
    });

    it('renders the simulator screen without a fake phone shell', async () => {
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="android"
                deviceName="Android SDK"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
            />,
        );

        expect(screen.findByProps({ testID: 'session.simulatorPreview.screenViewport' })).toBeTruthy();
        expect(() => screen.findByProps({ testID: 'session.simulatorPreview.deviceChrome' })).toThrow();
        expect(() => screen.findByProps({ testID: 'session.simulatorPreview.deviceSpeaker' })).toThrow();
        expect(() => screen.findByProps({ testID: 'session.simulatorPreview.deviceHomeIndicator' })).toThrow();
    });

    it('fits the web viewport to the loaded frame without changing the real aspect ratio', async () => {
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="ios"
                deviceName="iPhone 17 Pro"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
            />,
        );

        const previewArea = screen.findByProps({ testID: 'session.simulatorPreview.previewAreaLayout' });
        await act(async () => {
            previewArea.props.onLayout({
                nativeEvent: {
                    layout: {
                        x: 0,
                        y: 0,
                        width: 560,
                        height: 940,
                    },
                },
            });
        });

        const frame = screen.findByProps({ 'data-testid': 'session.simulatorPreview.frame' });
        await act(async () => {
            frame.props.onLoad({
                currentTarget: {
                    naturalWidth: 1206,
                    naturalHeight: 2622,
                },
            });
        });

        const screenFrame = screen.findByProps({ testID: 'session.simulatorPreview.screenFrame' });
        const screenFrameStyle = flattenStyle(screenFrame.props.style);
        expect(screenFrameStyle.width).toBeCloseTo(432.36, 2);
        expect(screenFrameStyle.height).toBe(940);
        expect(Number(screenFrameStyle.width) / Number(screenFrameStyle.height)).toBeCloseTo(1206 / 2622, 5);
        expect(frame.props.style.objectFit).toBe('contain');
    });

    it('shows the current fit scale and exposes a fit action', async () => {
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="ios"
                deviceName="iPhone 17 Pro"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
            />,
        );

        await act(async () => {
            screen.findByProps({ testID: 'session.simulatorPreview.previewAreaLayout' }).props.onLayout({
                nativeEvent: {
                    layout: {
                        x: 0,
                        y: 0,
                        width: 560,
                        height: 940,
                    },
                },
            });
            screen.findByProps({ 'data-testid': 'session.simulatorPreview.frame' }).props.onLoad({
                currentTarget: {
                    naturalWidth: 1206,
                    naturalHeight: 2622,
                },
            });
        });

        expect(screen.findByProps({ testID: 'session.simulatorPreview.zoomScale' }).props.children).toBe('36%');
        expect(screen.findByProps({ testID: 'session.simulatorPreview.fit' })).toBeTruthy();
    });

    it('places zoom controls vertically at the lower right outside of the simulator image area', async () => {
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="ios"
                deviceName="iPhone 17 Pro"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
            />,
        );

        const toolbarStyle = flattenStyle(screen.findByProps({ testID: 'session.simulatorPreview.fitToolbar' }).props.style);
        expect(toolbarStyle.position).toBeUndefined();
        expect(toolbarStyle.flexDirection).toBe('column');
        expect(toolbarStyle.alignSelf).toBe('flex-end');
        expect(toolbarStyle.justifyContent).toBe('flex-end');
    });

    it('renders zoom rail actions with icon components instead of text symbols', async () => {
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="ios"
                deviceName="iPhone 17 Pro"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
            />,
        );

        expect(screen.findByProps({ testID: 'session.simulatorPreview.zoomOutIcon' }).props.name).toBe('remove');
        expect(screen.findByProps({ testID: 'session.simulatorPreview.zoomInIcon' }).props.name).toBe('add');
        expect(screen.findByProps({ testID: 'session.simulatorPreview.fitIcon' }).props.name).toBe('resize');
    });

    it('lets users zoom beyond fit and reset back to fit', async () => {
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="ios"
                deviceName="iPhone 17 Pro"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
            />,
        );

        await act(async () => {
            screen.findByProps({ testID: 'session.simulatorPreview.previewAreaLayout' }).props.onLayout({
                nativeEvent: {
                    layout: {
                        x: 0,
                        y: 0,
                        width: 560,
                        height: 940,
                    },
                },
            });
            screen.findByProps({ 'data-testid': 'session.simulatorPreview.frame' }).props.onLoad({
                currentTarget: {
                    naturalWidth: 1206,
                    naturalHeight: 2622,
                },
            });
        });

        const fitFrame = flattenStyle(screen.findByProps({ testID: 'session.simulatorPreview.screenFrame' }).props.style);
        await act(async () => {
            screen.findByProps({ testID: 'session.simulatorPreview.zoomIn' }).props.onPress();
        });

        const zoomedFrame = flattenStyle(screen.findByProps({ testID: 'session.simulatorPreview.screenFrame' }).props.style);
        expect(Number(zoomedFrame.width)).toBeGreaterThan(Number(fitFrame.width));
        expect(Number(zoomedFrame.width) / Number(zoomedFrame.height)).toBeCloseTo(1206 / 2622, 5);
        expect(screen.findByProps({ testID: 'session.simulatorPreview.zoomScale' }).props.children).toBe('43%');

        await act(async () => {
            screen.findByProps({ testID: 'session.simulatorPreview.fit' }).props.onPress();
        });

        const resetFrame = flattenStyle(screen.findByProps({ testID: 'session.simulatorPreview.screenFrame' }).props.style);
        expect(resetFrame.width).toBe(fitFrame.width);
        expect(resetFrame.height).toBe(fitFrame.height);
        expect(screen.findByProps({ testID: 'session.simulatorPreview.zoomScale' }).props.children).toBe('36%');
    });

    it('uses a scrollable web preview area when manual zoom exceeds fit', async () => {
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="ios"
                deviceName="iPhone 17 Pro"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
            />,
        );

        const previewArea = screen.findByProps({ 'data-testid': 'session.simulatorPreview.previewArea' });
        expect(previewArea.type).toBe('div');
        expect(previewArea.props.style.overflow).toBe('auto');
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

    it('renders readonly device state and disables manual simulator input', async () => {
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');
        const onSendInput = vi.fn();
        const onRequestControl = vi.fn();

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="android"
                deviceName="Android SDK"
                deviceDisplayName="Pixel 8 API 35"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
                mode="ai_control"
                owner="ai"
                controlCapability="readonly"
                controlUnavailableReason="device_in_use"
                onSendInput={onSendInput}
                onRequestControl={onRequestControl}
            />,
        );

        expect(screen.findByProps({ testID: 'session.simulatorPreview.deviceStatus' }).props.children).toContain('Pixel 8 API 35');
        expect(screen.findByProps({ testID: 'session.simulatorPreview.readonlyStatus' })).toBeTruthy();
        expect(() => screen.findByProps({ testID: 'session.simulatorPreview.requestControl' })).toThrow();
        expect(() => screen.findByProps({ testID: 'session.simulatorPreview.textInput' })).toThrow();

        const viewport = screen.findByProps({ testID: 'session.simulatorPreview.screenViewport' });
        expect(viewport.props.onPress).toBeUndefined();
        expect(onSendInput).not.toHaveBeenCalled();
        expect(onRequestControl).not.toHaveBeenCalled();
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

    it('renders native development service health when attached', async () => {
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="android"
                deviceName="Android SDK"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
                nativeDevSessionId="native_dev_1"
                devServices={{
                    metro: { status: 'connected', url: 'http://127.0.0.1:8081' },
                    api: { status: 'healthy' },
                    hmr: { status: 'ready' },
                }}
            />,
        );

        expect(screen.findByProps({ testID: 'session.simulatorPreview.nativeDev.status' })).toBeTruthy();
        expect(screen.findByProps({ testID: 'session.simulatorPreview.devService.metro' }).props.children.props.children).toContain('Metro');
        expect(screen.findByProps({ testID: 'session.simulatorPreview.devService.api' }).props.children.props.children).toContain('API');
        expect(screen.findByProps({ testID: 'session.simulatorPreview.devService.hmr' }).props.children.props.children).toContain('HMR');
    });

    it('exposes reload and reconnect controls from the native dev status bar', async () => {
        const { SessionSimulatorPreviewPane } = await import('./SessionSimulatorPreviewPane');
        const onReloadApp = vi.fn();
        const onReconnectDevServices = vi.fn();

        const screen = await renderScreen(
            <SessionSimulatorPreviewPane
                simulatorSessionId="sim_1"
                platform="android"
                deviceName="Android SDK"
                streamUrl="http://127.0.0.1:9812/stream.mjpeg"
                nativeDevSessionId="native_dev_1"
                devServices={{ metro: { status: 'connected' } }}
                onReloadApp={onReloadApp}
                onReconnectDevServices={onReconnectDevServices}
            />,
        );

        screen.findByProps({ testID: 'session.simulatorPreview.reloadApp' }).props.onPress();
        screen.findByProps({ testID: 'session.simulatorPreview.reconnectDevServices' }).props.onPress();

        expect(onReloadApp).toHaveBeenCalledTimes(1);
        expect(onReconnectDevServices).toHaveBeenCalledTimes(1);
    });
});
