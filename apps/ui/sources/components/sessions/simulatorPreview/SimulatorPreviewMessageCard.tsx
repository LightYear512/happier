import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { SimulatorPreviewV1 } from '@happier-dev/protocol';

import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { createSessionSimulatorPreviewDetailsTab } from '@/components/sessions/panes/details/sessionDetailsTabBuilders';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

const styles = StyleSheet.create((theme) => ({
    card: {
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.elevated,
    },
    content: {
        gap: 6,
    },
    title: {
        color: theme.colors.text.primary,
        fontSize: 14,
        fontWeight: '600',
    },
    secondary: {
        color: theme.colors.text.secondary,
        fontSize: 12,
    },
}));

function formatMode(mode: SimulatorPreviewV1['mode']): string {
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
            return t('session.simulatorPreview.mode.idle');
        default:
            return t('session.simulatorPreview.mode.idle');
    }
}

export function SimulatorPreviewMessageCard(props: Readonly<{
    payload: SimulatorPreviewV1;
    sessionId: string;
}>) {
    const pane = useAppPaneScope(`session:${props.sessionId}`);
    const appName = props.payload.appName && props.payload.appName.trim().length > 0
        ? props.payload.appName.trim()
        : null;

    const handlePress = React.useCallback(() => {
        pane.openDetailsTab(createSessionSimulatorPreviewDetailsTab(props.payload), { intent: 'preview' });
    }, [pane, props.payload]);

    return (
        <Pressable
            testID="simulator-preview-card"
            accessibilityRole="button"
            onPress={handlePress}
            style={({ pressed }) => [styles.card, { opacity: pressed ? 0.8 : 1 }]}
        >
            <View style={styles.content}>
                <Text selectable style={styles.title}>{props.payload.deviceName}</Text>
                {appName ? (
                    <Text selectable style={styles.secondary}>{appName}</Text>
                ) : null}
                <Text selectable style={styles.secondary}>{formatMode(props.payload.mode)}</Text>
            </View>
        </Pressable>
    );
}
