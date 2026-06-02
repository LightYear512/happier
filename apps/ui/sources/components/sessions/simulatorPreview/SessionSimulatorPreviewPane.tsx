import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
    Image,
    Platform,
    Pressable,
    TextInput,
    View,
    type GestureResponderEvent,
    type LayoutChangeEvent,
    type StyleProp,
    type ViewStyle,
} from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

export type SessionSimulatorPreviewPaneProps = Readonly<{
    simulatorSessionId: string;
    platform: 'android' | 'ios';
    deviceName: string;
    streamUrl: string;
    appName?: string | undefined;
    mode?: 'idle' | 'ai_control' | 'user_control' | 'system_locked' | 'ended' | undefined;
    owner?: 'ai' | 'user' | 'system' | undefined;
    connectionPath?: 'relay' | 'direct' | 'adb_reverse' | undefined;
    nativeDevSessionId?: string | undefined;
    devServices?: Readonly<{
        metro?: SimulatorPreviewDevService | undefined;
        api?: SimulatorPreviewDevService | undefined;
        hmr?: SimulatorPreviewDevService | undefined;
    }> | undefined;
    controlLease?: Readonly<{
        leaseId: string;
        generation: number;
        owner: 'ai' | 'user';
    }> | undefined;
    onSendInput?: ((input: Readonly<{
        simulatorSessionId: string;
        leaseId: string;
        generation: number;
        owner: 'ai' | 'user';
        input: Readonly<
            | { type: 'tap'; x: number; y: number }
            | { type: 'swipe'; x1: number; y1: number; x2: number; y2: number; durationMs?: number }
            | { type: 'text'; text: string }
            | { type: 'keyevent'; key: 'back' | 'home' | 'enter' }
        >;
    }>) => void) | undefined;
    onRequestControl?: (() => void | Promise<unknown>) | undefined;
    onReleaseControl?: (() => void | Promise<unknown>) | undefined;
    onReloadApp?: (() => void | Promise<unknown>) | undefined;
    onReconnectDevServices?: (() => void | Promise<unknown>) | undefined;
}>;

type SimulatorPreviewDevService = Readonly<{
    status: 'unknown' | 'starting' | 'connected' | 'healthy' | 'ready' | 'degraded' | 'error';
    url?: string | undefined;
}>;

const WEB_MJPEG_FRAME_LOAD_TIMEOUT_MS = 1_500;
const WEB_FRAME_POLL_INTERVAL_MS = 1_000;
const DEFAULT_SCREEN_ASPECT_RATIO = 9 / 19.5;
const MAX_FIT_WIDTH = 520;
const ZOOM_STEP = 1.2;
const MIN_MANUAL_ZOOM = 0.5;
const MAX_MANUAL_ZOOM = 4;

type Size = Readonly<{
    width: number;
    height: number;
}>;

