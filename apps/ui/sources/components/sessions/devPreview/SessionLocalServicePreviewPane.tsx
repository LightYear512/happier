import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import {
    type SessionLocalServicePreviewPaneProps,
    useSessionLocalServicePreviewResolution,
} from './SessionLocalServicePreviewPane.shared';

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface.base,
        minHeight: 0,
        minWidth: 0,
    },
    previewFrameContainer: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
    },
    secondary: {
        color: theme.colors.text.secondary,
        fontSize: 12,
    },
    loading: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    unavailable: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
}));

export function SessionLocalServicePreviewPane(props: SessionLocalServicePreviewPaneProps) {
    const {
        iframeTitle,
        previewUrl,
        relayNamespaceStrategy,
        relayState,
        sameMachinePreviewUrl,
    } = useSessionLocalServicePreviewResolution(props, { sameMachinePreviewEnabled: true });

    const iframeSandbox = previewUrl && previewUrl === sameMachinePreviewUrl
        ? undefined
        : relayNamespaceStrategy === 'host'
            ? 'allow-downloads allow-forms allow-modals allow-popups allow-scripts allow-same-origin'
            : 'allow-downloads allow-forms allow-modals allow-popups allow-scripts';

    return (
        <View style={styles.container}>
            {previewUrl ? (
                <View style={styles.previewFrameContainer}>
                    {React.createElement('iframe', {
                        src: previewUrl,
                        title: iframeTitle,
                        testID: 'session.localServicePreview.iframe',
                        'data-testid': 'session.localServicePreview.iframe',
                        ...(iframeSandbox ? { sandbox: iframeSandbox } : {}),
                        style: {
                            width: '100%',
                            height: '100%',
                            border: '0',
                            display: 'block',
                        },
                    })}
                </View>
            ) : relayState === 'loading' ? (
                <View style={styles.loading}>
                    <ActivityIndicator />
                </View>
            ) : (
                <View style={styles.unavailable}>
                    <Text selectable style={styles.secondary}>{t('common.unavailable')}</Text>
                </View>
            )}
        </View>
    );
}
