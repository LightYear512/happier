import * as React from 'react';
import { Image, Platform, View } from 'react-native';
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

export function SessionSimulatorPreviewPane(props: SessionSimulatorPreviewPaneProps) {
    const title = props.appName && props.appName.trim().length > 0
        ? `${props.deviceName} · ${props.appName.trim()}`
        : props.deviceName;
    const subtitle = [
        props.platform === 'ios' ? t('session.simulatorPreview.platform.ios') : t('session.simulatorPreview.platform.android'),
        formatMode(props.mode),
        props.owner ? t('session.simulatorPreview.ownerLabel', { owner: props.owner }) : null,
        formatConnectionPath(props.connectionPath),
    ].filter(Boolean).join(' · ');

    return (
        <View style={stylesheet.container} testID="session.simulatorPreview.root">
            <View style={stylesheet.header}>
                <Text style={stylesheet.title}>{title}</Text>
                                <Text style={stylesheet.subtitle}>{subtitle}</Text>
            </View>
            <View style={stylesheet.surface} testID="session.simulatorPreview.surface">
                <View style={stylesheet.deviceChrome} testID="session.simulatorPreview.deviceChrome">
                    <View style={stylesheet.deviceSpeaker} testID="session.simulatorPreview.deviceSpeaker" />
                    <View style={stylesheet.screenViewport} testID="session.simulatorPreview.screenViewport">
                        {Platform.OS === 'web'
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
                            )}
                    </View>
                    <View style={stylesheet.deviceHomeIndicator} testID="session.simulatorPreview.deviceHomeIndicator" />
                </View>
            </View>
        </View>
    );
}