type ZoomRailIconName = React.ComponentProps<typeof Ionicons>['name'];

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        backgroundColor: theme.colors.surface.base,
    },
    header: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.inset,
        gap: 4,
    },
    title: {
        color: theme.colors.text.primary,
        fontSize: 13,
        fontWeight: '600',
    },
    subtitle: {
        color: theme.colors.text.secondary,
        fontSize: 11,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    titleGroup: {
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
    controlButton: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: theme.colors.surface.elevated,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
    },
    controlButtonText: {
        color: theme.colors.text.primary,
        fontSize: 11,
        fontWeight: '600',
    },
    controlBar: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
        gap: 8,
    },
    devStatusBar: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.inset,
        gap: 8,
    },
    devStatusTitle: {
        color: theme.colors.text.secondary,
        fontSize: 11,
        fontWeight: '600',
    },
    devStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        flexWrap: 'wrap',
    },
    devStatusPills: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
    },
    devStatusActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
    },
    devStatusPill: {
        minHeight: 28,
        justifyContent: 'center',
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
    },
    devStatusText: {
        color: theme.colors.text.primary,
        fontSize: 11,
        fontWeight: '600',
    },
    controlRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
    },
    keyButton: {
        minWidth: 52,
        minHeight: 32,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.elevated,
    },
    textInput: {
        flex: 1,
        minWidth: 140,
        minHeight: 32,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        color: theme.colors.text.primary,
        backgroundColor: theme.colors.surface.inset,
        fontSize: 12,
    },
    surface: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        paddingHorizontal: 18,
        paddingVertical: 14,
        backgroundColor: theme.colors.surface.base,
    },
    previewLayout: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        alignSelf: 'stretch',
        flexDirection: 'row',
        alignItems: 'stretch',
        gap: 10,
    },
    fitToolbar: {
        flexShrink: 0,
        alignSelf: 'flex-end',
        width: 36,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 6,
        padding: 0,
    },
    scalePill: {
        width: 46,
        height: 22,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.inset,
    },
    scaleText: {
        color: theme.colors.text.secondary,
        fontSize: 11,
        fontVariant: ['tabular-nums'],
        fontWeight: '700',
        lineHeight: 14,
        textAlign: 'center',
    },
    fitButton: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 0,
        paddingVertical: 0,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.elevated,
    },
    previewArea: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        alignSelf: 'stretch',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    screenFrame: {
        aspectRatio: DEFAULT_SCREEN_ASPECT_RATIO,
        flexShrink: 1,
        padding: 0,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.background.canvas,
        shadowColor: theme.colors.shadow.color,
        shadowOpacity: 0.12,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
    },
    screenViewport: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        borderRadius: 8,
        backgroundColor: theme.colors.background.canvas,
    },
    frame: {
        width: '100%',
        height: '100%',
        resizeMode: 'contain',
    },
}));

function fitFrameToAvailableArea(params: Readonly<{
    frameSize: Size;
    availableSize: Size;
}>): Size | null {
    const availableWidth = Math.max(0, params.availableSize.width);
    const availableHeight = Math.max(0, params.availableSize.height);
    if (availableWidth <= 0 || availableHeight <= 0 || params.frameSize.width <= 0 || params.frameSize.height <= 0) {
        return null;
    }

    const frameAspectRatio = params.frameSize.width / params.frameSize.height;
    const boundedWidth = Math.min(availableWidth, MAX_FIT_WIDTH);
    let width = boundedWidth;
    let height = width / frameAspectRatio;
    if (height > availableHeight) {
        height = availableHeight;
        width = height * frameAspectRatio;
    }
    return { width, height };
}

function formatMode(mode: SessionSimulatorPreviewPaneProps['mode']): string {
    switch (mode) {
        case 'ai_control':
            return t('session.simulatorPreview.mode.aiControl');
        case 'user_control':
            return t('session.simulatorPreview.mode.userControl');
        case 'system_locked':
            return t('session.simulatorPreview.mode.systemLocked');
        case 'ended':
            return t('session.simulatorPreview.mode.ended');
        case 'idle':
        case undefined:
            return t('session.simulatorPreview.mode.idle');
    }
}

function formatConnectionPath(path: SessionSimulatorPreviewPaneProps['connectionPath']): string {
    switch (path) {
        case 'adb_reverse':
            return t('session.simulatorPreview.connectionPath.adbReverse');
        case 'direct':
            return t('session.simulatorPreview.connectionPath.direct');
        case 'relay':
        case undefined:
            return t('session.simulatorPreview.connectionPath.relay');
    }
}

function formatOwner(owner: NonNullable<SessionSimulatorPreviewPaneProps['owner']>): string {
    switch (owner) {
        case 'ai':
            return t('session.simulatorPreview.owner.ai');
        case 'user':
            return t('session.simulatorPreview.owner.user');
        case 'system':
            return t('session.simulatorPreview.owner.system');
    }
}

function formatDevServiceStatus(status: SimulatorPreviewDevService['status']): string {
    if (status === 'connected') return t('session.simulatorPreview.devServices.status.connected');
    if (status === 'healthy') return t('session.simulatorPreview.devServices.status.healthy');
    if (status === 'ready') return t('session.simulatorPreview.devServices.status.ready');
    if (status === 'starting') return t('session.simulatorPreview.devServices.status.starting');
    if (status === 'degraded') return t('session.simulatorPreview.devServices.status.degraded');
    if (status === 'error') return t('session.simulatorPreview.devServices.status.error');
    return t('session.simulatorPreview.devServices.status.unknown');
}

