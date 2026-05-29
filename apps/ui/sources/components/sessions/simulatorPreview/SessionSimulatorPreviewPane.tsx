import * as React from 'react';
import { Image, Platform, Pressable, TextInput, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

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
}>;

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
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 18,
        paddingVertical: 14,
        backgroundColor: theme.colors.surface.base,
    },
    deviceChrome: {
        width: '100%',
        height: '100%',
        maxWidth: 430,
        maxHeight: 880,
        aspectRatio: 9 / 19.5,
        paddingHorizontal: 12,
        paddingTop: 16,
        paddingBottom: 12,
        borderRadius: 34,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.text.primary,
        shadowColor: theme.colors.shadow.color,
        shadowOpacity: 0.18,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 12 },
        gap: 10,
    },
    deviceSpeaker: {
        alignSelf: 'center',
        width: 64,
        height: 5,
        borderRadius: 999,
        backgroundColor: theme.colors.surface.elevated,
    },
    screenViewport: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        borderRadius: 22,
        backgroundColor: theme.colors.background.canvas,
    },
    deviceHomeIndicator: {
        alignSelf: 'center',
        width: 96,
        height: 4,
        borderRadius: 999,
        backgroundColor: theme.colors.surface.elevated,
    },
    frame: {
        width: '100%',
        height: '100%',
        resizeMode: 'contain',
    },
}));

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

export function SessionSimulatorPreviewPane(props: SessionSimulatorPreviewPaneProps) {
    const viewportSizeRef = React.useRef<Readonly<{ width: number; height: number }> | null>(null);
    const [textInputValue, setTextInputValue] = React.useState('');
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
    const frame = Platform.OS === 'web'
        ? React.createElement('img', {
            'data-testid': 'session.simulatorPreview.frame',
            alt: t('session.simulatorPreview.screenAlt', { deviceName: props.deviceName }),
            src: props.streamUrl,
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
            <View style={stylesheet.surface} testID="session.simulatorPreview.surface">
                <View style={stylesheet.deviceChrome} testID="session.simulatorPreview.deviceChrome">
                    <View style={stylesheet.deviceSpeaker} testID="session.simulatorPreview.deviceSpeaker" />
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
                    <View style={stylesheet.deviceHomeIndicator} testID="session.simulatorPreview.deviceHomeIndicator" />
                </View>
            </View>
        </View>
    );
}