function renderDevService(label: string, service: SimulatorPreviewDevService | undefined, testID: string) {
    if (!service) return null;
    return (
        <View style={stylesheet.devStatusPill} testID={testID}>
            <Text style={stylesheet.devStatusText}>{`${label}: ${formatDevServiceStatus(service.status)}`}</Text>
        </View>
    );
}

function buildPolledFrameUrl(streamUrl: string, revision: number): string {
    try {
        const url = new URL(streamUrl);
        url.pathname = url.pathname.replace(/\/stream\.mjpeg$/u, '/frame.jpg');
        url.searchParams.set('happier_frame', String(revision));
        return url.toString();
    } catch {
        const frameUrl = streamUrl.replace(/\/stream\.mjpeg(?:[?#].*)?$/u, '/frame.jpg');
        const separator = frameUrl.includes('?') ? '&' : '?';
        return `${frameUrl}${separator}happier_frame=${revision}`;
    }
}

function renderZoomRailButton(params: Readonly<{
    iconName: ZoomRailIconName;
    iconTestID: string;
    label: string;
    onPress: () => void;
    testID: string;
    color: string;
}>) {
    return (
        <Pressable
            accessibilityLabel={params.label}
            accessibilityRole="button"
            hitSlop={6}
            onPress={params.onPress}
            style={stylesheet.fitButton}
            testID={params.testID}
        >
            <Ionicons
                color={params.color}
                name={params.iconName}
                size={15}
                testID={params.iconTestID}
            />
        </Pressable>
    );
}

export function SessionSimulatorPreviewPane(props: SessionSimulatorPreviewPaneProps) {
    const { theme } = useUnistyles();
    const viewportSizeRef = React.useRef<Readonly<{ width: number; height: number }> | null>(null);
    const webFrameLoadedRef = React.useRef(false);
    const [textInputValue, setTextInputValue] = React.useState('');
    const [webFrameFallbackRevision, setWebFrameFallbackRevision] = React.useState(0);
    const [frameSize, setFrameSize] = React.useState<Size | null>(null);
    const [previewAreaSize, setPreviewAreaSize] = React.useState<Size | null>(null);
    const [manualZoom, setManualZoom] = React.useState(1);
    const title = props.appName && props.appName.trim().length > 0
        ? `${props.deviceName} · ${props.appName.trim()}`
        : props.deviceName;
    const subtitle = [
        props.platform === 'ios' ? t('session.simulatorPreview.platform.ios') : t('session.simulatorPreview.platform.android'),
        formatMode(props.mode),
        props.owner ? t('session.simulatorPreview.ownerLabel', { owner: formatOwner(props.owner) }) : null,
        formatConnectionPath(props.connectionPath),
    ].filter(Boolean).join(' · ');
    const hasUserControl = props.mode === 'user_control'
        && props.owner === 'user'
        && props.controlLease?.owner === 'user'
        && Boolean(props.onSendInput);
    const canRequestControl = !hasUserControl && Boolean(props.onRequestControl);
    const handleLayout = React.useCallback((event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        viewportSizeRef.current = { width, height };
    }, []);
    const handlePreviewAreaLayout = React.useCallback((event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setPreviewAreaSize({ width, height });
    }, []);
    const handlePress = React.useCallback((event: GestureResponderEvent) => {
        const viewportSize = viewportSizeRef.current;
        if (!hasUserControl || !props.controlLease || !props.onSendInput || !viewportSize || viewportSize.width <= 0 || viewportSize.height <= 0) {
            return;
        }
        props.onSendInput({
            simulatorSessionId: props.simulatorSessionId,
            leaseId: props.controlLease.leaseId,
            generation: props.controlLease.generation,
            owner: props.controlLease.owner,
            input: {
                type: 'tap',
                x: Math.max(0, Math.min(1, event.nativeEvent.locationX / viewportSize.width)),
                y: Math.max(0, Math.min(1, event.nativeEvent.locationY / viewportSize.height)),
            },
        });
    }, [hasUserControl, props.controlLease, props.onSendInput, props.simulatorSessionId]);
    const sendLeaseInput = React.useCallback((input: Parameters<NonNullable<SessionSimulatorPreviewPaneProps['onSendInput']>>[0]['input']) => {
        if (!hasUserControl || !props.controlLease || !props.onSendInput) return;
        props.onSendInput({
            simulatorSessionId: props.simulatorSessionId,
            leaseId: props.controlLease.leaseId,
            generation: props.controlLease.generation,
            owner: props.controlLease.owner,
            input,
        });
    }, [hasUserControl, props.controlLease, props.onSendInput, props.simulatorSessionId]);
    const sendKeyevent = React.useCallback((key: 'back' | 'home' | 'enter') => {
        sendLeaseInput({ type: 'keyevent', key });
    }, [sendLeaseInput]);
    const sendText = React.useCallback(() => {
        if (textInputValue.length <= 0) return;
        sendLeaseInput({ type: 'text', text: textInputValue });
        setTextInputValue('');
    }, [sendLeaseInput, textInputValue]);
    React.useEffect(() => {
        if (Platform.OS !== 'web') return undefined;
        webFrameLoadedRef.current = false;
        setWebFrameFallbackRevision(0);
        const timeout = setTimeout(() => {
            if (!webFrameLoadedRef.current) {
                setWebFrameFallbackRevision(1);
            }
        }, WEB_MJPEG_FRAME_LOAD_TIMEOUT_MS);
        return () => {
            clearTimeout(timeout);
        };
    }, [props.streamUrl]);
    React.useEffect(() => {
        if (Platform.OS !== 'web' || webFrameFallbackRevision <= 0) return undefined;
        const interval = setInterval(() => {
            setWebFrameFallbackRevision((revision) => revision > 0 ? revision + 1 : revision);
        }, WEB_FRAME_POLL_INTERVAL_MS);
        return () => {
            clearInterval(interval);
        };
    }, [webFrameFallbackRevision > 0]);
    const webFrameSrc = webFrameFallbackRevision > 0
        ? buildPolledFrameUrl(props.streamUrl, webFrameFallbackRevision)
        : props.streamUrl;
    const handleWebFrameLoad = React.useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
        const image = event.currentTarget;
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            webFrameLoadedRef.current = true;
            setFrameSize({
                width: image.naturalWidth,
                height: image.naturalHeight,
            });
        }
    }, []);
    const handleWebFrameError = React.useCallback(() => {
        setWebFrameFallbackRevision((revision) => revision > 0 ? revision : 1);
    }, []);
    const frame = Platform.OS === 'web'
        ? React.createElement('img', {
            'data-testid': 'session.simulatorPreview.frame',
            alt: t('session.simulatorPreview.screenAlt', { deviceName: props.deviceName }),
            onError: handleWebFrameError,
            onLoad: handleWebFrameLoad,
            src: webFrameSrc,
            style: {
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: 'block',
            },
        })
        : (
            <Image
                testID="session.simulatorPreview.frame"
                accessibilityLabel={t('session.simulatorPreview.screenAlt', { deviceName: props.deviceName })}
                source={{ uri: props.streamUrl }}
                style={stylesheet.frame}
            />
        );
    const fittedFrameSize = frameSize && previewAreaSize
        ? fitFrameToAvailableArea({ frameSize, availableSize: previewAreaSize })
        : null;
    const renderedFrameSize = fittedFrameSize
        ? {
            width: fittedFrameSize.width * manualZoom,
            height: fittedFrameSize.height * manualZoom,
        }
        : null;
    const scalePercent = fittedFrameSize && frameSize
        ? Math.max(1, Math.round(((fittedFrameSize.width * manualZoom) / frameSize.width) * 100))
        : 100;
    const screenFrameStyle: StyleProp<ViewStyle> = fittedFrameSize
        ? [stylesheet.screenFrame, renderedFrameSize]
        : [stylesheet.screenFrame, { width: '100%', maxWidth: MAX_FIT_WIDTH, maxHeight: '100%' as const }];
    const setNextManualZoom = React.useCallback((nextZoom: number) => {
        setManualZoom(Math.max(MIN_MANUAL_ZOOM, Math.min(MAX_MANUAL_ZOOM, nextZoom)));
    }, []);
    const previewArea = Platform.OS === 'web'
        ? (
            <View onLayout={handlePreviewAreaLayout} style={stylesheet.previewArea} testID="session.simulatorPreview.previewAreaLayout">
                {React.createElement('div', {
                    'data-testid': 'session.simulatorPreview.previewArea',
                    style: {
                        width: '100%',
                        height: '100%',
                        overflow: 'auto',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    },
                }, (
                    <View style={screenFrameStyle} testID="session.simulatorPreview.screenFrame">
                        {hasUserControl
                            ? (
                                <Pressable
                                    onLayout={handleLayout}
                                    onPress={handlePress}
                                    style={stylesheet.screenViewport}
                                    testID="session.simulatorPreview.screenViewport"
                                >
                                    {frame}
                                </Pressable>
                            )
                            : (
                                <View style={stylesheet.screenViewport} testID="session.simulatorPreview.screenViewport">
                                    {frame}
                                </View>
                            )}
                    </View>
                ))}
            </View>
        )
        : (
            <View onLayout={handlePreviewAreaLayout} style={stylesheet.previewArea} testID="session.simulatorPreview.previewAreaLayout">
                <View style={screenFrameStyle} testID="session.simulatorPreview.screenFrame">
                    {hasUserControl
                        ? (
                            <Pressable
                                onLayout={handleLayout}
                                onPress={handlePress}
                                style={stylesheet.screenViewport}
                                testID="session.simulatorPreview.screenViewport"
                            >
                                {frame}
                            </Pressable>
                        )
                        : (
                            <View style={stylesheet.screenViewport} testID="session.simulatorPreview.screenViewport">
                                {frame}
                            </View>
                        )}
                </View>
            </View>
        );

    return (
        <View style={stylesheet.container} testID="session.simulatorPreview.root">
            <View style={stylesheet.header}>
                <View style={stylesheet.headerRow}>
                    <View style={stylesheet.titleGroup}>
                        <Text style={stylesheet.title}>{title}</Text>
                        <Text style={stylesheet.subtitle}>{subtitle}</Text>
                    </View>
                    {canRequestControl
                        ? (
                            <Pressable
                                onPress={props.onRequestControl}
                                style={stylesheet.controlButton}
                                testID="session.simulatorPreview.requestControl"
                            >
                                <Text style={stylesheet.controlButtonText}>{t('session.simulatorPreview.requestControl')}</Text>
                            </Pressable>
                        )
                        : null}
                </View>
            </View>
            {hasUserControl
                ? (
                    <View style={stylesheet.controlBar} testID="session.simulatorPreview.controlBar">
                        <View style={stylesheet.controlRow}>
                            <Pressable
                                onPress={() => sendKeyevent('back')}
                                style={stylesheet.keyButton}
                                testID="session.simulatorPreview.key.back"
                            >
                                <Text style={stylesheet.controlButtonText}>{t('session.simulatorPreview.controls.back')}</Text>
                            </Pressable>
                            <Pressable
                                onPress={() => sendKeyevent('home')}
                                style={stylesheet.keyButton}
                                testID="session.simulatorPreview.key.home"
                            >
                                <Text style={stylesheet.controlButtonText}>{t('session.simulatorPreview.controls.home')}</Text>
                            </Pressable>
                            <Pressable
                                onPress={() => sendKeyevent('enter')}
                                style={stylesheet.keyButton}
                                testID="session.simulatorPreview.key.enter"
                            >
                                <Text style={stylesheet.controlButtonText}>{t('session.simulatorPreview.controls.enter')}</Text>
                            </Pressable>
                            {props.onReleaseControl
                                ? (
                                    <Pressable
                                        onPress={props.onReleaseControl}
                                        style={stylesheet.keyButton}
                                        testID="session.simulatorPreview.releaseControl"
                                    >
                                        <Text style={stylesheet.controlButtonText}>{t('session.simulatorPreview.releaseControl')}</Text>
                                    </Pressable>
                                )
                                : null}
                        </View>
                        <View style={stylesheet.controlRow}>
                            <TextInput
                                onChangeText={setTextInputValue}
                                placeholder={t('session.simulatorPreview.controls.textPlaceholder')}
                                style={stylesheet.textInput}
                                testID="session.simulatorPreview.textInput"
                                value={textInputValue}
                            />
                            <Pressable
                                onPress={sendText}
                                style={stylesheet.keyButton}
                                testID="session.simulatorPreview.textSend"
                            >
                                <Text style={stylesheet.controlButtonText}>{t('session.simulatorPreview.controls.sendText')}</Text>
                            </Pressable>
                        </View>
                    </View>
                )
                : null}
            {props.nativeDevSessionId || props.devServices
                ? (
                    <View style={stylesheet.devStatusBar} testID="session.simulatorPreview.nativeDev.status">
                        <Text style={stylesheet.devStatusTitle}>{t('session.simulatorPreview.devServices.title')}</Text>
                        <View style={stylesheet.devStatusRow}>
                            <View style={stylesheet.devStatusPills}>
                                {renderDevService(t('session.simulatorPreview.devServices.metro'), props.devServices?.metro, 'session.simulatorPreview.devService.metro')}
                                {renderDevService(t('session.simulatorPreview.devServices.api'), props.devServices?.api, 'session.simulatorPreview.devService.api')}
                                {renderDevService(t('session.simulatorPreview.devServices.hmr'), props.devServices?.hmr, 'session.simulatorPreview.devService.hmr')}
                            </View>
                            <View style={stylesheet.devStatusActions}>
                                {props.onReloadApp
                                    ? (
                                        <Pressable
                                            onPress={props.onReloadApp}
                                            style={stylesheet.keyButton}
                                            testID="session.simulatorPreview.reloadApp"
                                        >
                                            <Text style={stylesheet.controlButtonText}>{t('session.simulatorPreview.controls.reloadApp')}</Text>
                                        </Pressable>
                                    )
                                    : null}
                                {props.onReconnectDevServices
                                    ? (
                                        <Pressable
                                            onPress={props.onReconnectDevServices}
                                            style={stylesheet.keyButton}
                                            testID="session.simulatorPreview.reconnectDevServices"
                                        >
                                            <Text style={stylesheet.controlButtonText}>{t('session.simulatorPreview.controls.reconnectDevServices')}</Text>
                                        </Pressable>
                                    )
                                    : null}
                            </View>
                        </View>
                    </View>
                )
                : null}
            <View style={stylesheet.surface} testID="session.simulatorPreview.surface">
                <View style={stylesheet.previewLayout} testID="session.simulatorPreview.previewLayout">
                    {previewArea}
                    <View style={stylesheet.fitToolbar} testID="session.simulatorPreview.fitToolbar">
                        {renderZoomRailButton({
                            color: theme.colors.text.secondary,
                            iconName: 'remove',
                            iconTestID: 'session.simulatorPreview.zoomOutIcon',
                            label: t('session.simulatorPreview.controls.zoomOut'),
                            onPress: () => setNextManualZoom(manualZoom / ZOOM_STEP),
                            testID: 'session.simulatorPreview.zoomOut',
                        })}
                        <View style={stylesheet.scalePill} testID="session.simulatorPreview.zoomScalePill">
                            <Text style={stylesheet.scaleText} testID="session.simulatorPreview.zoomScale">{`${scalePercent}%`}</Text>
                        </View>
                        {renderZoomRailButton({
                            color: theme.colors.text.secondary,
                            iconName: 'add',
                            iconTestID: 'session.simulatorPreview.zoomInIcon',
                            label: t('session.simulatorPreview.controls.zoomIn'),
                            onPress: () => setNextManualZoom(manualZoom * ZOOM_STEP),
                            testID: 'session.simulatorPreview.zoomIn',
                        })}
                        {renderZoomRailButton({
                            color: theme.colors.text.secondary,
                            iconName: 'resize-outline',
                            iconTestID: 'session.simulatorPreview.fitIcon',
                            label: t('session.simulatorPreview.controls.fit'),
                            onPress: () => {
                                setManualZoom(1);
                                if (frameSize && previewAreaSize) {
                                    const nextSize = fitFrameToAvailableArea({ frameSize, availableSize: previewAreaSize });
                                    if (nextSize) {
                                        viewportSizeRef.current = nextSize;
                                    }
                                }
                            },
                            testID: 'session.simulatorPreview.fit',
                        })}
                    </View>
                </View>
            </View>
        </View>
    );
}
